import assert from "node:assert/strict";
import test from "node:test";
import { ensureLocalVector, localNamedPipe, resolveLocalVectorEndpoint } from "../scripts/ensure-local-vector.mjs";

const endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
const projectId = "lift-log-app";
const workdir = "C:\\Dev Projects\\lift-log-app";
const name = `supabase_vector_${projectId}`;
const network = `supabase_network_${projectId}`;
const imageId = `sha256:${"a".repeat(64)}`;
const statusError = (status, message = "engine detail containing fake-private-key") => Object.assign(new Error(message), { status });

function fixture() {
  return {
    Id: "original-id", Name: `/${name}`, Image: imageId, RestartCount: 8,
    Config: {
      Image: "public.ecr.aws/supabase/vector:0.53.0-alpine", Entrypoint: ["sh"],
      Cmd: ["-c", "original generated config with fake-private-key; exec vector --config /etc/vector/vector.yaml"],
      Env: ["OTHER=preserved", "DOCKER_HOST=http://host.docker.internal:2375"],
      Labels: { "com.supabase.cli.project": projectId, "com.docker.compose.project": projectId, "com.supabase.cli.workdir": workdir },
      Healthcheck: { Test: ["CMD", "wget", "http://127.0.0.1:9001/health"], Interval: 10_000_000_000 },
    },
    HostConfig: { NetworkMode: network, RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 }, LogConfig: { Type: "json-file", Config: {} }, Binds: null, PortBindings: {}, Memory: 128 * 1024 * 1024, Privileged: false },
    Mounts: [],
    NetworkSettings: { Networks: { [network]: { Aliases: ["vector"], IPAddress: "172.1.0.20", EndpointID: "dynamic-endpoint", NetworkID: "dynamic-network", MacAddress: "00:00:00:00:00:00", IPAMConfig: null } } },
    State: { Running: true, Restarting: true, Status: "restarting", Health: { Status: "unhealthy" } },
  };
}

