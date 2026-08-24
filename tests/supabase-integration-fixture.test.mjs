import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupGeneratedIntegrationFixture,
  markGeneratedIntegrationProfile,
  throwIntegrationFailures,
} from "./supabase-integration-fixture.mjs";

const fixtureNamespace = "integration-1787585319583-6ab24ec1-v1";
const identities = [
  ["athlete-a", "11111111-1111-4111-8111-111111111111"],
  ["athlete-b", "22222222-2222-4222-8222-222222222222"],
  ["coach", "33333333-3333-4333-8333-333333333333"],
];

function profileAdmin(returnedRow) {
  const calls = [];
  const builder = {
    update(value) {
      calls.push(["update", value]);
      return this;
    },
    eq(column, value) {
      calls.push(["eq", column, value]);
      return this;
    },
    select(value) {
      calls.push(["select", value]);
      return this;
    },
    async single() {
      return { data: returnedRow, error: null };
    },
  };
  return {
    calls,
    admin: {
      from(table) {
        calls.push(["from", table]);
        return builder;
      },
    },
  };
}

test("generated Auth creation is followed by an exact verified profile marker", async () => {
  const [personaKey, userId] = identities[0];
  const testPersonaKey = `${fixtureNamespace}:${personaKey}`;
  const { admin, calls } = profileAdmin({
    id: userId,
    account_kind: "test",
    test_persona_key: testPersonaKey,
  });
  assert.deepEqual(
    await markGeneratedIntegrationProfile(admin, {
      fixtureNamespace,
      personaKey,
      userId,
    }),
    { id: userId, account_kind: "test", test_persona_key: testPersonaKey },
  );
  assert.deepEqual(calls, [
    ["from", "profiles"],
    ["update", { account_kind: "test", test_persona_key: testPersonaKey }],
    ["eq", "id", userId],
    ["select", "id,account_kind,test_persona_key"],
  ]);
});

test("profile marker rejects an unmarked returned profile", async () => {
  const [personaKey, userId] = identities[0];
  const { admin } = profileAdmin({
    id: userId,
    account_kind: "real",
    test_persona_key: null,
  });
  await assert.rejects(
    markGeneratedIntegrationProfile(admin, {
      fixtureNamespace,
      personaKey,
      userId,
    }),
    /marker verification failed/,
  );
});

test("all exact Auth deletions are attempted after reset verification fails", async () => {
  const deleted = [];
  const rpcCalls = [];
  const admin = {
    async rpc(name, parameters) {
      rpcCalls.push([name, parameters]);
      return { data: { removed: 0, namespace: fixtureNamespace }, error: null };
    },
    auth: {
      admin: {
        async deleteUser(userId) {
          deleted.push(userId);
          return userId === identities[1][1]
            ? { error: { message: "synthetic delete failure" } }
            : { error: null };
        },
      },
    },
  };
  const errors = await cleanupGeneratedIntegrationFixture(admin, {
    fixtureNamespace,
    personaKeys: identities.map(([key]) => key),
    userIds: identities.map(([, id]) => id),
  });
  assert.deepEqual(rpcCalls, [
    [
      "reset_test_population",
      {
        expected_namespace: fixtureNamespace,
        expected_persona_keys: identities.map(([key]) => key),
      },
    ],
  ]);
  assert.deepEqual(deleted, identities.map(([, id]) => id).reverse());
  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /reset receipt did not match/i);
  assert.match(errors[1].message, /synthetic delete failure/);
});

test("test and cleanup failures are reported together", () => {
  const testFailure = new Error("synthetic test failure");
  const cleanupFailure = new Error("synthetic cleanup failure");
  assert.throws(
    () => throwIntegrationFailures(testFailure, [cleanupFailure]),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === testFailure &&
      error.errors[1] === cleanupFailure,
  );
});
