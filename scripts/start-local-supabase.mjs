import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { ensureLocalDocker, isLocalDockerEndpoint } from "./ensure-local-docker.mjs";

class LocalStartupError extends Error {}
const maxStartupMs = 120_000;
const cliCommandMs = 60_000;
const dockerCommandMs = 5_000;

export function installedSupabaseBinary(workdir, {
  platform = process.platform, arch = process.arch,
  resolve = createRequire(path.join(workdir, "package.json")).resolve,
  exists = existsSync,
} = {}) {
  const platforms = { win32: ["windows"], darwin: ["darwin"], linux: ["linux", "linux-musl"] };
  if (!platforms[platform] || !["x64", "arm64"].includes(arch)) throw new LocalStartupError("This platform is not supported by the installed Supabase CLI.");
  for (const variant of platforms[platform]) {
    const suffix = variant === "linux-musl" ? `linux-${arch}-musl` : `${variant}-${arch}`;
    try {
      const metadata = resolve(`@supabase/cli-${suffix}/package.json`);
      const binary = path.join(path.dirname(metadata), "bin", platform === "win32" ? "supabase.exe" : "supabase");
      if (exists(binary)) return binary;
    } catch { /* Try the next installed platform package. */ }
  }
  throw new LocalStartupError("The project's Supabase CLI binary is missing. Run npm install in the project directory, then retry npm run db:start.");
}

function execute(command, args, options) {
  return new Promise((resolve) => {
    execFile(command, args, { ...options, encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr, timedOut: Boolean(error?.killed) });
    });
  });
}

export function cliError(stdout = "", stderr = "") {
  for (const output of [stderr, stdout]) {
    const text = stripVTControlCharacters(output).trim();
    for (const candidate of [text, ...text.split(/\r?\n/).filter((line) => line.startsWith("{"))]) {
      try {
        const payload = JSON.parse(candidate);
        const error = payload.error ?? payload;
        if (typeof error.code === "string" && typeof error.message === "string") return error;
      } catch { /* Progress lines are not structured error responses. */ }
    }
  }
  return null;
}

export function isStartingDatabaseError(result, projectId) {
  const error = cliError(result.stdout, result.stderr);
  const message = `supabase_db_${projectId} container is not ready: starting`;
  if (error) return error.code === "LegacyStatusDbNotReadyError" && error.message === message;
  // The native CLI's legacy start command can emit plain text even with
  // --output json. Match the complete observed diagnostic, never a substring.
  return [result.stdout, result.stderr].some((output) => stripVTControlCharacters(output ?? "")
    .split(/\r?\n/).some((line) => line.trim() === message));
}

function startupFailure(result, projectId) {
  if (result.timedOut) return new LocalStartupError("Supabase start exceeded its command timeout. Inspect the local containers before retrying; no automatic retry or database reset was attempted.");
  const error = cliError(result.stdout, result.stderr);
  if (error?.code === "LegacyStatusDbNotReadyError") {
    return new LocalStartupError(`The local database did not report a recoverable startup state. Inspect supabase_db_${projectId} health and logs; no automatic retry was attempted.`);
  }
  const code = typeof error?.code === "string" && /^[A-Za-z][A-Za-z0-9]{1,79}$/.test(error.code) ? ` (${error.code})` : "";
  const hint = error?.code?.includes("Config") ? "Check supabase/config.toml and its local environment settings." : "Check the local Supabase configuration and Docker container logs.";
  // CLI JSON also contains keys, URLs and sometimes SQL. Surface only its
  // bounded error identifier and our own guidance, never raw output/messages.
  return new LocalStartupError(`Supabase start failed${code}. ${hint} No automatic retry was attempted.`);
}

