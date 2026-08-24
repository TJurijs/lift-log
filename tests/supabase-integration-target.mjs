export const HOSTED_DEV_PROJECT_REF = "ofyeejyfroblunbspgve";
export const HOSTED_DEV_SUPABASE_ORIGIN =
  `https://${HOSTED_DEV_PROJECT_REF}.supabase.co`;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for Supabase integration tests.`);
  return value;
}

function parseTargetUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SUPABASE_TEST_URL must be a valid absolute URL.");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("SUPABASE_TEST_URL must contain only the approved Supabase origin.");
  }
  return parsed;
}

export function validateIntegrationTarget(environment) {
  const target = environment.SUPABASE_INTEGRATION_TARGET ?? "local";
  const testEnvironment = required(environment, "SUPABASE_TEST_ENVIRONMENT");
  const testUrl = parseTargetUrl(required(environment, "SUPABASE_TEST_URL"));

  if (target === "local") {
    if (testEnvironment !== "local") {
      throw new Error("Local integration tests require SUPABASE_TEST_ENVIRONMENT=local.");
    }
    if (
      testUrl.protocol !== "http:" ||
      !LOOPBACK_HOSTS.has(testUrl.hostname)
    ) {
      throw new Error("Local integration tests may only mutate loopback HTTP Supabase.");
    }
    return { target, projectRef: null, origin: testUrl.origin };
  }

  if (target !== "hosted-dev") {
    throw new Error("SUPABASE_INTEGRATION_TARGET must be local or hosted-dev.");
  }
  if (environment.SUPABASE_HOSTED_DEV_INTEGRATION !== "1") {
    throw new Error(
      "Hosted development integration requires SUPABASE_HOSTED_DEV_INTEGRATION=1.",
    );
  }
  if (testEnvironment !== "hosted-development") {
    throw new Error(
      "Hosted development integration requires SUPABASE_TEST_ENVIRONMENT=hosted-development.",
    );
  }
  if (environment.SUPABASE_TEST_PROJECT_REF !== HOSTED_DEV_PROJECT_REF) {
    throw new Error(
      `Hosted integration may only target project ${HOSTED_DEV_PROJECT_REF}.`,
    );
  }
  if (testUrl.origin !== HOSTED_DEV_SUPABASE_ORIGIN) {
    throw new Error(
      `Hosted integration may only target ${HOSTED_DEV_SUPABASE_ORIGIN}.`,
    );
  }

  return {
    target,
    projectRef: HOSTED_DEV_PROJECT_REF,
    origin: testUrl.origin,
  };
}

export function validateIntegrationCredentials(environment) {
  const publishableKey = required(
    environment,
    "SUPABASE_TEST_PUBLISHABLE_KEY",
  );
  const secretKey = required(environment, "SUPABASE_TEST_SECRET_KEY");
  if (publishableKey === secretKey) {
    throw new Error("Supabase publishable and secret integration keys must differ.");
  }
}
