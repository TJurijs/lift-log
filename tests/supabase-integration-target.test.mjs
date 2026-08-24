import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HOSTED_DEV_PROJECT_REF,
  HOSTED_DEV_SUPABASE_ORIGIN,
  validateIntegrationCredentials,
  validateIntegrationTarget,
} from "./supabase-integration-target.mjs";

const localEnvironment = {
  SUPABASE_INTEGRATION_TARGET: "local",
  SUPABASE_TEST_ENVIRONMENT: "local",
  SUPABASE_TEST_URL: "http://127.0.0.1:54321",
};

const hostedEnvironment = {
  SUPABASE_INTEGRATION_TARGET: "hosted-dev",
  SUPABASE_HOSTED_DEV_INTEGRATION: "1",
  SUPABASE_TEST_ENVIRONMENT: "hosted-development",
  SUPABASE_TEST_PROJECT_REF: HOSTED_DEV_PROJECT_REF,
  SUPABASE_TEST_URL: HOSTED_DEV_SUPABASE_ORIGIN,
};
const runnerPath = fileURLToPath(
  new URL("./run-supabase-integration.mjs", import.meta.url),
);

test("integration target guard accepts only loopback local mode by default", () => {
  assert.deepEqual(validateIntegrationTarget(localEnvironment), {
    target: "local",
    projectRef: null,
    origin: "http://127.0.0.1:54321",
  });
  assert.throws(
    () =>
      validateIntegrationTarget({
        ...localEnvironment,
        SUPABASE_TEST_URL: HOSTED_DEV_SUPABASE_ORIGIN,
      }),
    /loopback HTTP Supabase/,
  );
  assert.throws(
    () =>
      validateIntegrationTarget({
        ...localEnvironment,
        SUPABASE_TEST_URL: "https://127.0.0.1:54321",
      }),
    /loopback HTTP Supabase/,
  );
});

test("hosted integration requires every explicit development confirmation", () => {
  assert.deepEqual(validateIntegrationTarget(hostedEnvironment), {
    target: "hosted-dev",
    projectRef: HOSTED_DEV_PROJECT_REF,
    origin: HOSTED_DEV_SUPABASE_ORIGIN,
  });

  for (const [name, value, expected] of [
    ["SUPABASE_HOSTED_DEV_INTEGRATION", undefined, /HOSTED_DEV_INTEGRATION=1/],
    ["SUPABASE_TEST_ENVIRONMENT", "production", /hosted-development/],
    ["SUPABASE_TEST_PROJECT_REF", "awdgjgziyrqdkybmlime", /only target project/],
    ["SUPABASE_TEST_URL", "https://awdgjgziyrqdkybmlime.supabase.co", /only target https/],
    ["SUPABASE_TEST_URL", `http://${HOSTED_DEV_PROJECT_REF}.supabase.co`, /only target https/],
  ]) {
    assert.throws(
      () => validateIntegrationTarget({ ...hostedEnvironment, [name]: value }),
      expected,
    );
  }
});

test("hosted target rejects origin lookalikes and URL additions", () => {
  for (const url of [
    `https://${HOSTED_DEV_PROJECT_REF}.supabase.co.example.com`,
    `${HOSTED_DEV_SUPABASE_ORIGIN}/rest/v1`,
    `${HOSTED_DEV_SUPABASE_ORIGIN}?project=production`,
    `https://user:password@${HOSTED_DEV_PROJECT_REF}.supabase.co`,
  ]) {
    assert.throws(
      () =>
        validateIntegrationTarget({
          ...hostedEnvironment,
          SUPABASE_TEST_URL: url,
        }),
      /approved Supabase origin|only target https/,
    );
  }
});

test("integration credentials are required without exposing their values", () => {
  assert.doesNotThrow(() =>
    validateIntegrationCredentials({
      SUPABASE_TEST_PUBLISHABLE_KEY: "publishable-placeholder",
      SUPABASE_TEST_SECRET_KEY: "secret-placeholder",
    }),
  );
  assert.throws(
    () =>
      validateIntegrationCredentials({
        SUPABASE_TEST_PUBLISHABLE_KEY: "publishable-placeholder",
      }),
    /SUPABASE_TEST_SECRET_KEY is required/,
  );
  assert.throws(
    () =>
      validateIntegrationCredentials({
        SUPABASE_TEST_PUBLISHABLE_KEY: "same-placeholder",
        SUPABASE_TEST_SECRET_KEY: "same-placeholder",
      }),
    /must differ/,
  );
});

test("hosted runner rejects a missing explicit confirmation before spawning tests", () => {
  const result = spawnSync(process.execPath, [runnerPath, "--hosted-dev"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...hostedEnvironment,
      SUPABASE_HOSTED_DEV_INTEGRATION: "",
      SUPABASE_TEST_PUBLISHABLE_KEY: "publishable-placeholder",
      SUPABASE_TEST_SECRET_KEY: "secret-placeholder",
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SUPABASE_HOSTED_DEV_INTEGRATION=1/);
  assert.equal(result.stdout, "");
});
