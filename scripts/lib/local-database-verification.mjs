import { resolve, relative, sep } from "node:path";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const DEFAULT_LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function assertLoopbackPostgresUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Database scale verification refused: expected a valid PostgreSQL URL.");
  }

  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("Database scale verification refused: expected a PostgreSQL URL.");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      "Database scale verification refused: the database host must be loopback-only.",
    );
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error("Database scale verification refused: a database name is required.");
  }

  return parsed;
}

export function describeLocalDatabase(parsedUrl) {
  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port || "5432",
    database: decodeURIComponent(parsedUrl.pathname.slice(1)),
    localOnly: true,
  };
}

export function resolveArtifactOutputPath(value, cwd = process.cwd()) {
  if (!value) return null;
  const artifactRoot = resolve(cwd, "artifacts");
  const outputPath = resolve(cwd, value);
  const relativePath = relative(artifactRoot, outputPath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.endsWith(sep) ||
    !outputPath.toLowerCase().endsWith(".json")
  ) {
    throw new Error(
      "Database scale verification reports must be JSON files below artifacts/.",
    );
  }
  return outputPath;
}

export function parseScaleVerificationArgs(argv, cwd = process.cwd()) {
  let output = null;
  for (const argument of argv) {
    if (argument === "--help") return { help: true, output: null };
    if (argument.startsWith("--output=")) {
      if (output) throw new Error("Specify --output only once.");
      output = resolveArtifactOutputPath(argument.slice("--output=".length), cwd);
      continue;
    }
    throw new Error(`Unknown database scale verification option: ${argument}`);
  }
  return { help: false, output };
}

export async function runRollbackOnlyTransaction(database, work) {
  const rollbackSignal = new Error("LIFTLOG_SCALE_VERIFICATION_ROLLBACK");
  let result;
  try {
    await database.begin(async (transaction) => {
      result = await work(transaction);
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) throw error;
  }
  return result;
}
