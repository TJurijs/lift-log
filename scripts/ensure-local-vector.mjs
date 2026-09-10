import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ensureLocalDocker, isLocalDockerEndpoint } from "./ensure-local-docker.mjs";

const socket = "/var/run/docker.sock";
const socketHost = `unix://${socket}`;
const socketBind = `${socket}:${socket}:ro`;
const sourceHost = "http://host.docker.internal:2375";
const repairLabel = "dev.lift-log.vector-socket-repair";
class VectorSetupError extends Error {}
const preservedHostFields = ["NetworkMode", "RestartPolicy", "LogConfig", "ReadonlyRootfs", "ShmSize", "Runtime", "IpcMode", "CgroupnsMode", "Memory", "MemorySwap", "MemoryReservation", "NanoCpus", "CpuShares", "CpuPeriod", "CpuQuota", "CpusetCpus", "CpusetMems", "PidsLimit", "OomKillDisable", "Ulimits", "CapDrop", "MaskedPaths", "ReadonlyPaths"];
function isDefaultHostValue(value) {
  if (value == null || value === false || value === 0 || value === "") return true;
  if (Array.isArray(value)) return value.every(isDefaultHostValue);
  return typeof value === "object" && Object.values(value).every(isDefaultHostValue);
}

export function localNamedPipe(endpoint) {
  if (!isLocalDockerEndpoint(endpoint) || !/^npipe:\/{2,4}\.\/pipe\/(docker_engine|dockerDesktopLinuxEngine)$/i.test(endpoint)) {
    throw new VectorSetupError("Vector repair requires a verified local Docker Desktop named pipe. No containers were changed.");
  }
  return endpoint.replace(/^npipe:\/+/i, "").replaceAll("/", "\\").replace(/^\.\\/, "\\\\.\\");
}

function runDocker(args, env) {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { env, windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(new VectorSetupError("Could not inspect the local Docker context. No containers were changed."));
      else resolve(stdout);
    });
  });
}

export async function resolveLocalVectorEndpoint(env = process.env, run = runDocker) {
  // Reject remote overrides even when DOCKER_CONTEXT would take precedence.
  if (env.DOCKER_HOST && !isLocalDockerEndpoint(env.DOCKER_HOST)) localNamedPipe(env.DOCKER_HOST);
  let endpoint = env.DOCKER_CONTEXT ? null : env.DOCKER_HOST;
  if (!endpoint) {
    const result = await run(["context", "inspect", ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []), "--format", "{{json .Endpoints.docker.Host}}"], env);
    try { endpoint = JSON.parse(result.trim()); } catch { endpoint = null; }
  }
  localNamedPipe(endpoint);
  return endpoint;
}

/** All requests are pinned to the already-verified local pipe. Docker error
 * bodies and container configuration may contain credentials, so never log them. */
export function createDockerEngine(endpoint) {
  const socketPath = localNamedPipe(endpoint);
  return async function request(method, route, body, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({ socketPath, method, path: route, headers: payload ? {
        "content-type": "application/json", "content-length": Buffer.byteLength(payload),
      } : undefined }, (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) req.destroy(new VectorSetupError("Docker Engine response exceeded the safety limit."));
          else chunks.push(chunk);
        });
        response.on("error", () => req.destroy(new VectorSetupError("Could not read the local Docker Engine response.")));
        response.on("end", () => {
          clearTimeout(timer);
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const error = new VectorSetupError(`Local Docker Engine request failed (HTTP ${status}).`);
            error.status = status;
            reject(error);
            return;
          }
          const text = Buffer.concat(chunks).toString("utf8");
          try { resolve(text ? JSON.parse(text) : undefined); }
          catch { reject(new VectorSetupError("The local Docker Engine returned an invalid response.")); }
        });
      });
      const timer = setTimeout(() => req.destroy(new VectorSetupError("Local Docker Engine request timed out.")), timeoutMs);
      req.on("error", () => { clearTimeout(timer); reject(new VectorSetupError("Could not reach the local Docker Engine within the request timeout.")); });
      req.end(payload);
    });
  };
}

const containerRoute = (id, suffix = "") => `/containers/${encodeURIComponent(id)}${suffix}`;
async function inspect(engine, id) {
  try { return await engine("GET", containerRoute(id, "/json")); }
  catch (error) { if (error.status === 404) return null; throw error; }
}
async function remove(engine, id, force = false) {
  try { await engine("DELETE", containerRoute(id, `?force=${force}&v=false`)); }
  catch (error) { if (error.status !== 404) throw error; }
}