export async function startLocalSupabase({
  projectId, workdir, edgeEnabled = true, platform = process.platform, env = process.env,
  binary, run = execute, verifyDocker = ensureLocalDocker,
  now = Date.now, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (message) => process.stdout.write(`${message}\n`), timeoutMs = maxStartupMs, edgeStableMs = 3_000,
} = {}) {
  const paths = platform === "win32" ? path.win32 : path;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId ?? "") || !paths.isAbsolute(workdir ?? "")) {
    throw new LocalStartupError("A valid local Supabase project identity and absolute work directory are required. No startup command was run.");
  }
  if (env.DOCKER_HOST && !isLocalDockerEndpoint(env.DOCKER_HOST)) throw new LocalStartupError("Local Supabase startup rejected a remote Docker override. No startup command was run.");
  try { await verifyDocker({ env }); }
  catch { throw new LocalStartupError("The local Docker engine is not ready. Check the guarded Docker launcher before retrying npm run db:start."); }
  const deadline = now() + timeoutMs;
  const command = async (executable, args, commandLimit, commandEnv = env) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new LocalStartupError("Local Supabase startup did not finish within 120 seconds. Inspect the local container health before retrying; no database reset was performed.");
    return run(executable, args, { env: commandEnv, cwd: workdir, timeout: Math.min(commandLimit, remaining) });
  };
  let endpoint = env.DOCKER_CONTEXT ? null : env.DOCKER_HOST;
  if (!endpoint) {
    const context = await command("docker", ["context", "inspect", ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []), "--format", "{{json .Endpoints.docker.Host}}"], dockerCommandMs);
    if (context.code !== 0) throw new LocalStartupError("Could not inspect the current Docker context. No Supabase startup command was run.");
    try { endpoint = JSON.parse(context.stdout.trim()); } catch { endpoint = null; }
  }
  if (!isLocalDockerEndpoint(endpoint)) throw new LocalStartupError("Local Supabase startup requires a local Docker endpoint. No Supabase startup command was run.");
  const pinnedEnv = { ...env, DOCKER_HOST: endpoint, DOCKER_CONTEXT: "" };
  const executable = binary ?? installedSupabaseBinary(workdir, { platform });
  const belongsToProject = (item, name) => {
    const labels = item?.Config?.Labels ?? {};
    const labelWorkdir = labels["com.supabase.cli.workdir"];
    const sameWorkdir = typeof labelWorkdir === "string" && (platform === "win32"
      ? paths.resolve(labelWorkdir).toLowerCase() === paths.resolve(workdir).toLowerCase()
      : paths.resolve(labelWorkdir) === paths.resolve(workdir));
    return item?.Name === `/${name}` && labels["com.supabase.cli.project"] === projectId && sameWorkdir
      && (!labels["com.docker.compose.project"] || labels["com.docker.compose.project"] === projectId);
  };
  const inspectContainer = async (name) => {
    const result = await command("docker", ["--host", endpoint, "inspect", name], dockerCommandMs, pinnedEnv);
    try { return result.code === 0 ? JSON.parse(result.stdout)[0] : null; } catch { return null; }
  };
  log("Starting the local Supabase services…");
  // Desktop reports engine readiness before restart-policy containers finish
  // their own health checks. Inspect only the exact local project database;
  // an absent or stopped database is left to the normal CLI start command.
  const dbName = `supabase_db_${projectId}`;
  const listed = await command("docker", ["--host", endpoint, "container", "ls", "--all", "--filter", `name=^/${dbName}$`, "--format", "{{.ID}}"], dockerCommandMs, pinnedEnv);
  if (listed.code !== 0 || !/^(?:[a-f0-9]{12,64})?$/.test(listed.stdout.trim())) {
    throw new LocalStartupError("Could not inspect the existing local database. No Supabase startup command was run.");
  }
  if (listed.stdout.trim()) {
    let dbId;
    let waitingForDb = false;
    while (true) {
      const db = await inspectContainer(dbName);
      if (!belongsToProject(db, dbName) || (dbId && db.Id !== dbId)) {
        throw new LocalStartupError("The existing database could not be verified for this project and work directory. No Supabase startup command was run.");
      }
      dbId ??= db.Id;
      if (db.State?.Health?.Status === "unhealthy") {
        throw new LocalStartupError("The local database is unhealthy. Inspect its health and logs before retrying; no Supabase startup command was run.");
      }
      if (db.State?.Health?.Status !== "starting" || (!db.State.Running && !db.State.Restarting)) break;
      if (!waitingForDb) { log("The existing local database is still starting; waiting for its health check…"); waitingForDb = true; }
      await delay(Math.min(1_000, Math.max(0, deadline - now())));
    }
  }
  let attempts = 0;
  let waiting = false;
  while (true) {
    attempts++;
    const result = await command(executable, ["start", "--workdir", workdir, "--output", "json"], cliCommandMs, pinnedEnv);
    if (result.code === 0) break;
    if (result.timedOut || !isStartingDatabaseError(result, projectId)) throw startupFailure(result, projectId);
    if (!waiting) { log("The local database is still starting; waiting for its health check…"); waiting = true; }
    const remaining = deadline - now();
    if (remaining <= 0) throw new LocalStartupError("The local database stayed in its starting state for 120 seconds. Inspect its health and logs before retrying; no database reset was performed.");
    await delay(Math.min(2_000, remaining));
  }
  if (edgeEnabled) {
    const name = `supabase_edge_runtime_${projectId}`;
    const inspectEdge = async () => {
      const item = await inspectContainer(name);
      if (!belongsToProject(item, name)) {
        throw new LocalStartupError("The enabled edge runtime could not be verified for this project and work directory. Inspect its local container before retrying; no container was changed.");
      }
      return item;
    };
    let edge = await inspectEdge();
    const edgeId = edge.Id;
    if (["exited", "created"].includes(edge.State.Status)) {
      log("Restoring the existing local edge runtime…");
      const started = await command("docker", ["--host", endpoint, "start", edgeId], dockerCommandMs, pinnedEnv);
      if (started.code !== 0) throw new LocalStartupError("The existing edge runtime could not be started. Inspect its local container logs; its configuration was not changed.");
    }
    let stableSince = null;
    while (true) {
      edge = await inspectEdge();
      if (edge.Id !== edgeId) throw new LocalStartupError("The edge runtime container changed during startup. Inspect local services before retrying.");
      if (edge.State.Running && !edge.State.Restarting && !edge.State.Paused) {
        stableSince ??= now();
        if (now() - stableSince >= edgeStableMs) break;
      } else if (["exited", "dead", "paused"].includes(edge.State.Status)) {
        throw new LocalStartupError("The edge runtime did not stay running. Inspect its local container logs; no repeated restart was attempted.");
      } else stableSince = null;
      await delay(Math.min(1_000, Math.max(0, deadline - now())));
    }
  }
  log("Local Supabase services are ready.");
  return { attempts };
}

async function main() {
  const workdir = process.cwd();
  const config = await readFile(path.join(workdir, "supabase", "config.toml"), "utf8");
  const projectId = config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"\s*$/m)?.[1];
  const edge = config.match(/^\[edge_runtime\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? "";
  await startLocalSupabase({ projectId, workdir, edgeEnabled: !/^enabled\s*=\s*false\s*$/m.test(edge) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof LocalStartupError ? error.message : "Local Supabase startup failed. Check the project directory, installed CLI, and local Docker state before retrying."}\n`);
    process.exitCode = 1;
  });
}
