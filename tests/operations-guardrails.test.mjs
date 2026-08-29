import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createScaleFixtureManifest, deterministicUuid, generateScenarioRecords } from "../scripts/lib/scale-fixture.mjs";
import { ENVIRONMENT_BINDINGS, validateEnvironmentBinding } from "../scripts/lib/environment-bindings.mjs";
import { evaluateBundleMetrics, evaluateRuntimeReport } from "../scripts/lib/performance-budgets.mjs";

const budgets = JSON.parse(fs.readFileSync(new URL("../performance/budgets.json", import.meta.url), "utf8"));

test("scale fixtures are deterministic and cover approved load shapes", () => {
  const first = createScaleFixtureManifest();
  const second = createScaleFixtureManifest();
  assert.deepEqual(first, second);
  assert.equal(first.totalRows, 269097);
  assert.deepEqual(first.scenarios.map(({ name, totalRows }) => [name, totalRows]), [
    ["program-10w-40", 1453], ["program-52w-stress", 7543], ["coach-50x150", 255101], ["exercise-5000", 5000],
  ]);
  assert.match(first.digest, /^[0-9a-f]{64}$/u);
  assert.equal(deterministicUuid("same"), deterministicUuid("same"));
  assert.deepEqual(generateScenarioRecords("exercise-5000").next().value, {
    type: "exercise", id: deterministicUuid("exercise-5000:exercise:1"), key: "scale-exercise-00001", scope: "global",
  });
});

test("hosted build modes require exact project bindings and reject server credentials", () => {
  const common = { VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ci", VITE_ENABLE_TEST_PERSONAS: "false", VITE_RELEASE_SHA: "abcdef1" };
  assert.equal(validateEnvironmentBinding("production", {
    ...common, VITE_SITE_URL: ENVIRONMENT_BINDINGS.production.siteOrigin, VITE_SUPABASE_URL: ENVIRONMENT_BINDINGS.production.supabaseOrigin,
  }).mode, "production");
  assert.throws(() => validateEnvironmentBinding("production", {
    ...common, VITE_SITE_URL: ENVIRONMENT_BINDINGS.production.siteOrigin, VITE_SUPABASE_URL: ENVIRONMENT_BINDINGS.nonprod.supabaseOrigin,
  }), /must equal/u);
  assert.throws(() => validateEnvironmentBinding("nonprod", {
    ...common, VITE_SITE_URL: ENVIRONMENT_BINDINGS.nonprod.siteOrigin, VITE_SUPABASE_URL: ENVIRONMENT_BINDINGS.nonprod.supabaseOrigin,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_do-not-bundle",
  }), /service-role credential/u);
});

test("bundle and runtime budget evaluators produce actionable gates", () => {
  const atLimit = Object.fromEntries(Object.entries(budgets.bundle).map(([name, limit]) => [name, { rawBytes: limit.rawBytesMax, gzipBytes: limit.gzipBytesMax }]));
  assert.equal(evaluateBundleMetrics(atLimit, budgets).passed, true);
  atLimit.totalJs.rawBytes += 1;
  assert.equal(evaluateBundleMetrics(atLimit, budgets).passed, false);
  const report = { personas: [{ persona: "scale", bootstrap: { readyMs: 100, dataApi: { requestCount: 6 }, dom: { rowCount: 20 } }, screens: [{
    id: "programs", readyMs: { p95: 200 }, dataApiRequests: { p95: 2 }, rowCount: { max: 30 },
  }, {
    id: "workout-detail", kind: "detail", readyMs: { p95: 200 }, dataApiRequests: { p95: 2 }, rowCount: { max: 30 },
  }] }] };
  assert.equal(evaluateRuntimeReport(report, budgets).passed, true);
  report.personas[0].screens[1].dataApiRequests.p95 = 3;
  assert.equal(evaluateRuntimeReport(report, budgets).passed, false);
  report.personas[0].screens[1].dataApiRequests.p95 = 2;
  report.personas[0].bootstrap.dataApi.requestCount = 22;
  assert.equal(evaluateRuntimeReport(report, budgets).passed, false);
});

test("performance harness uses semantic selected state and supports isolated local data", () => {
  const source = fs.readFileSync(new URL("../scripts/measure-hosted-readonly-performance.mjs", import.meta.url), "utf8");
  assert.match(source, /aria-current/u);
  assert.match(source, /hosted-dev.*local/su);
  for (const rpcName of [
    "get_workspace_bootstrap",
    "list_program_summaries",
    "get_program_version_detail",
    "get_scheduled_workout_detail",
    "list_calendar_occurrences",
    "list_calendar_session_summaries",
    "list_completed_session_summaries",
    "search_exercises",
    "list_schedulable_workouts",
    "get_coaching_access_summary",
    "list_coach_athletes",
    "get_coach_athlete_detail",
  ]) {
    assert.match(source, new RegExp(`"${rpcName}"`, "u"));
  }
  for (const targetId of [
    "program-detail",
    "scheduled-workout-detail",
    "coach-athlete-detail",
  ]) {
    assert.match(
      source,
      new RegExp(`id: "${targetId}"[\\s\\S]{0,120}kind: "detail"`, "u"),
    );
  }
  assert.match(source, /kind: target\.kind \?\? "navigation"/u);
  assert.match(
    source,
    /await target\.action\(\);\s+await target\.ready\(\);\s+await tracker\.waitForGlobalIdle\(\);\s+\s+const samples/u,
  );
  assert.doesNotMatch(source, /getByRole\("heading"/u);
  assert.doesNotMatch(source, /\.coach-dashboard|\.coaching-athlete-layout/u);
});

test("CI gates static quality and isolated local database/runtime performance", () => {
  const source = fs.readFileSync(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
  const packageSource = fs.readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.match(source, /npm run ci:verify/u);
  assert.match(source, /local-supabase:/u);
  assert.match(source, /npm run ci:local-supabase/u);
  assert.match(source, /npm run preview:ci/u);
  assert.match(source, /npm run seed:test-population:local/u);
  assert.match(source, /npm run perf:measure:local/u);
  assert.match(source, /npm run perf:runtime:check/u);
  assert.match(
    packageSource,
    /"ci:local-supabase": "npm run db:reset && npm run db:lint && npm run test:integration && npm run test:v1:database-smoke && npm run perf:database:local:report"/u,
  );
  assert.match(
    packageSource,
    /"preview:ci": "vite preview --host 127\.0\.0\.1 --port 3000"/u,
  );
  assert.doesNotMatch(source, /--hosted-dev|--project-ref|deploy|wrangler publish/u);
});
