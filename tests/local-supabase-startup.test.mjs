import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { installedSupabaseBinary, isStartingDatabaseError, startLocalSupabase } from "../scripts/start-local-supabase.mjs";

const projectId = "lift-log-app";
const workdir = "C:\\Dev Projects\\lift-log-app";
const endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
const binary = "C:\\Dev Projects\\lift-log-app\\node_modules\\@supabase\\cli-windows-x64\\bin\\supabase.exe";
const result = (code = 0, stdout = "", stderr = "") => ({ code, stdout, stderr, timedOut: false });
const starting = (project = projectId, status = "starting") => result(1, JSON.stringify({ error: {
  code: "LegacyStatusDbNotReadyError", message: `supabase_db_${project} container is not ready: ${status}`,
} }));
const ready = result(0, JSON.stringify({ status: "running", service_role_key: "fake-private-key" }));
const plainStarting = result(1, "", `supabase start is already running.\r\nsupabase_db_${projectId} container is not ready: starting\r\nTry rerunning the command with --debug to troubleshoot the error.\r\n`);

function harness({ replies = [ready], env = {}, edgeEnabled = true, endpointValue = endpoint,
  edgeStatus = "running", mutateEdge, edgeCrashes = false, stall = false, timeoutMs = 120_000,
  dbExists = true, dbStatus = "running", dbHealth = ["healthy"], mutateDb, dbInspectStalls = false } = {}) {
  const calls = [], messages = [], verifications = [];
  let elapsed = 0, starts = 0, edgeStarted = false, dbInspections = 0;
  const db = { Id: "db-id", Name: `/supabase_db_${projectId}`,
    Config: { Labels: { "com.supabase.cli.project": projectId, "com.supabase.cli.workdir": workdir } },
    State: { Running: dbStatus === "running", Status: dbStatus, Restarting: false, Health: { Status: dbHealth[0] } },
  };
  mutateDb?.(db);
  const edge = { Id: "edge-id", Name: `/${"supabase_edge_runtime_" + projectId}`,
    Config: { Labels: { "com.supabase.cli.project": projectId, "com.supabase.cli.workdir": workdir }, Env: ["SECRET=fake-private-key"] },
    State: { Running: edgeStatus === "running", Status: edgeStatus, Restarting: false, Paused: false },
  };
  mutateEdge?.(edge);
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(verifications.length, 1, "Docker must be verified before any command");
    if (command === binary) {
      if (stall) { elapsed += options.timeout; return { ...result(1), timedOut: true }; }
      return replies[Math.min(starts++, replies.length - 1)];
    }
    if (args[0] === "context") return result(0, JSON.stringify(endpointValue));
    if (args.includes("ls")) return result(0, dbExists ? "0123456789ab\n" : "");
    if (args.includes("inspect")) {
      if (args.at(-1) === `supabase_db_${projectId}`) {
        if (dbInspectStalls) { elapsed += options.timeout; return { ...result(1), timedOut: true }; }
        db.State.Health.Status = dbHealth[Math.min(dbInspections++, dbHealth.length - 1)];
        return result(0, JSON.stringify([db]));
      }
      if (edgeCrashes && edgeStarted) edge.State = { Running: false, Status: "exited" };
      return result(0, JSON.stringify([edge]));
    }
    if (args.includes("start")) {
      edgeStarted = true;
      edge.State = { Running: true, Status: "running", Restarting: false, Paused: false };
      return result(0, "edge-id");
    }
    throw new Error("Unexpected command in startup test");
  };
  return { calls, messages, edge, db, get elapsed() { return elapsed; }, options: {
    projectId, workdir, binary, platform: "win32", env, edgeEnabled, timeoutMs, run,
    verifyDocker: async (value) => { verifications.push(value); },
    now: () => elapsed, delay: async (ms) => { elapsed += ms; }, log: (text) => messages.push(text),
  } };
}

test("uses the installed native Windows executable rather than a shell or Node shim", () => {
  const metadata = path.join(workdir, "node_modules", "@supabase", "cli-windows-x64", "package.json");
  const resolved = installedSupabaseBinary(workdir, { platform: "win32", arch: "x64", resolve: (name) => {
    assert.equal(name, "@supabase/cli-windows-x64/package.json");
    return metadata;
  }, exists: () => true });
  assert.equal(resolved, path.join(path.dirname(metadata), "bin", "supabase.exe"));
  assert.throws(() => installedSupabaseBinary(workdir, { platform: "win32", arch: "x64", resolve: () => metadata, exists: () => false }), /binary is missing/);
});

