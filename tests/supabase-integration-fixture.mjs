const FIXTURE_NAMESPACE_PATTERN = /^integration-[a-z0-9-]+-v[0-9]+$/;
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSONA_KEYS = new Set(["athlete-a", "athlete-b", "coach"]);

function contextualError(context, error) {
  return new Error(
    `${context}: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}

function validateNamespace(fixtureNamespace) {
  if (!FIXTURE_NAMESPACE_PATTERN.test(fixtureNamespace)) {
    throw new Error("Generated integration namespace is invalid.");
  }
}

function validatePersonaKey(personaKey) {
  if (!PERSONA_KEYS.has(personaKey)) {
    throw new Error("Generated integration persona key is invalid.");
  }
}

function validateUserId(userId) {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error("Generated integration Auth user ID is invalid.");
  }
}

export async function markGeneratedIntegrationProfile(
  admin,
  { fixtureNamespace, personaKey, userId },
) {
  validateNamespace(fixtureNamespace);
  validatePersonaKey(personaKey);
  validateUserId(userId);
  const testPersonaKey = `${fixtureNamespace}:${personaKey}`;
  const result = await admin
    .from("profiles")
    .update({ account_kind: "test", test_persona_key: testPersonaKey })
    .eq("id", userId)
    .select("id,account_kind,test_persona_key")
    .single();
  if (result.error) {
    throw contextualError("Mark generated integration profile", result.error.message);
  }
  if (
    result.data?.id !== userId ||
    result.data?.account_kind !== "test" ||
    result.data?.test_persona_key !== testPersonaKey
  ) {
    throw new Error("Generated integration profile marker verification failed.");
  }
  return result.data;
}

export async function cleanupGeneratedIntegrationFixture(
  admin,
  { fixtureNamespace, personaKeys, userIds },
) {
  const errors = [];
  let resetAllowed = true;
  try {
    validateNamespace(fixtureNamespace);
    if (
      personaKeys.length !== userIds.length ||
      new Set(personaKeys).size !== personaKeys.length ||
      new Set(userIds).size !== userIds.length
    ) {
      throw new Error("Generated integration cleanup identity set is inconsistent.");
    }
    for (const personaKey of personaKeys) validatePersonaKey(personaKey);
    for (const userId of userIds) validateUserId(userId);
  } catch (error) {
    errors.push(contextualError("Validate generated integration cleanup", error));
    resetAllowed = false;
  }

  if (resetAllowed && personaKeys.length) {
    try {
      const result = await admin.rpc("reset_test_population", {
        expected_namespace: fixtureNamespace,
        expected_persona_keys: personaKeys,
      });
      if (result.error) throw new Error(result.error.message);
      if (
        result.data?.removed !== personaKeys.length ||
        result.data?.namespace !== fixtureNamespace
      ) {
        throw new Error("Exact namespace reset receipt did not match created users.");
      }
    } catch (error) {
      errors.push(contextualError("Reset generated integration namespace", error));
    }
  }

  for (const userId of [...new Set(userIds)].reverse()) {
    try {
      validateUserId(userId);
      const result = await admin.auth.admin.deleteUser(userId);
      if (result.error) throw new Error(result.error.message);
    } catch (error) {
      errors.push(
        contextualError(`Delete generated integration Auth user ${userId}`, error),
      );
    }
  }

  return errors;
}

export function throwIntegrationFailures(testFailure, cleanupErrors) {
  const failures = [
    ...(testFailure ? [testFailure] : []),
    ...cleanupErrors,
  ];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Supabase integration test and/or exact cleanup failed.",
    );
  }
}
