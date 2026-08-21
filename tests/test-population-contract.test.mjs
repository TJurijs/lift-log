import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const seedScriptUrl = new URL("../scripts/seed-test-population.mjs", import.meta.url);
const manifestUrl = new URL("../test-population/manifest.json", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/202608210002_test_population_and_multi_coach.sql", import.meta.url);
const appEntryUrl = new URL("../app/AppEntry.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const environmentValidatorUrl = new URL("../scripts/validate-build-env.mjs", import.meta.url);

const expectedPersonas = [
  ["janis-cakste", "Jānis Čakste", "Self-coached athlete with training history"],
  ["gustavs-zemgals", "Gustavs Zemgals", "Self-coached athlete testing invitations"],
  ["alberts-kviesis", "Alberts Kviesis", "Athlete coached by Valdis"],
  ["guntis-ulmanis", "Guntis Ulmanis", "Shared athlete coached by Valdis and Raimonds"],
  ["vaira-vike-freiberga", "Vaira Vīķe-Freiberga", "Athlete coached by Raimonds"],
  ["valdis-zatlers", "Valdis Zatlers", "Coach with three athletes and a personal plan"],
  ["raimonds-vejonis", "Raimonds Vējonis", "Coach who is also coached by Valdis"],
  ["egils-levits", "Egils Levits", "Brand-new account for onboarding"],
  ["edgars-rinkevics", "Edgars Rinkēvičs", "Future coach with no active athletes"],
];

const expectedRelationships = [
  ["alberts-kviesis", "valdis-zatlers"],
  ["guntis-ulmanis", "valdis-zatlers"],
  ["guntis-ulmanis", "raimonds-vejonis"],
  ["vaira-vike-freiberga", "raimonds-vejonis"],
  ["raimonds-vejonis", "valdis-zatlers"],
];

async function loadManifest() {
  return JSON.parse(await readFile(manifestUrl, "utf8"));
}

function runRejectedSeed(url, password = "fixture-password-long-enough") {
  return spawnSync(process.execPath, [fileURLToPath(seedScriptUrl)], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_TEST_URL: url,
      TEST_PERSONA_PASSWORD: password,
    },
    timeout: 10_000,
    windowsHide: true,
  });
}

test("Latvian-president fixture manifest is deterministic and complete", async () => {
  const manifest = await loadManifest();

  assert.equal(manifest.namespace, "latvian-presidents-v1");
  assert.equal(manifest.label, "Latvian Presidents");
  assert.deepEqual(
    manifest.personas.map(({ key, name, scenario }) => [key, name, scenario]),
    expectedPersonas,
  );
  assert.deepEqual(
    manifest.relationships.map(({ athlete, coach }) => [athlete, coach]),
    expectedRelationships,
  );

  const keys = manifest.personas.map(({ key }) => key);
  const emails = manifest.personas.map(({ email }) => email.toLowerCase());
  assert.equal(new Set(keys).size, 9, "persona keys must be unique");
  assert.equal(new Set(emails).size, 9, "persona emails must be unique");
  for (const persona of manifest.personas) {
    assert.equal(persona.email, `${persona.key}@presidents.liftlog.test`);
  }

  const keySet = new Set(keys);
  for (const { athlete, coach } of manifest.relationships) {
    assert.ok(keySet.has(athlete), `unknown athlete ${athlete}`);
    assert.ok(keySet.has(coach), `unknown coach ${coach}`);
    assert.notEqual(athlete, coach, "self-coaching is represented by plan authorship, not a relationship");
  }

  assert.equal(manifest.relationships.filter(({ athlete }) => athlete === "guntis-ulmanis").length, 2);
  assert.equal(manifest.relationships.filter(({ coach }) => coach === "valdis-zatlers").length, 3);
  assert.equal(manifest.relationships.filter(({ coach }) => coach === "raimonds-vejonis").length, 2);
  assert.ok(manifest.relationships.some(({ athlete, coach }) => athlete === "raimonds-vejonis" && coach === "valdis-zatlers"));
  assert.equal(manifest.relationships.filter(({ coach }) => coach === "edgars-rinkevics").length, 0);
  assert.equal(manifest.relationships.filter(({ athlete, coach }) => athlete === "egils-levits" || coach === "egils-levits").length, 0);
});

test("test-population seeding rejects production and every non-exact development target", () => {
  const cases = [
    ["https://awdgjgziyrqdkybmlime.supabase.co", /Production Supabase is never a valid fixture target/],
    ["https://example.supabase.co", /must be the exact liftlog-dev project/],
    ["http://ofyeejyfroblunbspgve.supabase.co", /must be the exact liftlog-dev project/],
  ];

  for (const [url, expectedError] of cases) {
    const result = runRejectedSeed(url);
    assert.notEqual(result.status, 0, `${url} must be rejected`);
    assert.match(result.stderr, expectedError);
  }

  const shortPassword = runRejectedSeed("https://ofyeejyfroblunbspgve.supabase.co", "too-short");
  assert.notEqual(shortPassword.status, 0);
  assert.match(shortPassword.stderr, /TEST_PERSONA_PASSWORD \(12\+ characters\)/);
});

test("fixture reset remains namespace-scoped, cross-account guarded, and service-only", async () => {
  const [migration, seedScript] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(seedScriptUrl, "utf8"),
  ]);

  assert.match(migration, /where profile\.account_kind = 'test'\s+and profile\.test_persona_key like expected_namespace \|\| ':%'/i);
  assert.match(migration, /Fixture programs cross namespace boundaries; reset aborted/i);
  assert.match(migration, /Fixture accounts connect to another namespace; reset aborted/i);
  assert.match(migration, /revoke all on function public\.reset_test_population\(text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.reset_test_population\(text\) to service_role/i);
  assert.doesNotMatch(migration, /delete from\s+(?:auth\.users|public\.profiles)/i);

  assert.match(seedScript, /existing\.app_metadata\?\.account_kind !== "test"/);
  assert.match(seedScript, /Expected fixture email .* belongs to an unmarked account; no changes were made/);
  assert.match(seedScript, /reset_test_population", \{ expected_namespace: manifest\.namespace \}/);
  assert.doesNotMatch(seedScript, /VITE_[A-Z0-9_]*PASSWORD/);
});

test("test-persona UI is nonprod-only and remains usable on mobile", async () => {
  const [entry, styles, validator] = await Promise.all([
    readFile(appEntryUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
    readFile(environmentValidatorUrl, "utf8"),
  ]);

  assert.match(entry, /import\.meta\.env\.MODE === "nonprod"/);
  assert.match(entry, /VITE_ENABLE_TEST_PERSONAS === "true"/);
  assert.match(entry, /ofyeejyfroblunbspgve\.supabase\.co/);
  assert.match(entry, /\["localhost", "127\.0\.0\.1", "dev\.liftlog\.cc"\]/);
  assert.match(validator, /mode === "production" && environment\.VITE_ENABLE_TEST_PERSONAS === "true"/);
  assert.match(validator, /mode !== "nonprod" \|\| supabaseHost !== "ofyeejyfroblunbspgve\.supabase\.co"/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.test-persona-open \{ display: none; \}/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.test-switcher-dialog \.test-persona-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /\.test-switcher-dialog \{[^}]*max-height: calc\(100dvh - 44px\)/);
});
