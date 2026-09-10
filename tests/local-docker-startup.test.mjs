import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ensureLocalDocker, isLocalDockerEndpoint } from "../scripts/ensure-local-docker.mjs";

const localPipe = "npipe:////./pipe/dockerDesktopLinuxEngine";
const windowsEnv = { ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\O'Brien\\AppData\\Local", SystemRoot: "C:\\Windows" };
const result = (stdout = "", code = 0) => ({ stdout, stderr: "", code });

function harness({ platform = "win32", env = windowsEnv, endpoint = localPipe, readyAt = 0, timeoutMs = 120_000, exists = () => true, reply } = {}) {
  const calls = [];
  const messages = [];
  let elapsed = 0;
  const run = async (command, args, options) => {
    const call = { command, args, options };
    calls.push(call);
    if (reply) {
      const response = reply(call, () => { elapsed += options.timeout; });
      if (response) return response;
    }
    if (args.includes("inspect")) return result(JSON.stringify(endpoint));
    if (args.includes("info")) return elapsed >= readyAt ? result("linux\n") : result("", 1);
    if (command.endsWith("powershell.exe")) return result();
    throw new Error("Unexpected command in test");
  };
  return { calls, messages, get elapsed() { return elapsed; }, options: {
    platform, env, run, exists, now: () => elapsed,
    delay: async (ms) => { elapsed += ms; }, log: (message) => messages.push(message), timeoutMs,
  } };
}

test("accepts local pipes, absolute Unix sockets and loopback TCP only", () => {
  for (const endpoint of [localPipe, "npipe:////./pipe/docker_engine", "unix:///var/run/docker.sock", "unix:///home/me/.docker/desktop/docker.sock", "tcp://localhost:2375", "tcp://127.0.0.2:2375", "tcp://[::1]:2376"]) {
    assert.equal(isLocalDockerEndpoint(endpoint), true, endpoint);
  }
  for (const endpoint of [null, "", "ssh://server", "tcp://docker.example:2375", "tcp://127.999.0.1:2375", "tcp://127.0.0.1.example:2375", "tcp://user:secret@localhost:2375", "tcp://192.168.1.4:2375", "npipe:////server/pipe/docker_engine", "unix://server/var/run/docker.sock", "unix:relative.sock", "http://127.1:2375", "http://2130706433:2375", "http://0x7f000001:2375"]) {
    assert.equal(isLocalDockerEndpoint(endpoint), false, String(endpoint));
  }
});

test("an already-ready local engine needs no Desktop launch or waiting", async () => {
  const subject = harness();
  assert.deepEqual(await ensureLocalDocker(subject.options), { startedDesktop: false });
  assert.equal(subject.messages.length, 0);
  assert.equal(subject.elapsed, 0);
  assert.equal(subject.calls.filter(({ args }) => args.includes("info")).length, 1);
  assert.equal(subject.calls.some(({ command }) => command.endsWith("powershell.exe")), false);
});

test("starts Windows Desktop hidden once and waits for a responsive Linux engine", async () => {
  const subject = harness({ readyAt: 4_000, exists: (file) => file.includes("AppData") });
  assert.deepEqual(await ensureLocalDocker(subject.options), { startedDesktop: true });
  assert.equal(subject.elapsed, 4_000);
  assert.equal(subject.messages.length, 1);
  const launches = subject.calls.filter(({ command }) => command.endsWith("powershell.exe"));
  assert.equal(launches.length, 1);
  assert.ok(launches[0].args.includes("-File"));
  assert.match(launches[0].args.at(-1), /start-docker-desktop\.ps1$/);
  assert.equal(launches[0].args.includes("-ExecutionPolicy"), false);
  assert.equal(subject.calls.every(({ options }) => options.timeout <= 5_000), true);
  assert.equal(subject.calls.filter(({ args }) => args.includes("info")).every(({ args }) => args[0] === "--host" && args[1] === localPipe), true);
});

test("rejects a remote context before any daemon probe or Desktop launch", async () => {
  const subject = harness({ endpoint: "ssh://user:private-token@remote.example" });
  await assert.rejects(ensureLocalDocker(subject.options), (error) => {
    assert.match(error.message, /local Docker endpoint/);
    assert.doesNotMatch(error.message, /private-token|remote\.example/);
    return true;
  });
  assert.equal(subject.calls.length, 1);
  assert.equal(subject.calls[0].args[0], "context");
});

test("rejects remote DOCKER_HOST even if a local DOCKER_CONTEXT could override it", async () => {
  const subject = harness({ env: { ...windowsEnv, DOCKER_HOST: "tcp://remote.example:2375", DOCKER_CONTEXT: "desktop-linux" } });
  await assert.rejects(ensureLocalDocker(subject.options), /local Docker endpoint/);
  assert.equal(subject.calls.length, 0);
});

test("respects explicit local context and does not change global context", async () => {
  const subject = harness({ env: { ...windowsEnv, DOCKER_CONTEXT: "my-local-engine" } });
  await ensureLocalDocker(subject.options);
  assert.ok(subject.calls[0].args.includes("my-local-engine"));
  assert.equal(subject.calls.some(({ args }) => args.includes("use")), false);
});

test("uses a local DOCKER_HOST without inspecting an unrelated default context", async () => {
  const subject = harness({ env: { ...windowsEnv, DOCKER_HOST: "tcp://127.0.0.1:2375" } });
  await ensureLocalDocker(subject.options);
  assert.equal(subject.calls.length, 1);
  assert.equal(subject.calls[0].args[1], "tcp://127.0.0.1:2375");
});

test("readiness deadline bounds hanging commands and returns guarded-launcher guidance without raw errors", async () => {
  const subject = harness({ timeoutMs: 12_000, reply: ({ args }, advanceTimeout) => {
    if (!args.includes("info")) return;
    advanceTimeout();
    return { code: 1, stdout: "", stderr: "private-token from engine", timedOut: true };
  } });
  await assert.rejects(ensureLocalDocker(subject.options), (error) => {
    assert.match(error.message, /startup timeout/);
    assert.match(error.message, /guarded Windows launcher/);
    assert.doesNotMatch(error.message, /private-token/);
    return true;
  });
  assert.equal(subject.elapsed, 12_000);
  assert.equal(subject.calls.filter(({ command }) => command.endsWith("powershell.exe")).length, 1);
});

test("a context-inspection timeout stops before starting or probing Docker", async () => {
  const subject = harness({ reply: ({ args }, advanceTimeout) => {
    if (args.includes("inspect")) { advanceTimeout(); return result("", 1); }
  } });
  await assert.rejects(ensureLocalDocker(subject.options), /Could not inspect the Docker context/);
  assert.equal(subject.elapsed, 5_000);
  assert.equal(subject.calls.length, 1);
});

test("reports Linux-container requirement without restarting a Windows engine", async () => {
  const subject = harness({ reply: ({ args }) => args.includes("info") ? result("windows\n") : undefined });
  await assert.rejects(ensureLocalDocker(subject.options), /requires Linux containers/);
  assert.equal(subject.calls.some(({ command }) => command.endsWith("powershell.exe")), false);
});

test("unavailable engines on macOS and Linux require manual startup", async () => {
  for (const platform of ["darwin", "linux"]) {
    const subject = harness({ platform, endpoint: "unix:///var/run/docker.sock", readyAt: Infinity });
    await assert.rejects(ensureLocalDocker(subject.options), /Start Docker Desktop or your local Docker service/);
    assert.equal(subject.calls.length, 2);
  }
});

test("missing PATH entry reuses Docker CLI from its installation", async () => {
  const subject = harness({ reply: ({ command }) => command === "docker" ? result("", "ENOENT") : undefined });
  await ensureLocalDocker(subject.options);
  assert.match(subject.calls[1].command, /Docker\\Docker\\resources\\bin\\docker\.exe$/);
  assert.equal(subject.calls.at(-1).command, subject.calls[1].command);
});

test("missing CLI and a blocked launcher give specific setup guidance", async () => {
  const missingCli = harness({ exists: () => false, reply: () => result("", "ENOENT") });
  await assert.rejects(ensureLocalDocker(missingCli.options), /Docker CLI was not found/);
  const blockedLauncher = harness({ readyAt: Infinity, reply: ({ command }) => command.endsWith("powershell.exe") ? result("", 1) : undefined });
  await assert.rejects(ensureLocalDocker(blockedLauncher.options), /guarded Docker launcher could not prepare startup/);
});

test("local app startup validates its environment and database readiness before Vite", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(scripts["dev:local"], "node scripts/validate-build-env.mjs localdev && npm run db:start && vite --mode localdev");
  assert.equal(scripts["db:start"], "node scripts/ensure-local-docker.mjs && node scripts/start-local-supabase.mjs && node scripts/ensure-local-vector.mjs");
});
