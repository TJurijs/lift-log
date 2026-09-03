import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const seedScriptUrl = new URL(
  "../scripts/seed-test-population.mjs",
  import.meta.url,
);
const manifestUrl = new URL(
  "../test-population/manifest.json",
  import.meta.url,
);
const migrationUrl = new URL(
  "../supabase/migrations/202608210002_test_population_and_multi_coach.sql",
  import.meta.url,
);
const extensibilityMigrationUrl = new URL(
  "../supabase/migrations/202608210003_private_profiles_program_library_and_athlete_scheduling.sql",
  import.meta.url,
);
const appEntryUrl = new URL("../app/AppEntry.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const testPersonaStylesUrl = new URL(
  "../app/test-persona-switcher.css",
  import.meta.url,
);
const environmentValidatorUrl = new URL(
  "../scripts/validate-build-env.mjs",
  import.meta.url,
);
const packageJsonUrl = new URL("../package.json", import.meta.url);
const viteConfigUrl = new URL("../vite.config.ts", import.meta.url);

const expectedPersonas = [
  [
    "janis-cakste",
    "Jānis Čakste",
    "Self-coached athlete with training history",
  ],
  [
    "gustavs-zemgals",
    "Gustavs Zemgals",
    "Self-coached athlete testing invitations",
  ],
  ["alberts-kviesis", "Alberts Kviesis", "Athlete coached by Valdis"],
  [
    "guntis-ulmanis",
    "Guntis Ulmanis",
    "Shared athlete coached by Valdis and Raimonds",
  ],
  [
    "vaira-vike-freiberga",
    "Vaira Vīķe-Freiberga",
    "Athlete coached by Raimonds",
  ],
  [
    "valdis-zatlers",
    "Valdis Zatlers",
    "Coach with three athletes and a personal plan",
  ],
  [
    "raimonds-vejonis",
    "Raimonds Vējonis",
    "Coach who is also coached by Valdis",
  ],
  ["egils-levits", "Egils Levits", "Brand-new account for onboarding"],
  [
    "edgars-rinkevics",
    "Edgars Rinkēvičs",
    "Future coach with no active athletes",
  ],
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

function runRejectedSeed(
  url,
  password = "fixture-password-long-enough",
  argumentsList = [],
) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(seedScriptUrl), ...argumentsList],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_TEST_URL: url,
        TEST_PERSONA_PASSWORD: password,
      },
      timeout: 10_000,
      windowsHide: true,
    },
  );
}

test("Latvian-president fixture manifest is deterministic and complete", async () => {
  const manifest = await loadManifest();

  assert.equal(manifest.namespace, "latvian-presidents-v1");
  assert.equal(manifest.label, "Latvian Presidents");
  assert.equal(manifest.asOf, "2026-08-21");
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
  const liftlogIds = manifest.personas.map(({ liftlogId }) =>
    liftlogId.toUpperCase(),
  );
  assert.equal(new Set(keys).size, 9, "persona keys must be unique");
  assert.equal(new Set(emails).size, 9, "persona emails must be unique");
  assert.equal(
    new Set(liftlogIds).size,
    9,
    "persona LiftLog IDs must be unique",
  );
  for (const persona of manifest.personas) {
    assert.equal(persona.email, `${persona.key}@presidents.liftlog.test`);
    assert.equal(
      `${persona.firstName} ${persona.lastName}`.trim(),
      persona.name,
    );
    assert.match(persona.liftlogId, /^LL-[A-F0-9]{16}$/);
    assert.doesNotMatch(
      persona.liftlogId,
      /^LL-0{15}[1-9]$/,
      "fixture IDs must not be enumerable counters",
    );
  }

  const keySet = new Set(keys);
  for (const { athlete, coach } of manifest.relationships) {
    assert.ok(keySet.has(athlete), `unknown athlete ${athlete}`);
    assert.ok(keySet.has(coach), `unknown coach ${coach}`);
    assert.notEqual(
      athlete,
      coach,
      "self-coaching is represented by plan authorship, not a relationship",
    );
  }

  assert.equal(
    manifest.relationships.filter(({ athlete }) => athlete === "guntis-ulmanis")
      .length,
    2,
  );
  assert.equal(
    manifest.relationships.filter(({ coach }) => coach === "valdis-zatlers")
      .length,
    3,
  );
  assert.equal(
    manifest.relationships.filter(({ coach }) => coach === "raimonds-vejonis")
      .length,
    2,
  );
  assert.ok(
    manifest.relationships.some(
      ({ athlete, coach }) =>
        athlete === "raimonds-vejonis" && coach === "valdis-zatlers",
    ),
  );
  assert.equal(
    manifest.relationships.filter(({ coach }) => coach === "edgars-rinkevics")
      .length,
    0,
  );
  assert.equal(
    manifest.relationships.filter(
      ({ athlete, coach }) =>
        athlete === "egils-levits" || coach === "egils-levits",
    ).length,
    0,
  );
});