test("retries only this project's starting health error and then succeeds without printing keys", async () => {
  const subject = harness({ replies: [starting(), plainStarting, ready] });
  assert.deepEqual(await startLocalSupabase(subject.options), { attempts: 3 });
  const starts = subject.calls.filter((call) => call.command === binary);
  assert.equal(starts.length, 3);
  assert.deepEqual(starts[0].args, ["start", "--workdir", workdir, "--output", "json"]);
  for (const call of subject.calls.filter((call) => call.args[0] !== "context")) {
    assert.equal(call.options.env.DOCKER_HOST, endpoint);
    assert.equal(call.options.env.DOCKER_CONTEXT, "");
    assert.ok(call.options.timeout <= 60_000);
  }
  assert.equal(subject.messages.filter((message) => message.includes("still starting")).length, 1);
  assert.doesNotMatch(subject.messages.join("\n"), /fake-private-key|service_role_key/);
});

test("an indefinitely starting database stops at the total deadline", async () => {
  const subject = harness({ replies: [starting()], timeoutMs: 5_000 });
  await assert.rejects(startLocalSupabase(subject.options), /did not finish within|starting state/);
  assert.equal(subject.elapsed, 5_000);
  assert.equal(subject.calls.filter((call) => call.command === binary).length, 3);
  assert.equal(subject.calls.some((call) => call.args.includes("reset") || call.args.includes("stop")), false);
});

test("a stalled CLI command is bounded and is never blindly retried", async () => {
  const subject = harness({ stall: true });
  await assert.rejects(startLocalSupabase(subject.options), /command timeout/);
  assert.equal(subject.elapsed, 60_000);
  assert.equal(subject.calls.filter((call) => call.command === binary).length, 1);
});

test("nontransient errors, another project's starting state, and malformed output fail immediately", async () => {
  for (const failure of [
    starting(projectId, "unhealthy"), starting("other-project"), result(1, "fake-private-key"),
    result(1, JSON.stringify({ error: { code: "LegacyStartInvalidConfigError", message: "secret=fake-private-key" } })),
  ]) {
    const subject = harness({ replies: [failure, ready] });
    await assert.rejects(startLocalSupabase(subject.options), (error) => {
      assert.match(error.message, /No automatic retry|no automatic retry/);
      assert.doesNotMatch(error.message, /fake-private-key/);
      if (failure.stdout.includes("InvalidConfig")) assert.match(error.message, /LegacyStartInvalidConfigError.*config.toml/);
      return true;
    });
    assert.equal(subject.calls.filter((call) => call.command === binary).length, 1);
    assert.equal(subject.elapsed, 0);
  }
  assert.equal(isStartingDatabaseError(result(1, JSON.stringify({ code: "SomeOtherError", message: `supabase_db_${projectId} container is not ready: starting` })), projectId), false);
  for (const text of [
    `supabase_db_other-project container is not ready: starting`,
    `supabase_db_${projectId} container is not ready: unhealthy`,
    `failed: supabase_db_${projectId} container is not ready: starting`,
    `supabase_db_${projectId} container is not ready: starting extra details`,
  ]) assert.equal(isStartingDatabaseError(result(1, "", text), projectId), false);
});

test("waits for the verified existing database to become healthy before invoking the CLI", async () => {
  const subject = harness({ dbHealth: ["starting", "starting", "healthy"], edgeEnabled: false });
  await startLocalSupabase(subject.options);
  const startIndex = subject.calls.findIndex((call) => call.command === binary);
  assert.equal(subject.calls.slice(0, startIndex).filter((call) => call.args.at(-1) === `supabase_db_${projectId}`).length, 3);
  assert.equal(subject.calls.filter((call) => call.command === binary).length, 1);
  assert.equal(subject.elapsed, 2_000);
  assert.equal(subject.messages.filter((message) => message.includes("still starting")).length, 1);
});

