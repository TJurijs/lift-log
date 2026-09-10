import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const launcher = fileURLToPath(new URL("../scripts/windows/start-docker-desktop.ps1", import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const windowsOnly = { skip: process.platform !== "win32" };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftlog-docker-launcher-"));
  const local = path.join(root, "LocalAppData");
  await mkdir(local);
  // Only this unique, resolved fixture root is removed; never real Docker data.
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("liftlog-docker-launcher-"));
    await rm(root, { recursive: true, force: true });
  });
  const invoke = async (processFunction = "function Get-DockerStartupProcesses { @() }", extra = "", localOverride = local) => {
    const source = `. ${quote(launcher)}\n${processFunction}\n${extra}\nInvoke-DockerDesktopStartup -PrepareOnly | ConvertTo-Json -Compress`;
    const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", source], {
      env: { ...process.env, LOCALAPPDATA: localOverride }, windowsHide: true, timeout: 10_000,
    });
    return JSON.parse(stdout.trim());
  };
  return { root, local, run: path.join(local, "Docker", "run"), secrets: path.join(local, "docker-secrets-engine"), invoke };
}

test("guarded launcher preserves all socket files and starts with empty runtime folders", windowsOnly, async (t) => {
  const f = await fixture(t);
  await mkdir(f.run, { recursive: true });
  await mkdir(f.secrets);
  const sockets = ["dockerInference", "dockerInference.stale", "userAnalyticsOtlpHttp.sock", "sailor-ingest.sock", "dockerEthernetVfkit"];
  await Promise.all(sockets.map((name) => writeFile(path.join(f.run, name), "")));
  await writeFile(path.join(f.secrets, "engine.sock"), "");
  const protectedData = path.join(f.local, "Docker", "wsl", "data");
  await mkdir(protectedData, { recursive: true });
  await writeFile(path.join(protectedData, "docker_data.vhdx"), "database sentinel");
  const result = await f.invoke();
  assert.equal(result.QuarantinedDirectories, 2);
  assert.deepEqual(await readdir(f.run), []);
  assert.deepEqual(await readdir(f.secrets), []);
  const backup = (await readdir(path.dirname(f.run))).find((name) => name.startsWith("run.stale-"));
  assert.deepEqual((await readdir(path.join(path.dirname(f.run), backup))).sort(), sockets.sort());
  const secretBackup = (await readdir(f.local)).find((name) => name.startsWith("docker-secrets-engine.stale-"));
  assert.deepEqual(await readdir(path.join(f.local, secretBackup)), ["engine.sock"]);
  assert.equal(await readFile(path.join(protectedData, "docker_data.vhdx"), "utf8"), "database sentinel");
});

test("missing and empty runtime folders do not produce repeated quarantine folders", windowsOnly, async (t) => {
  const f = await fixture(t);
  assert.equal((await f.invoke()).QuarantinedDirectories, 0);
  assert.equal((await f.invoke()).QuarantinedDirectories, 0);
  assert.deepEqual(await readdir(path.dirname(f.run)), ["run"]);
  assert.deepEqual((await readdir(f.local)).sort(), ["Docker", "docker-secrets-engine"].sort());
});

test("unexpected secrets-engine data rejects the whole plan before moving any runtime", windowsOnly, async (t) => {
  const f = await fixture(t);
  await mkdir(f.run, { recursive: true });
  await mkdir(f.secrets);
  await writeFile(path.join(f.run, "dockerInference"), "");
  await writeFile(path.join(f.secrets, "credentials.json"), "keep me");
  await assert.rejects(f.invoke(), /unexpected data/);
  assert.deepEqual(await readdir(path.dirname(f.run)), ["run"]);
  assert.equal(await readFile(path.join(f.secrets, "credentials.json"), "utf8"), "keep me");
});

test("a known socket name with file contents or a subdirectory is never quarantined", windowsOnly, async (t) => {
  const f = await fixture(t);
  await mkdir(f.run, { recursive: true });
  await writeFile(path.join(f.run, "dockerInference"), "unexpected real data");
  await assert.rejects(f.invoke(), /unexpected data/);
  assert.equal(await readFile(path.join(f.run, "dockerInference"), "utf8"), "unexpected real data");
  await mkdir(path.join(f.run, "sailor-ingest.sock"));
  await assert.rejects(f.invoke(), /unexpected data/);
  assert.deepEqual(await readdir(path.dirname(f.run)), ["run"]);
});

test("running Docker protection leaves even malformed runtime contents untouched", windowsOnly, async (t) => {
  const f = await fixture(t);
  await mkdir(f.run, { recursive: true });
  await writeFile(path.join(f.run, "unexpected.txt"), "keep me");
  const running = "function Get-DockerStartupProcesses { [PSCustomObject]@{ Id = 42; ProcessName = 'com.docker.backend' } }";
  assert.equal((await f.invoke(running)).Status, "AlreadyRunning");
  assert.deepEqual(await readdir(path.dirname(f.run)), ["run"]);
  assert.equal(await readFile(path.join(f.run, "unexpected.txt"), "utf8"), "keep me");
});

test("Docker appearing after preflight prevents any runtime move", windowsOnly, async (t) => {
  const f = await fixture(t);
  await mkdir(f.run, { recursive: true });
  await writeFile(path.join(f.run, "dockerInference"), "");
  const startsDuringCheck = "$script:checks = 0\nfunction Get-DockerStartupProcesses { $script:checks++; if ($script:checks -gt 1) { [PSCustomObject]@{ Id = 42; ProcessName = 'Docker Desktop' } } }";
  await assert.rejects(f.invoke(startsDuringCheck), /Docker started while preparing/);
  assert.deepEqual(await readdir(path.dirname(f.run)), ["run"]);
});

test("a junction anywhere in the runtime directory chain is rejected", windowsOnly, async (t) => {
  const f = await fixture(t);
  const other = path.join(f.root, "ProtectedOutsideLocalData");
  await mkdir(other);
  await symlink(other, path.join(f.local, "Docker"), "junction");
  await assert.rejects(f.invoke(), /junction or symbolic-link ancestor/);
  assert.deepEqual(await readdir(other), []);
});

test("relative or escaping LocalAppData paths are rejected", windowsOnly, async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.invoke(undefined, "", "relative\\LocalAppData"), /absolute local-drive/);
  await assert.rejects(f.invoke(undefined, "", `${f.local}\\..\\OtherData`), /non-canonical/);
  assert.deepEqual(await readdir(f.local), []);
});