test("test-population seeding keeps hosted and local mutation targets strictly separated", () => {
  const cases = [
    [
      "https://awdgjgziyrqdkybmlime.supabase.co",
      /Production Supabase is never a valid fixture target/,
    ],
    ["https://example.supabase.co", /must be the exact liftlog-dev project/],
    [
      "http://ofyeejyfroblunbspgve.supabase.co",
      /must be the exact liftlog-dev project/,
    ],
    ["http://127.0.0.1:54321", /must be the exact liftlog-dev project/],
  ];

  for (const [url, expectedError] of cases) {
    const result = runRejectedSeed(url);
    assert.notEqual(result.status, 0, `${url} must be rejected`);
    assert.match(result.stderr, expectedError);
  }

  const shortPassword = runRejectedSeed(
    "https://ofyeejyfroblunbspgve.supabase.co",
    "too-short",
  );
  assert.notEqual(shortPassword.status, 0);
  assert.match(
    shortPassword.stderr,
    /TEST_PERSONA_PASSWORD \(12\+ characters\)/,
  );

  const remoteInLocalMode = runRejectedSeed(
    "https://ofyeejyfroblunbspgve.supabase.co",
    undefined,
    ["--apply", "--local"],
  );
  assert.notEqual(remoteInLocalMode.status, 0);
  assert.match(
    remoteInLocalMode.stderr,
    /Local fixture target must be a loopback HTTP Supabase URL/,
  );

  const ambiguousLocalMode = runRejectedSeed(
    "http://127.0.0.1:54321",
    undefined,
    ["--apply", "--local", "--project-ref=ofyeejyfroblunbspgve"],
  );
  assert.notEqual(ambiguousLocalMode.status, 0);
  assert.match(
    ambiguousLocalMode.stderr,
    /Local mutation requires exactly --apply --local and no hosted project ref/,
  );
});

test("fixture reset remains namespace-scoped, cross-account guarded, and service-only", async () => {
  const [migration, extensibilityMigration, seedScript] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(extensibilityMigrationUrl, "utf8"),
    readFile(seedScriptUrl, "utf8"),
  ]);
  const activeResetMigration = `${migration}\n${extensibilityMigration}`;

  assert.match(
    activeResetMigration,
    /where profile\.account_kind = 'test'\s+and profile\.test_persona_key like expected_namespace \|\| ':%'/i,
  );
  assert.match(
    activeResetMigration,
    /Fixture programs cross namespace boundaries; reset aborted/i,
  );
  assert.match(
    activeResetMigration,
    /Fixture accounts connect to another namespace; reset aborted/i,
  );
  assert.match(
    extensibilityMigration,
    /invite\.invited_profile_id = any\(test_ids\)/i,
  );
  assert.match(
    extensibilityMigration,
    /create function public\.reset_test_population\(expected_namespace text, expected_persona_keys text\[\]\)/i,
  );
  assert.match(
    extensibilityMigration,
    /actual_keys is distinct from expected_keys/i,
  );
  assert.match(
    extensibilityMigration,
    /revoke all on function public\.reset_test_population\(text, text\[\]\) from public, anon, authenticated/i,
  );
  assert.match(
    extensibilityMigration,
    /grant execute on function public\.reset_test_population\(text, text\[\]\) to service_role/i,
  );
  assert.doesNotMatch(
    activeResetMigration,
    /delete from\s+(?:auth\.users|public\.profiles)/i,
  );

  assert.match(seedScript, /existing\.app_metadata\?\.account_kind !== "test"/);
  assert.match(
    seedScript,
    /Expected fixture email .* belongs to an unmarked account; no changes were made/,
  );
  assert.match(
    seedScript,
    /reset_test_population", \{[\s\S]*expected_namespace: manifest\.namespace,[\s\S]*expected_persona_keys: personaKeys/,
  );
  const namespacePreflight = seedScript.indexOf(
    "Validate complete fixture namespace",
  );
  const liftlogIdPreflight = seedScript.indexOf(
    "Validate LiftLog ID ownership",
  );
  const resetCall = seedScript.indexOf('admin.rpc("reset_test_population"');
  assert.ok(
    namespacePreflight >= 0 && namespacePreflight < resetCall,
    "namespace ownership must be checked before reset",
  );
  assert.ok(
    liftlogIdPreflight >= 0 && liftlogIdPreflight < resetCall,
    "LiftLog ID ownership must be checked before reset",
  );
  assert.match(
    seedScript,
    /avatar_url: null,[\s\S]*timezone: "Europe\/Riga",[\s\S]*load_unit: "kg",[\s\S]*distance_unit: "km"/,
  );
  assert.match(seedScript, /create_blank_program/);
  assert.match(seedScript, /title: "Exercises",\s*section_kind: "main"/);
  assert.doesNotMatch(
    seedScript,
    /section_kind: "(?:warmup|conditioning|cooldown)"/,
  );
  assert.match(
    seedScript,
    /const valdisOwnRun = await createFixtureProgramRun\([\s\S]*publishedVersions\.set\("valdis-zatlers", valdisOwnRun\.versionId\)[\s\S]*Verify Valdis assignment source/,
    "the active coach fixture must snapshot an Own program for assignment QA",
  );
  assert.match(seedScript, /create_program_runs/);
  assert.match(seedScript, /list_program_run_summaries/);
  assert.doesNotMatch(seedScript, /rpc\("create_scheduled_occurrence"/);
  assert.match(seedScript, /start_scheduled_workout/);
  assert.doesNotMatch(
    seedScript,
    /set_program_availability|prepare_program_schedule/,
  );
  assert.match(seedScript, /target_scheduled_workout_id/);
  assert.match(seedScript, /persona\.liftlogId/);
  assert.doesNotMatch(seedScript, /ensure_starter_program/);
  assert.doesNotMatch(seedScript, /VITE_[A-Z0-9_]*PASSWORD/);
  assert.doesNotMatch(
    seedScript,
    /Date\.now\(\)|new Date\(\)\.toISOString\(\)/,
  );
  assert.doesNotMatch(
    seedScript,
    /Temporarily revoke one of Guntis's coaches|Reconnect Guntis and Valdis/,
  );
});