test("an existing database startup deadline or stalled inspection prevents CLI startup", async () => {
  const subject = harness({ dbHealth: ["starting"], timeoutMs: 5_000 });
  await assert.rejects(startLocalSupabase(subject.options), /did not finish within/);
  assert.equal(subject.elapsed, 5_000);
  assert.equal(subject.calls.filter((call) => call.command === binary).length, 0);
  const stalled = harness({ dbInspectStalls: true });
  await assert.rejects(startLocalSupabase(stalled.options), /could not be verified/);
  assert.equal(stalled.elapsed, 5_000);
  assert.equal(stalled.calls.filter((call) => call.command === binary).length, 0);
});

test("does not wait for an absent or stopped database and leaves normal startup to the CLI", async () => {
  for (const options of [{ dbExists: false }, { dbStatus: "exited", dbHealth: ["starting"] }]) {
    const subject = harness({ ...options, edgeEnabled: false });
    assert.deepEqual(await startLocalSupabase(subject.options), { attempts: 1 });
    assert.equal(subject.elapsed, 0);
    assert.equal(subject.calls.some((call) => call.command === "docker" && call.args.includes("start")), false);
  }
});

test("foreign, mismatched, or unhealthy databases fail before the CLI can change any services", async () => {
  for (const options of [
    { mutateDb: (db) => { db.Config.Labels["com.supabase.cli.project"] = "other"; } },
    { mutateDb: (db) => { db.Config.Labels["com.supabase.cli.workdir"] = "C:\\Elsewhere"; } },
    { dbHealth: ["unhealthy"] },
  ]) {
    const subject = harness(options);
    await assert.rejects(startLocalSupabase(subject.options), /could not be verified|is unhealthy/);
    assert.equal(subject.calls.filter((call) => call.command === binary).length, 0);
    assert.equal(subject.calls.some((call) => call.command === "docker" && call.args.includes("start")), false);
  }
});

test("rejects invalid project identity, remote overrides and remote contexts before starting Supabase", async () => {
  const invalid = harness();
  await assert.rejects(startLocalSupabase({ ...invalid.options, projectId: "../other" }), /valid local Supabase project/);
  assert.equal(invalid.calls.length, 0);
  const remote = harness({ env: { DOCKER_HOST: "tcp://remote:2375", DOCKER_CONTEXT: "desktop-linux" } });
  await assert.rejects(startLocalSupabase(remote.options), /remote Docker override/);
  assert.equal(remote.calls.length, 0);
  const context = harness({ endpointValue: "ssh://remote" });
  await assert.rejects(startLocalSupabase(context.options), /local Docker endpoint/);
  assert.equal(context.calls.filter((call) => call.command === binary).length, 0);
});

test("restores only a verified stopped edge runtime without changing its configuration", async () => {
  const subject = harness({ edgeStatus: "exited" });
  const before = structuredClone(subject.edge.Config);
  await startLocalSupabase(subject.options);
  const restores = subject.calls.filter((call) => call.command === "docker" && call.args.includes("start"));
  assert.equal(restores.length, 1);
  assert.deepEqual(restores[0].args, ["--host", endpoint, "start", "edge-id"]);
  assert.deepEqual(subject.edge.Config, before);
  assert.ok(subject.elapsed >= 3_000);
  assert.equal(subject.calls.some((call) => call.args.includes("update") || call.args.includes("create") || call.args.includes("rm")), false);
});

test("never touches disabled, foreign or mismatched edge runtime containers", async () => {
  const disabled = harness({ edgeEnabled: false, edgeStatus: "exited" });
  await startLocalSupabase(disabled.options);
  assert.equal(disabled.calls.some((call) => call.args.at(-1) === `supabase_edge_runtime_${projectId}`), false);
  for (const mutateEdge of [
    (edge) => { edge.Config.Labels["com.supabase.cli.project"] = "other"; },
    (edge) => { edge.Config.Labels["com.supabase.cli.workdir"] = "C:\\Elsewhere"; },
  ]) {
    const subject = harness({ edgeStatus: "exited", mutateEdge });
    await assert.rejects(startLocalSupabase(subject.options), /could not be verified/);
    assert.equal(subject.calls.some((call) => call.command === "docker" && call.args.includes("start")), false);
  }
});

test("an edge runtime crash fails clearly after one start instead of entering a restart loop", async () => {
  const subject = harness({ edgeStatus: "exited", edgeCrashes: true });
  await assert.rejects(startLocalSupabase(subject.options), /did not stay running/);
  assert.equal(subject.calls.filter((call) => call.command === "docker" && call.args.includes("start")).length, 1);
});
