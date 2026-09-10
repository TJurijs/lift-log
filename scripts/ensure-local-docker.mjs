import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const readinessTimeoutMs = 120_000;
const commandTimeoutMs = 5_000;
const remoteTargetMessage = "Local startup requires a local Docker endpoint. Check DOCKER_HOST, DOCKER_CONTEXT and docker context show; select your local Linux engine, then retry npm run db:start. No Docker context was changed.";

export function isLocalDockerEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint !== endpoint.trim()) return false;
  const normalized = endpoint.replaceAll("\\", "/");
  if (/^npipe:\/{2,4}\.\/pipe\/(docker_engine|dockerDesktopLinuxEngine)$/i.test(normalized)) return true;
  try {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "unix:") return endpoint.startsWith("unix:///") && !url.host && url.pathname.length > 1;
    // WHATWG URLs normalize abbreviated, decimal and hex IPv4 hostnames.
    // Docker's Go network client need not interpret those names the same way;
    // accept a literal loopback authority rather than the normalized alias.
    const authority = /^[a-z][a-z\d+.-]*:\/\/(\[[^\]]+\]|[^:/?#]+)(?::\d+)?\/?$/i.exec(endpoint)?.[1]?.toLowerCase();
    return ["tcp:", "http:", "https:"].includes(url.protocol)
      && Boolean(authority && (authority === "localhost" || (authority.startsWith("[") && url.hostname === "[::1]") || (isIP(authority) === 4 && authority.startsWith("127."))))
      && (!url.pathname || url.pathname === "/");
  } catch {
    return false;
  }
}

function execute(command, args, options) {
  return new Promise((resolve) => {
    execFile(command, args, { ...options, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr, timedOut: Boolean(error?.killed) });
    });
  });
}

function windowsInstallations(env) {
  return [
    env.ProgramFiles && path.win32.join(env.ProgramFiles, "Docker", "Docker"),
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Programs", "DockerDesktop"),
  ].filter(Boolean);
}

/** Checks the endpoint before any daemon request. Dependencies make startup
 * failures testable without launching Desktop or contacting a Docker daemon. */
export async function ensureLocalDocker({
  platform = process.platform,
  env = process.env,
  run = execute,
  exists = existsSync,
  now = Date.now,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (message) => process.stdout.write(`${message}\n`),
  timeoutMs = readinessTimeoutMs,
} = {}) {
  const deadline = now() + timeoutMs;
  const installations = platform === "win32" ? windowsInstallations(env) : [];
  const dockerCandidates = ["docker", ...installations.map((directory) => path.win32.join(directory, "resources", "bin", "docker.exe")).filter(exists)];
  let dockerIndex = 0;
  const timeoutMessage = "Docker did not become ready within the startup timeout. If Desktop is running or shows a startup error, quit Docker Desktop fully, then retry npm run db:start. The guarded Windows launcher preserves known stale runtime sockets only while Desktop is fully stopped. No Docker data is reset.";
  const command = async (executable, args) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(timeoutMessage);
    return run(executable, args, { env, timeout: Math.min(commandTimeoutMs, remaining) });
  };
  const docker = async (args) => {
    let result = await command(dockerCandidates[dockerIndex], args);
    while (result.code === "ENOENT" && dockerIndex + 1 < dockerCandidates.length) {
      result = await command(dockerCandidates[++dockerIndex], args);
    }
    if (result.code === "ENOENT") throw new Error("Docker CLI was not found. Install Docker Desktop and reopen your terminal, then retry npm run db:start.");
    return result;
  };

  // Some Docker API clients use DOCKER_HOST without honoring DOCKER_CONTEXT.
  // Reject a remote override even when the Docker CLI would ignore that value.
  if (env.DOCKER_HOST && !isLocalDockerEndpoint(env.DOCKER_HOST)) throw new Error(remoteTargetMessage);
  let endpoint = env.DOCKER_CONTEXT ? null : env.DOCKER_HOST;
  if (!endpoint) {
    const inspect = await docker(["context", "inspect", ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []), "--format", "{{json .Endpoints.docker.Host}}"]);
    if (inspect.code !== 0) throw new Error("Could not inspect the Docker context. Run docker context show and docker context inspect to check your local configuration, then retry npm run db:start.");
    try { endpoint = JSON.parse(inspect.stdout.trim()); } catch { endpoint = null; }
  }
  if (!isLocalDockerEndpoint(endpoint)) throw new Error(remoteTargetMessage);

  // Pin probes to the endpoint already checked; never mutate the global context.
  const probe = async () => {
    const result = await docker(["--host", endpoint, "info", "--format", "{{.OSType}}"]);
    if (result.code === 0 && result.stdout.trim() === "windows") {
      throw new Error("Supabase requires Linux containers. Switch Docker Desktop to its Linux engine, then retry npm run db:start.");
    }
    return result.code === 0 && result.stdout.trim() === "linux";
  };
  if (await probe()) return { startedDesktop: false };
  if (platform !== "win32") {
    throw new Error("The local Docker engine is not ready. Start Docker Desktop or your local Docker service, then retry npm run db:start. Automatic Desktop startup is available on Windows.");
  }

  log("Starting Docker Desktop and waiting for the local Linux engine (up to 120 seconds)…");
  const powerShellPath = env.SystemRoot
    ? path.win32.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const launcherPath = fileURLToPath(new URL("./windows/start-docker-desktop.ps1", import.meta.url));
  const launch = await command(powerShellPath, ["-NoProfile", "-NonInteractive", "-File", launcherPath]);
  if (launch.code !== 0) throw new Error("The guarded Docker launcher could not prepare startup. Quit Docker Desktop fully and run scripts/windows/start-docker-desktop.ps1 to see its local safety check, then retry npm run db:start. Runtime folders with unexpected data are left untouched.");
  while (now() < deadline) {
    if (await probe()) return { startedDesktop: true };
    const remaining = deadline - now();
    if (remaining > 0) await delay(Math.min(2_000, remaining));
  }
  throw new Error(timeoutMessage);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await ensureLocalDocker();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Local Docker startup failed."}\n`);
    process.exitCode = 1;
  }
}