export function vectorReplacement(original, { projectId, workdir }) {
  const name = `supabase_vector_${projectId}`;
  const network = `supabase_network_${projectId}`;
  const config = original.Config ?? {};
  const host = original.HostConfig ?? {};
  const labels = config.Labels ?? {};
  const sameWorkdir = typeof labels["com.supabase.cli.workdir"] === "string"
    && path.win32.resolve(labels["com.supabase.cli.workdir"]).toLowerCase() === path.win32.resolve(workdir).toLowerCase();
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId) || original.Name !== `/${name}`
    || labels["com.supabase.cli.project"] !== projectId || !sameWorkdir
    || (labels["com.docker.compose.project"] && labels["com.docker.compose.project"] !== projectId)) {
    throw new VectorSetupError("Vector container does not match this project's identity and work directory. No containers were changed.");
  }
  const networks = original.NetworkSettings?.Networks ?? {};
  const endpoint = networks[network];
  const mounts = original.Mounts ?? [];
  const binds = host.Binds ?? [];
  const socketMounted = mounts.length === 1 && mounts[0].Type === "bind"
    && mounts[0].Source === socket && mounts[0].Destination === socket && mounts[0].RW === false;
  const env = config.Env ?? [];
  const dockerHosts = env.filter((value) => value.startsWith("DOCKER_HOST="));
  const unsupportedHostConfig = Object.entries(host).some(([key, value]) => key !== "Binds"
    && !preservedHostFields.includes(key) && !isDefaultHostValue(value));
  if (!/^((public\.ecr\.aws\/supabase)|timberio)\/vector:[\w.-]+$/.test(config.Image ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(original.Image ?? "")
    || dockerHosts.length !== 1 || ![sourceHost, socketHost].includes(dockerHosts[0].slice(12))
    || (mounts.length && !socketMounted) || binds.some((bind) => bind !== socketBind) || binds.length > 1
    || host.Mounts?.length || host.VolumesFrom?.length || Object.keys(config.Volumes ?? {}).length
    || host.Privileged || host.CapAdd?.length || host.Devices?.length || host.DeviceRequests?.length
    || host.SecurityOpt?.length || host.ExtraHosts?.length || host.Dns?.length || host.DnsSearch?.length || host.DnsOptions?.length
    || host.GroupAdd?.length || host.PidMode || host.UTSMode || host.UsernsMode
    || host.PublishAllPorts || Object.keys(host.PortBindings ?? {}).length
    || host.NetworkMode !== network || Object.keys(networks).length !== 1 || !endpoint
    || (endpoint.IPAMConfig && Object.keys(endpoint.IPAMConfig).length) || endpoint.Links?.length
    || (endpoint.DriverOpts && Object.keys(endpoint.DriverOpts).length) || unsupportedHostConfig) {
    throw new VectorSetupError("Vector has an unexpected image, transport, mount, or network configuration. No containers were changed.");
  }
  const replacement = structuredClone(config);
  replacement.Env = [...env.filter((value) => !value.startsWith("DOCKER_HOST=")), `DOCKER_HOST=${socketHost}`];
  replacement.Labels = { ...labels, [repairLabel]: "1" };
  const hostConfig = {};
  for (const key of preservedHostFields) {
    if (host[key] !== undefined) hostConfig[key] = structuredClone(host[key]);
  }
  hostConfig.Binds = [socketBind];
  return {
    configured: dockerHosts[0] === `DOCKER_HOST=${socketHost}` && socketMounted && binds.length === 1,
    body: { ...replacement, HostConfig: hostConfig, NetworkingConfig: { EndpointsConfig: {
      [network]: { Aliases: [...(endpoint.Aliases ?? [])] },
    } } },
  };
}

export async function probeVectorSocket(engine, imageId, probeName = `lift-log-vector-socket-probe-${randomUUID()}`) {
  let created = false;
  try {
    const probe = await engine("POST", `/containers/create?name=${encodeURIComponent(probeName)}`, {
      Image: imageId, Entrypoint: ["/bin/sh"], Cmd: ["-c", `test -S ${socket}`],
      Labels: { [repairLabel]: "probe" },
      HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, Binds: [socketBind] },
    });
    created = true;
    await engine("POST", containerRoute(probe.Id, "/start"));
    const result = await engine("POST", containerRoute(probe.Id, "/wait?condition=not-running"));
    if (result.StatusCode !== 0) throw new VectorSetupError("Docker Desktop's private socket could not be mounted. The existing Vector container was not changed.");
  } finally {
    // A failed create is not evidence that an existing container belongs to us.
    if (created) await remove(engine, probeName, true);
  }
}

async function waitHealthy(engine, id, { now, delay, healthTimeoutMs, stableMs }) {
  const deadline = now() + healthTimeoutMs;
  let healthySince = null;
  let restarts = null;
  while (now() < deadline) {
    const state = await engine("GET", containerRoute(id, "/json"), undefined, Math.max(1, Math.min(5_000, deadline - now())));
    const healthy = state.State?.Running && !state.State.Restarting && state.State.Health?.Status === "healthy";
    if (healthy && (restarts === null || restarts === state.RestartCount)) {
      healthySince ??= now();
      if (now() - healthySince >= stableMs) return;
    } else healthySince = null;
    restarts = state.RestartCount;
    await delay(Math.min(2_000, Math.max(0, deadline - now())));
  }
  throw new VectorSetupError("Vector did not remain healthy within the startup timeout.");
}