test("test-population has an explicit loopback-only local runner", async () => {
  const [seedScript, packageJson] = await Promise.all([
    readFile(seedScriptUrl, "utf8"),
    readFile(packageJsonUrl, "utf8"),
  ]);

  assert.match(
    seedScript,
    /const localMode = process\.argv\.includes\("--local"\)/,
  );
  assert.match(seedScript, /supabaseCli, "status", "-o", "env"/);
  assert.match(
    seedScript,
    /parsed\.protocol !== "http:"\s*\|\|\s*!\["localhost", "127\.0\.0\.1"\]\.includes\(parsed\.hostname\)/,
  );
  assert.match(
    packageJson,
    /"seed:test-population:local": "node scripts\/seed-test-population\.mjs --apply --local"/,
  );
  assert.match(
    packageJson,
    /"seed:test-population": "node scripts\/seed-test-population\.mjs --apply --project-ref=ofyeejyfroblunbspgve"/,
  );
});

test("test-persona UI is strictly gated in hosted and loopback modes and remains usable on mobile", async () => {
  const [entry, styles, testPersonaStyles, validator, viteConfig] =
    await Promise.all([
      readFile(appEntryUrl, "utf8"),
      readFile(stylesUrl, "utf8"),
      readFile(testPersonaStylesUrl, "utf8"),
      readFile(environmentValidatorUrl, "utf8"),
      readFile(viteConfigUrl, "utf8"),
    ]);

  assert.match(entry, /mode === "nonprod"/);
  assert.match(entry, /mode === "localdev"/);
  assert.match(entry, /VITE_ENABLE_TEST_PERSONAS === "true"/);
  assert.match(entry, /ofyeejyfroblunbspgve\.supabase\.co/);
  assert.match(entry, /\["localhost", "127\.0\.0\.1", "dev\.liftlog\.cc"\]/);
  assert.match(
    validator,
    /mode === "production" && environment\.VITE_ENABLE_TEST_PERSONAS === "true"/,
  );
  assert.match(validator, /mode === "localdev"/);
  assert.match(
    validator,
    /parsed\.protocol !== "http:" \|\| !loopbackHosts\.has\(parsed\.hostname\)/,
  );
  assert.match(validator, /hostedDevelopment = mode === "nonprod"/);
  assert.match(validator, /isolatedLocal = mode === "localdev"/);
  assert.match(viteConfig, /mode === "nonprod" \|\| mode === "localdev"/);
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*\.brand,[\s\S]*\.profile-menu\s*\{\s*display:\s*none;\s*\}/,
  );
  assert.match(
    testPersonaStyles,
    /@media \(max-width: 700px\)[\s\S]*\.test-switcher-dialog \.test-persona-grid\s*\{\s*grid-template-columns:\s*1fr;\s*\}/,
  );
  assert.match(
    testPersonaStyles,
    /\.test-switcher-dialog \{[^}]*max-height: calc\(100dvh - 44px\)/,
  );
});
