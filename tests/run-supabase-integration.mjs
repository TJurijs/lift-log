import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  HOSTED_DEV_PROJECT_REF,
  validateIntegrationCredentials,
  validateIntegrationTarget,
} from "./supabase-integration-target.mjs";

const supabaseCli = resolve("node_modules/supabase/dist/supabase.js");

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

function withHostedDevCredentials(environment) {
  if (
    environment.SUPABASE_TEST_PUBLISHABLE_KEY?.trim() &&
    environment.SUPABASE_TEST_SECRET_KEY?.trim()
  ) {
    return environment;
  }

  let rows;
  try {
    const raw = execFileSync(
      process.execPath,
      [
        supabaseCli,
        "projects",
        "api-keys",
        "--project-ref",
        HOSTED_DEV_PROJECT_REF,
        "--reveal",
        "--output",
        "json",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    rows = JSON.parse(raw);
  } catch {
    stop(
      "Could not read liftlog-dev API keys. Sign in with the Supabase CLI or provide the guarded integration credentials.",
    );
  }

  const publishableKey =
    environment.SUPABASE_TEST_PUBLISHABLE_KEY ||
    rows.find((row) => row.type === "publishable")?.api_key ||
    rows.find((row) => row.type === "legacy" && row.name === "anon")?.api_key;
  const secretKey =
    environment.SUPABASE_TEST_SECRET_KEY ||
    rows.find((row) => row.type === "secret")?.api_key ||
    rows.find(
      (row) => row.type === "legacy" && row.name === "service_role",
    )?.api_key;
  rows = null;
  if (!publishableKey || !secretKey) {
    stop("The development project API keys are unavailable.");
  }

  return {
    ...environment,
    SUPABASE_TEST_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_TEST_SECRET_KEY: secretKey,
  };
}

const argumentsList = process.argv.slice(2);
if (argumentsList.some((argument) => argument !== "--hosted-dev")) {
  stop("Unknown integration runner argument.");
}

if (argumentsList.includes("--hosted-dev")) {
  const environment = {
    ...process.env,
    SUPABASE_INTEGRATION_TARGET: "hosted-dev",
  };
  try {
    validateIntegrationTarget(environment);
  } catch (error) {
    stop(
      error instanceof Error
        ? error.message
        : "Integration target validation failed.",
    );
  }
  runIntegration(withHostedDevCredentials(environment));
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
