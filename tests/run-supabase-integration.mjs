import { execFileSync, spawnSync } from "node:child_process";
import {
  validateIntegrationCredentials,
  validateIntegrationTarget,
} from "./supabase-integration-target.mjs";

function stop(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function runIntegration(environment) {
  try {
    validateIntegrationTarget(environment);
    validateIntegrationCredentials(environment);
  } catch (error) {
    stop(
      error instanceof Error
        ? error.message
        : "Integration target validation failed.",
    );
  }

  const result = spawnSync(
    process.execPath,
    ["--test", "tests/supabase.integration.test.mjs"],
    {
      cwd: new URL("../", import.meta.url),
      env: { ...environment, SUPABASE_INTEGRATION: "1" },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

const argumentsList = process.argv.slice(2);
if (argumentsList.some((argument) => argument !== "--hosted-dev")) {
  stop("Unknown integration runner argument.");
}

if (argumentsList.includes("--hosted-dev")) {
  runIntegration({
    ...process.env,
    SUPABASE_INTEGRATION_TARGET: "hosted-dev",
  });
}

let statusOutput;
try {
  const options = {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  statusOutput =
    process.platform === "win32"
      ? execFileSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", "npx supabase status -o env"],
          options,
        )
      : execFileSync("npx", ["supabase", "status", "-o", "env"], options);
} catch {
  stop(
    "Local Supabase is not running. Start it with `npx supabase start` and retry.",
  );
}

const localEnvironment = {};
for (const line of statusOutput.split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(?:"(.*)"|(.*))$/);
  if (match) localEnvironment[match[1]] = match[2] ?? match[3] ?? "";
}

const testUrl = localEnvironment.API_URL;
const publishableKey =
  localEnvironment.PUBLISHABLE_KEY ?? localEnvironment.ANON_KEY;
const secretKey =
  localEnvironment.SECRET_KEY ?? localEnvironment.SERVICE_ROLE_KEY;

if (!testUrl || !publishableKey || !secretKey) {
  stop(
    "Supabase status did not return the local API keys required by the integration test.",
  );
}

runIntegration({
  ...process.env,
  SUPABASE_INTEGRATION_TARGET: "local",
  SUPABASE_TEST_ENVIRONMENT: "local",
  SUPABASE_TEST_URL: testUrl,
  SUPABASE_TEST_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_TEST_SECRET_KEY: secretKey,
});