function harness({ original = fixture(), fault, probeExit = 0, unhealthy = false, unstable = false } = {}) {
  const containers = new Map([[original.Id, structuredClone(original)]]);
  const calls = [];
  let elapsed = 0;
  let sequence = 0;
  const locate = (id) => [...containers.values()].find((value) => value.Id === id || value.Name === `/${id}`);
  const engine = async (method, route, body) => {
    const call = { method, route, body: body && structuredClone(body) };
    calls.push(call);
    const failure = fault?.(call, { containers, locate });
    if (failure) throw failure;
    const url = new URL(route, "http://local");
    if (route === "/info") return { OSType: "linux" };
    if (route.startsWith("/containers/create")) {
      const containerName = url.searchParams.get("name");
      if (locate(containerName)) throw statusError(409);
      const id = `new-${++sequence}`;
      const { HostConfig, NetworkingConfig, ...Config } = structuredClone(body);
      const item = { Id: id, Name: `/${containerName}`, Image: imageId, Config, HostConfig,
        NetworkSettings: { Networks: NetworkingConfig?.EndpointsConfig ?? {} },
        Mounts: (HostConfig.Binds ?? []).map(() => ({ Type: "bind", Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock", RW: false })),
        State: { Running: false, Restarting: false, Status: "created", Health: { Status: "starting" } }, RestartCount: 0,
      };
      containers.set(id, item);
      return { Id: id };
    }
    const [, , encodedId, action] = url.pathname.split("/");
    const item = locate(decodeURIComponent(encodedId));
    if (!item) throw statusError(404);
    if (method === "DELETE") {
      if (item.State.Running && url.searchParams.get("force") !== "true") throw statusError(409);
      containers.delete(item.Id);
      return;
    }
    if (action === "json") {
      const result = structuredClone(item);
      if (unstable && item.Id !== original.Id && elapsed > 0) {
        result.RestartCount = 1;
        result.State.Health.Status = "unhealthy";
      }
      return result;
    }
    if (action === "start") {
      item.State = { Running: true, Restarting: false, Status: "running", Health: { Status: unhealthy && item.Id !== original.Id ? "unhealthy" : "healthy" } };
      return;
    }
    if (action === "stop") { item.State.Running = false; item.State.Status = "exited"; return; }
    if (action === "rename") {
      if (locate(url.searchParams.get("name"))) throw statusError(409);
      item.Name = `/${url.searchParams.get("name")}`;
      return;
    }
    if (action === "wait") { item.State.Running = false; return { StatusCode: probeExit }; }
    throw new Error("Unexpected fake Engine request");
  };
  return { calls, containers, locate, options: { endpoint, projectId, workdir, engine,
    now: () => elapsed, delay: async (ms) => { elapsed += ms; }, healthTimeoutMs: 12_000, stableMs: 4_000,
  } };
}

test("pins API access to local Windows named pipes and rejects overrides before API use", async () => {
  assert.equal(localNamedPipe(endpoint), "\\\\.\\pipe\\dockerDesktopLinuxEngine");
  for (const remote of ["ssh://host", "tcp://127.0.0.1:2375", "npipe:////other/pipe/docker_engine", "npipe:////./pipe/unrelated"]) {
    const subject = harness();
    await assert.rejects(ensureLocalVector({ ...subject.options, endpoint: remote }), /local Docker Desktop named pipe/);
    assert.equal(subject.calls.length, 0);
  }
  let runs = 0;
  await assert.rejects(resolveLocalVectorEndpoint({ DOCKER_HOST: "tcp://remote:2375", DOCKER_CONTEXT: "desktop-linux" }, async () => { runs++; }), /local Docker Desktop named pipe/);
  assert.equal(runs, 0);
  const actual = await resolveLocalVectorEndpoint({ DOCKER_CONTEXT: "desktop-linux" }, async (args) => {
    assert.deepEqual(args.slice(0, 3), ["context", "inspect", "desktop-linux"]);
    return JSON.stringify(endpoint);
  });
  assert.equal(actual, endpoint);
});

test("check mode and rejected identities perform no mutations", async () => {
  const check = harness();
  assert.deepEqual(await ensureLocalVector({ ...check.options, check: true }), { needsRepair: true, health: "unhealthy" });
  assert.equal(check.calls.every((call) => call.method === "GET"), true);
  for (const change of [
    (item) => { item.Config.Labels["com.supabase.cli.project"] = "another-project"; },
    (item) => { item.Config.Labels["com.supabase.cli.workdir"] = "C:\\Elsewhere"; },
    (item) => { item.Mounts = [{ Type: "bind", Source: "C:\\", Destination: "/host", RW: true }]; },
    (item) => { item.HostConfig.Privileged = true; },
    (item) => { item.HostConfig.Tmpfs = { "/extra": "size=10m" }; },
    (item) => { item.NetworkSettings.Networks.other = {}; },
    (item) => { item.Config.Image = "untrusted/vector:latest"; },
  ]) {
    const original = fixture(); change(original);
    const subject = harness({ original });
    await assert.rejects(ensureLocalVector(subject.options), /does not match|unexpected/);
    assert.equal(subject.calls.every((call) => call.method === "GET"), true);
    assert.equal(subject.containers.size, 1);
  }
});

test("replacement preserves generated config and constraints, probes first, and omits dynamic network identities", async () => {
  const subject = harness();
  assert.deepEqual(await ensureLocalVector(subject.options), { changed: true });
  const current = subject.locate(name);
  assert.notEqual(current.Id, "original-id");
  assert.deepEqual(current.Config.Cmd, fixture().Config.Cmd);
  assert.deepEqual(current.Config.Healthcheck, fixture().Config.Healthcheck);
  assert.equal(current.HostConfig.Memory, fixture().HostConfig.Memory);
  assert.deepEqual(current.HostConfig.RestartPolicy, fixture().HostConfig.RestartPolicy);
  assert.deepEqual(current.Config.Env, ["OTHER=preserved", "DOCKER_HOST=unix:///var/run/docker.sock"]);
  assert.deepEqual(current.HostConfig.Binds, ["/var/run/docker.sock:/var/run/docker.sock:ro"]);
  assert.deepEqual(current.NetworkSettings.Networks, { [network]: { Aliases: ["vector"] } });
  assert.equal(subject.containers.size, 1, "probe and old backup are removed after stable health");
  const probeWait = subject.calls.findIndex((call) => call.route.includes("/wait?"));
  const oldStop = subject.calls.findIndex((call) => call.route.includes("original-id/stop"));
  assert.ok(probeWait < oldStop);
  assert.equal(subject.calls.some((call) => call.method === "DELETE" && !call.route.includes("v=false")), false);
  const before = subject.calls.length;
  assert.deepEqual(await ensureLocalVector(subject.options), { changed: false });
  assert.equal(subject.calls.slice(before).every((call) => call.method === "GET"), true, "repeat startup only verifies health");
});

test("a failed socket probe cleans itself up and never stops the existing service", async () => {
  const subject = harness({ probeExit: 1 });
  await assert.rejects(ensureLocalVector(subject.options), /private socket could not be mounted/);
  assert.equal(subject.calls.some((call) => call.route.includes("original-id/stop")), false);
  assert.equal(subject.containers.size, 1);
  assert.equal(subject.locate(name).Id, "original-id");
});

test("candidate name conflicts stop concurrent repairs before the existing service is changed", async () => {
  const subject = harness({ fault: ({ route }) => route.includes("create?name=") && route.endsWith("socket-candidate") ? statusError(409) : null });
  await assert.rejects(ensureLocalVector(subject.options));
  assert.equal(subject.calls.some((call) => call.route.includes("original-id/stop")), false);
  assert.equal(subject.containers.size, 1);
});

test("failed start, failed rename, and unstable health restore and restart the original without leaking Engine details", async () => {
  for (const failure of ["start", "rename", "health"]) {
    let failed = false;
    const subject = harness({ unstable: failure === "health", fault: ({ method, route }, { locate }) => {
      const id = decodeURIComponent(new URL(route, "http://local").pathname.split("/")[2] ?? "");
      if (failed || method !== "POST" || id === "original-id" || !locate(id) || locate(id).Config.Labels?.["dev.lift-log.vector-socket-repair"] === "probe") return;
      if ((failure === "start" && route.endsWith("/start")) || (failure === "rename" && route.includes("/rename?"))) {
        failed = true;
        return statusError(500);
      }
    } });
    await assert.rejects(ensureLocalVector(subject.options), (error) => {
      assert.match(error.message, /original container name and running state were restored/);
      assert.doesNotMatch(error.message, /fake-private-key/);
      return true;
    });
    assert.equal(subject.locate(name).Id, "original-id");
    assert.equal(subject.locate(name).State.Running, true);
    assert.equal(subject.containers.size, 1);
    assert.deepEqual(subject.locate(name).Config, fixture().Config);
  }
});

test("a healthy replacement stays running if removal of its stopped backup fails", async () => {
  const subject = harness({ fault: ({ method, route }) => method === "DELETE" && route.includes("original-id?") ? statusError(409) : null });
  assert.deepEqual(await ensureLocalVector(subject.options), { changed: true, backupRetained: true });
  assert.equal(subject.locate(name).State.Running, true);
  assert.equal(subject.locate(`${name}-transport-backup`).State.Running, false);
  const before = subject.calls.length;
  await ensureLocalVector(subject.options);
  assert.equal(subject.calls.slice(before).every((call) => call.method === "GET"), true);
});

test("rollback restores the actual name when Docker applied a rename but its response was lost", async () => {
  let failed = false;
  const subject = harness({ fault: ({ route }, { locate }) => {
    if (!failed && route.includes("original-id/rename?")) {
      failed = true;
      locate("original-id").Name = `/${name}-transport-backup`;
      return statusError(500);
    }
  } });
  await assert.rejects(ensureLocalVector(subject.options), /original container name and running state were restored/);
  assert.equal(subject.locate(name).Id, "original-id");
  assert.equal(subject.locate(name).State.Running, true);
  assert.equal(subject.containers.size, 1);
});

test("an interrupted prior repair fails closed without overwriting its containers", async () => {
  const subject = harness();
  subject.containers.set("prior", { ...fixture(), Id: "prior", Name: `/${name}-transport-backup` });
  await assert.rejects(ensureLocalVector(subject.options), /previous Vector repair/);
  assert.equal(subject.calls.every((call) => call.method === "GET"), true);
  assert.equal(subject.containers.size, 2);
});
