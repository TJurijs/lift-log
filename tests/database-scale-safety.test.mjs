import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertLoopbackPostgresUrl,
  parseScaleVerificationArgs,
  resolveArtifactOutputPath,
  runRollbackOnlyTransaction,
} from "../scripts/lib/local-database-verification.mjs";

test("database scale verification accepts only exact loopback PostgreSQL hosts", () => {
  for (const url of [
    "postgresql://postgres:secret@127.0.0.1:54322/postgres",
    "postgres://postgres:secret@localhost:5432/liftlog",
    "postgresql://postgres:secret@[::1]:5432/postgres",
  ]) {
    assert.doesNotThrow(() => assertLoopbackPostgresUrl(url));
  }

  for (const url of [
    "https://127.0.0.1/postgres",
    "postgresql://postgres:secret@db.example.com:5432/postgres",
    "postgresql://postgres:secret@localhost.example.com:5432/postgres",
    "postgresql://localhost:secret@db.example.com:5432/postgres",
    "postgresql://postgres:secret@127.0.0.2:5432/postgres",
    "postgresql://postgres:secret@127.0.0.1:5432/",
    "not-a-url",
  ]) {
    assert.throws(() => assertLoopbackPostgresUrl(url), /verification refused/);
  }
});

test("database scale reports cannot escape the ignored artifacts directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "liftlog-scale-safety-"));
  const allowed = resolveArtifactOutputPath(
    "artifacts/performance/database-scale.json",
    root,
  );
  assert.equal(
    allowed,
    join(root, "artifacts", "performance", "database-scale.json"),
  );

  for (const output of [
    "report.json",
    "artifacts/../report.json",
    "artifacts/performance/report.txt",
    "artifacts",
  ]) {
    assert.throws(() => resolveArtifactOutputPath(output, root), /below artifacts/);
  }
});

test("database scale CLI rejects unrecognized or repeated output options", () => {
  assert.deepEqual(parseScaleVerificationArgs([]), { help: false, output: null });
  assert.throws(
    () => parseScaleVerificationArgs(["--database-url=postgresql://localhost/db"]),
    /Unknown database scale verification option/,
  );
  assert.throws(
    () =>
      parseScaleVerificationArgs([
        "--output=artifacts/a.json",
        "--output=artifacts/b.json",
      ]),
    /only once/,
  );
});

test("successful rollback-only work reaches rollback and never commit", async () => {
  const events = [];
  const fakeDatabase = {
    async begin(callback) {
      events.push("begin");
      try {
        await callback({ fixture: true });
        events.push("commit");
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
  };

  const result = await runRollbackOnlyTransaction(fakeDatabase, async (transaction) => {
    assert.equal(transaction.fixture, true);
    events.push("work");
    return { passed: true };
  });

  assert.deepEqual(result, { passed: true });
  assert.deepEqual(events, ["begin", "work", "rollback"]);
});

test("rollback-only work propagates failures after the database rolls back", async () => {
  const events = [];
  const expected = new Error("fixture failed");
  const fakeDatabase = {
    async begin(callback) {
      events.push("begin");
      try {
        await callback({});
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
  };

  await assert.rejects(
    runRollbackOnlyTransaction(fakeDatabase, async () => {
      events.push("work");
      throw expected;
    }),
    expected,
  );
  assert.deepEqual(events, ["begin", "work", "rollback"]);
});