export async function ensureLocalVector({ endpoint, projectId, workdir, engine = createDockerEngine(endpoint), check = false,
  now = Date.now, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), healthTimeoutMs = 60_000, stableMs = 10_000,
  probe = probeVectorSocket,
} = {}) {
  localNamedPipe(endpoint);
  const info = await engine("GET", "/info");
  if (info.OSType !== "linux") throw new VectorSetupError("Vector repair requires the local Linux engine. No containers were changed.");
  const name = `supabase_vector_${projectId}`;
  const original = await inspect(engine, name);
  if (!original) throw new VectorSetupError("The project's Vector container was not found. Start Supabase before repairing local logging.");
  const replacement = vectorReplacement(original, { projectId, workdir });
  if (check) return { needsRepair: !replacement.configured, health: original.State?.Health?.Status ?? original.State?.Status };
  const health = { now, delay, healthTimeoutMs, stableMs };
  if (replacement.configured) {
    if (!original.State.Running) await engine("POST", containerRoute(original.Id, "/start"));
    await waitHealthy(engine, original.Id, health);
    return { changed: false };
  }
  const candidateName = `${name}-socket-candidate`;
  const backupName = `${name}-transport-backup`;
  if (await inspect(engine, candidateName) || await inspect(engine, backupName)) {
    throw new VectorSetupError("A previous Vector repair candidate or backup exists. Inspect those containers before retrying; the current container was not changed.");
  }
  await probe(engine, original.Image);
  // The fixed candidate name is an atomic Docker-enforced concurrency guard.
  // Only the invocation that creates it is allowed to stop the existing service.
  const candidate = await engine("POST", `/containers/create?name=${encodeURIComponent(candidateName)}`, replacement.body);
  let touchedOriginal = false;
  try {
    touchedOriginal = true;
    try { await engine("POST", containerRoute(original.Id, "/stop?t=5")); }
    catch (error) { if (error.status !== 304) throw error; }
    await engine("POST", containerRoute(original.Id, `/rename?name=${encodeURIComponent(backupName)}`));
    await engine("POST", containerRoute(candidate.Id, `/rename?name=${encodeURIComponent(name)}`));
    await engine("POST", containerRoute(candidate.Id, "/start"));
    await waitHealthy(engine, candidate.Id, health);
  } catch {
    try {
      await remove(engine, candidate.Id, true);
      // A timed-out rename may still have reached Docker. Inspect actual state
      // before restoring the name instead of relying on the last response.
      const preserved = await inspect(engine, original.Id);
      if (preserved?.Name === `/${backupName}`) await engine("POST", containerRoute(original.Id, `/rename?name=${encodeURIComponent(name)}`));
      else if (preserved?.Name !== `/${name}`) throw new VectorSetupError("Original Vector location changed during repair.");
      if (touchedOriginal) {
        try { await engine("POST", containerRoute(original.Id, "/start")); }
        catch (error) { if (error.status !== 304) throw error; }
      }
    } catch {
      throw new VectorSetupError("Vector repair failed and rollback needs attention. The original container was preserved; inspect the project's Vector and transport-backup containers. No database data was changed.");
    }
    throw new VectorSetupError("Vector repair failed. The original container name and running state were restored. No database data was changed.");
  }
  try { await remove(engine, original.Id); }
  catch { return { changed: true, backupRetained: true }; }
  return { changed: true };
}

async function main() {
  if (process.platform !== "win32") return;
  const workdir = process.cwd();
  const config = await readFile(path.join(workdir, "supabase", "config.toml"), "utf8");
  const projectId = config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"\s*$/m)?.[1];
  if (!projectId) throw new VectorSetupError("Could not determine the local Supabase project identity.");
  const analytics = config.match(/^\[analytics\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? "";
  if (/^enabled\s*=\s*false\s*$/m.test(analytics)) return;
  const endpoint = await resolveLocalVectorEndpoint();
  const check = process.argv.includes("--check");
  if (!check) {
    try { await ensureLocalDocker({ env: { ...process.env, DOCKER_CONTEXT: "", DOCKER_HOST: endpoint } }); }
    catch { throw new VectorSetupError("The local Docker engine is not ready. Run npm run db:start and check the guarded Desktop launcher output."); }
  }
  const result = await ensureLocalVector({ endpoint, projectId, workdir, check });
  if (check) process.stdout.write(`Local Vector: ${result.needsRepair ? "private socket repair needed" : "private socket configured"}; ${result.health}.\n`);
  else process.stdout.write(`Local Vector logging is healthy${result.changed ? " using Docker's private socket" : ""}.${result.backupRetained ? " The stopped transport backup was retained for inspection." : ""}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Only explicitly safe diagnostics may be printed; never serialize unknown
    // errors which might contain container configuration or transport bodies.
    process.stderr.write(`${error instanceof VectorSetupError ? error.message : "Local Vector logging setup did not complete. Run from the project directory and inspect Vector with --check before retrying."}\n`);
    process.exitCode = 1;
  });
}
