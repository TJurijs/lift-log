import { execFileSync, spawnSync } from "node:child_process";

let statusOutput;

try {
  const options = {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  statusOutput = process.platform === "win32"
    ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npx supabase status -o env"], options)
    : execFileSync("npx", ["supabase", "status", "-o", "env"], options);
} catch {
  process.stderr.write("Local Supabase is not running. Start it with `npx supabase start` and retry.\n");
  process.exit(1);
}

const localEnvironment = {};
for (const line of statusOutput.split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(?:"(.*)"|(.*))$/);
  if (match) localEnvironment[match[1]] = match[2] ?? match[3] ?? "";
}

const testUrl = localEnvironment.API_URL;
const databaseUrl = localEnvironment.DB_URL;
const publishableKey = localEnvironment.PUBLISHABLE_KEY ?? localEnvironment.ANON_KEY;
const secretKey = localEnvironment.SECRET_KEY ?? localEnvironment.SERVICE_ROLE_KEY;

if (!testUrl || !databaseUrl || !publishableKey || !secretKey) {
  process.stderr.write("Supabase status did not return the local API keys required by the integration test.\n");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", "tests/supabase.integration.test.mjs"], {
  cwd: new URL("../", import.meta.url),
  env: {
    ...process.env,
    SUPABASE_INTEGRATION: "1",
    SUPABASE_TEST_URL: testUrl,
    SUPABASE_TEST_DB_URL: databaseUrl,
    SUPABASE_TEST_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_TEST_SECRET_KEY: secretKey,
  },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
