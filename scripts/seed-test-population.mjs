import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import manifest from "../test-population/manifest.json" with { type: "json" };

const DEV_PROJECT_REF = "ofyeejyfroblunbspgve";
const PROD_PROJECT_REF = "awdgjgziyrqdkybmlime";
const expectedHost = `${DEV_PROJECT_REF}.supabase.co`;
const nonprodEnvironment = loadEnv("nonprod", process.cwd(), "");
const fixtureEnvironment = loadEnv("test-personas", process.cwd(), "");
const supabaseUrl = process.env.SUPABASE_TEST_URL || nonprodEnvironment.VITE_SUPABASE_URL;
const password = process.env.TEST_PERSONA_PASSWORD || fixtureEnvironment.TEST_PERSONA_PASSWORD;
const asOf = process.env.TEST_POPULATION_AS_OF || fixtureEnvironment.TEST_POPULATION_AS_OF || rigaToday();
const PROGRAM_PLANS = [
  ["janis-cakste", "janis-cakste", "Personal Strength"],
  ["gustavs-zemgals", "gustavs-zemgals", "Cardio Base"],
  ["alberts-kviesis", "valdis-zatlers", "Strength Foundation"],
  ["guntis-ulmanis", "valdis-zatlers", "Hybrid Performance"],
  ["vaira-vike-freiberga", "raimonds-vejonis", "Mobility & Conditioning"],
  ["valdis-zatlers", "valdis-zatlers", "Coach's Own Training"],
  ["raimonds-vejonis", "valdis-zatlers", "Coach Athlete Plan"],
  ["edgars-rinkevics", "edgars-rinkevics", "Future Coach Personal Plan"],
];

function stop(message) {
  throw new Error(message);
}

function expectData(result, label) {
  if (result.error) stop(`${label}: ${result.error.message}`);
  return result.data;
}

function requireSafeTarget() {
  if (!supabaseUrl) stop("Missing development Supabase URL in .env.nonprod.");
  const parsed = new URL(supabaseUrl);
  if (parsed.hostname.includes(PROD_PROJECT_REF)) stop("Production Supabase is never a valid fixture target.");
  if (parsed.protocol !== "https:" || parsed.hostname !== expectedHost) {
    stop(`Fixture target must be the exact liftlog-dev project (${DEV_PROJECT_REF}).`);
  }
  if (!password || password.length < 12) {
    stop("Set TEST_PERSONA_PASSWORD (12+ characters) in ignored .env.test-personas and retry.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T12:00:00Z`))) {
    stop("TEST_POPULATION_AS_OF must be a valid YYYY-MM-DD date.");
  }
  if (manifest.personas.length !== 9) stop("The fixture manifest must contain exactly nine personas.");
  const personaKeys = manifest.personas.map((persona) => persona.key);
  const personaEmails = manifest.personas.map((persona) => persona.email.toLowerCase());
  if (new Set(personaKeys).size !== personaKeys.length || new Set(personaEmails).size !== personaEmails.length) {
    stop("Fixture persona keys and emails must be unique.");
  }
  const keySet = new Set(personaKeys);
  const edgeKeys = manifest.relationships.map((edge) => `${edge.athlete}:${edge.coach}`);
  if (new Set(edgeKeys).size !== edgeKeys.length || manifest.relationships.some((edge) => (
    edge.athlete === edge.coach || !keySet.has(edge.athlete) || !keySet.has(edge.coach)
  ))) stop("Fixture relationships must be unique, non-self edges between known personas.");
  if (PROGRAM_PLANS.some(([athlete, author]) => !keySet.has(athlete) || !keySet.has(author))) {
    stop("Fixture program plans must reference known personas.");
  }
  if (!process.argv.includes("--apply") || !process.argv.includes(`--project-ref=${DEV_PROJECT_REF}`)) {
    stop(`Mutation requires --apply --project-ref=${DEV_PROJECT_REF}.`);
  }
}

function loadProjectApiKeys() {
  const explicitSecret = process.env.SUPABASE_TEST_SECRET_KEY;
  const explicitPublishable = process.env.SUPABASE_TEST_PUBLISHABLE_KEY
    || nonprodEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (explicitSecret && explicitPublishable) {
    return { secretKey: explicitSecret, publishableKey: explicitPublishable };
  }

  const cli = resolve("node_modules/supabase/dist/supabase.js");
  let rows;
  try {
    const raw = execFileSync(process.execPath, [
      cli,
      "projects",
      "api-keys",
      "--project-ref",
      DEV_PROJECT_REF,
      "--reveal",
      "--output",
      "json",
    ], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    rows = JSON.parse(raw);
  } catch {
    stop("Could not read liftlog-dev API keys. Sign in with the Supabase CLI and retry.");
  }

  const secretKey = explicitSecret
    || rows.find((row) => row.type === "secret")?.api_key
    || rows.find((row) => row.type === "legacy" && row.name === "service_role")?.api_key;
  const publishableKey = explicitPublishable
    || rows.find((row) => row.type === "publishable")?.api_key
    || rows.find((row) => row.type === "legacy" && row.name === "anon")?.api_key;
  if (!secretKey || !publishableKey) stop("The development project API keys are unavailable.");
  return { secretKey, publishableKey };
}

async function listAllUsers(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const batch = expectData(result, "List Auth users").users;
    users.push(...batch);
    if (batch.length < 1000) return users;
  }
}

function userMetadata(persona) {
  return {
    full_name: persona.name,
    name: persona.name,
    test_persona: true,
    test_persona_key: persona.key,
  };
}

function appMetadata(persona, existing = {}) {
  return {
    ...existing,
    account_kind: "test",
    test_persona_key: `${manifest.namespace}:${persona.key}`,
    fixture_namespace: manifest.namespace,
  };
}

function createUserClient(publishableKey) {
  return createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function isoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rigaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Riga",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function currentMonday() {
  const date = new Date(`${asOf}T12:00:00Z`);
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - isoDay + 1);
  return isoDate(date);
}

function completedHistory(userId, entries) {
  const now = new Date(`${asOf}T18:00:00Z`).getTime();
  return entries.map((entry, index) => {
    const completedAt = new Date(now - entry.daysAgo * 86_400_000 - index * 3_600_000);
    const startedAt = new Date(completedAt.getTime() - 55 * 60_000);
    return {
      athlete_id: userId,
      workout_title: entry.title,
      status: "completed",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      session_rpe: entry.rpe,
      athlete_note: entry.note,
    };
  });
}

async function main() {
  requireSafeTarget();
  const { secretKey, publishableKey } = loadProjectApiKeys();
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const publicPreflight = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id&limit=0`, {
    method: "HEAD",
    headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
  });
  if (!publicPreflight.ok) stop("The development publishable key does not match liftlog-dev; no reset was attempted.");

  const existingUsers = await listAllUsers(admin);
  const expectedEmails = new Set(manifest.personas.map((persona) => persona.email.toLowerCase()));
  for (const existing of existingUsers) {
    const email = existing.email?.toLowerCase();
    const fixtureKey = existing.app_metadata?.test_persona_key;
    if (email && expectedEmails.has(email)) {
      const persona = manifest.personas.find((item) => item.email.toLowerCase() === email);
      const expectedKey = `${manifest.namespace}:${persona.key}`;
      if (existing.app_metadata?.account_kind !== "test" || fixtureKey !== expectedKey) {
        stop(`Expected fixture email ${email} belongs to an unmarked account; no changes were made.`);
      }
    }
    if (typeof fixtureKey === "string" && fixtureKey.startsWith(`${manifest.namespace}:`) && !expectedEmails.has(email)) {
      stop(`Fixture key ${fixtureKey} belongs to an unexpected Auth account; reset aborted.`);
    }
  }

  const existingFixtureUsers = existingUsers.filter((user) => expectedEmails.has(user.email?.toLowerCase()));
  const existingFixtureProfiles = existingFixtureUsers.length ? expectData(
    await admin.from("profiles").select("id, account_kind, test_persona_key")
      .in("id", existingFixtureUsers.map((user) => user.id)),
    "Validate existing fixture profiles",
  ) : [];
  for (const user of existingFixtureUsers) {
    const profile = existingFixtureProfiles.find((item) => item.id === user.id);
    if (!profile
      || profile.account_kind !== "test"
      || profile.test_persona_key !== user.app_metadata?.test_persona_key) {
      stop("An existing fixture Auth identity and profile marker disagree; reset aborted.");
    }
  }

  const resetResult = expectData(
    await admin.rpc("reset_test_population", { expected_namespace: manifest.namespace }),
    "Reset the previous fixture",
  );
  if (resetResult.removed !== existingFixtureProfiles.length) {
    stop("Reset count differed from the preflighted fixture identities; seeding stopped.");
  }

  const identities = new Map();
  for (const persona of manifest.personas) {
    const existing = existingUsers.find((user) => user.email?.toLowerCase() === persona.email.toLowerCase());
    let user;
    if (existing) {
      const updated = await admin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: userMetadata(persona),
        app_metadata: appMetadata(persona, existing.app_metadata),
      });
      user = expectData(updated, `Update ${persona.name}`).user;
    } else {
      const created = await admin.auth.admin.createUser({
        email: persona.email,
        password,
        email_confirm: true,
        user_metadata: userMetadata(persona),
        app_metadata: appMetadata(persona),
      });
      user = expectData(created, `Create ${persona.name}`).user;
    }
    if (!user) stop(`Auth did not return ${persona.name}.`);

    expectData(await admin.from("profiles").update({
      display_name: persona.name,
      timezone: "Europe/Riga",
      account_kind: "test",
      test_persona_key: `${manifest.namespace}:${persona.key}`,
    }).eq("id", user.id).select("id").single(), `Mark ${persona.name} profile`);
    identities.set(persona.key, { persona, user });
  }

  const clients = new Map();
  for (const persona of manifest.personas) {
    const client = createUserClient(publishableKey);
    expectData(await client.auth.signInWithPassword({ email: persona.email, password }), `Sign in ${persona.name}`);
    clients.set(persona.key, client);
  }

  const activeRelationships = new Map();
  for (const edge of manifest.relationships) {
    const athlete = identities.get(edge.athlete);
    const coach = identities.get(edge.coach);
    const invitation = expectData(
      await clients.get(edge.athlete).rpc("create_coach_invite", { target_email: coach.persona.email }),
      `Invite ${coach.persona.name} for ${athlete.persona.name}`,
    );
    const relationshipId = expectData(
      await clients.get(edge.coach).rpc("accept_coach_invite", { invite_token: invitation.token }),
      `Connect ${coach.persona.name} to ${athlete.persona.name}`,
    );
    activeRelationships.set(`${edge.athlete}:${edge.coach}`, relationshipId);
  }

  const programs = new Map();
  for (const [athleteKey, authorKey, title] of PROGRAM_PLANS) {
    const athleteId = identities.get(athleteKey).user.id;
    const authorClient = clients.get(authorKey);
    const programId = expectData(
      await authorClient.rpc("ensure_starter_program", { target_athlete_id: athleteId }),
      `Create ${title}`,
    );
    expectData(
      await authorClient.from("programs").update({ title }).eq("id", programId).select("id").single(),
      `Name ${title}`,
    );
    programs.set(athleteKey, programId);
  }

  const effectiveOn = currentMonday();
  for (const athleteKey of ["janis-cakste", "alberts-kviesis", "guntis-ulmanis", "vaira-vike-freiberga", "raimonds-vejonis"]) {
    const authorKey = PROGRAM_PLANS.find(([key]) => key === athleteKey)[1];
    const authorClient = clients.get(authorKey);
    const draft = expectData(
      await authorClient.from("program_versions").select("id").eq("program_id", programs.get(athleteKey)).eq("status", "draft").single(),
      `Load ${athleteKey} draft`,
    );
    expectData(
      await authorClient.rpc("publish_program_version", { target_version_id: draft.id, effective_on: effectiveOn }),
      `Publish ${athleteKey} program`,
    );
  }

  for (const exercise of [
    { owner: "valdis-zatlers", name: "Tempo suitcase carry", category: "Carry", cue: "Stay tall and walk slowly." },
    { owner: "raimonds-vejonis", name: "Recovery movement circuit", category: "Mobility", cue: "Move continuously at an easy pace." },
  ]) {
    const ownerId = identities.get(exercise.owner).user.id;
    expectData(await clients.get(exercise.owner).from("exercises").insert({
      scope: "personal",
      owner_id: ownerId,
      name: exercise.name,
      category: exercise.category,
      cue: exercise.cue,
      default_entry_mode: "result",
      default_tracking_fields: ["duration", "rpe"],
    }).select("id").single(), `Create ${exercise.name}`);
  }

  const history = [
    ["janis-cakste", [
      { daysAgo: 1, title: "Full body", rpe: 7, note: "Steady and controlled." },
      { daysAgo: 3, title: "Strength + engine", rpe: 8, note: "Strong finish." },
      { daysAgo: 6, title: "Cardio + core", rpe: 6, note: "Conversational pace." },
    ]],
    ["alberts-kviesis", [
      { daysAgo: 1, title: "Strength Foundation", rpe: 8, note: "Last set was demanding." },
      { daysAgo: 4, title: "Full body", rpe: 7, note: "Technique stayed consistent." },
    ]],
    ["guntis-ulmanis", [
      { daysAgo: 1, title: "Hybrid Performance", rpe: 9, note: "High fatigue; coaches should review." },
      { daysAgo: 3, title: "Cardio + core", rpe: 8, note: "Completed as planned." },
    ]],
    ["vaira-vike-freiberga", [
      { daysAgo: 1, title: "Aerobic intervals", rpe: 6, note: "Breathing stayed controlled." },
      { daysAgo: 3, title: "Mobility flow", rpe: 5, note: "Good range of motion." },
      { daysAgo: 5, title: "Easy run", rpe: 6, note: "Comfortable throughout." },
    ]],
    ["raimonds-vejonis", [
      { daysAgo: 2, title: "Coach Athlete Plan", rpe: 7, note: "Ready for progression." },
    ]],
  ];
  for (const [athleteKey, entries] of history) {
    expectData(
      await admin.from("workout_sessions").insert(completedHistory(identities.get(athleteKey).user.id, entries)),
      `Create ${athleteKey} history`,
    );
  }

  const janisId = identities.get("janis-cakste").user.id;
  const janisOccurrence = expectData(
    await clients.get("janis-cakste").from("scheduled_workouts")
      .select("id, workout_id, program_version_id")
      .eq("athlete_id", janisId).eq("status", "planned")
      .order("planned_date", { ascending: true }).limit(1).single(),
    "Load Jānis planned workout",
  );
  expectData(await clients.get("janis-cakste").rpc("start_or_resume_workout", {
    target_workout_id: janisOccurrence.workout_id,
    target_program_version_id: janisOccurrence.program_version_id,
    target_scheduled_workout_id: janisOccurrence.id,
  }), "Create Jānis in-progress session");

  const gustavs = identities.get("gustavs-zemgals");
  const edgars = identities.get("edgars-rinkevics");
  expectData(
    await clients.get("gustavs-zemgals").rpc("create_coach_invite", { target_email: edgars.persona.email }),
    "Create invitation to supersede",
  );
  const acceptedInvite = expectData(
    await clients.get("gustavs-zemgals").rpc("create_coach_invite", { target_email: edgars.persona.email }),
    "Replace invitation and preserve a revoked token",
  );
  const revokedRelationshipId = expectData(
    await clients.get("edgars-rinkevics").rpc("accept_coach_invite", { invite_token: acceptedInvite.token }),
    "Accept relationship to revoke",
  );
  expectData(await clients.get("gustavs-zemgals").from("coach_relationships")
    .update({ ended_at: new Date().toISOString() }).eq("id", revokedRelationshipId).select("id").single(),
  "Revoke historical relationship");

  expectData(await clients.get("gustavs-zemgals").rpc("create_coach_invite", { target_email: edgars.persona.email }), "Create Gustavs pending invite");
  expectData(await clients.get("gustavs-zemgals").rpc("create_coach_invite", { target_email: identities.get("valdis-zatlers").persona.email }), "Create second Gustavs pending invite");
  expectData(await clients.get("janis-cakste").rpc("create_coach_invite", { target_email: edgars.persona.email }), "Create Jānis pending invite");

  expectData(await admin.from("coach_invites").insert({
    athlete_id: gustavs.user.id,
    invited_email: identities.get("raimonds-vejonis").persona.email,
    token_hash: createHash("sha256").update(`${manifest.namespace}:expired`).digest("hex"),
    status: "expired",
    expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    account_kind: "test",
  }), "Create expired invitation");

  const personaKeys = manifest.personas.map((persona) => `${manifest.namespace}:${persona.key}`);
  const profiles = expectData(await admin.from("profiles")
    .select("id, account_kind, test_persona_key").in("test_persona_key", personaKeys), "Verify fixture profiles");
  if (profiles.length !== 9 || profiles.some((profile) => profile.account_kind !== "test")) {
    stop("Fixture verification failed: expected nine marked test profiles.");
  }

  const relationships = expectData(await admin.from("coach_relationships")
    .select("athlete_id, coach_id, ended_at, account_kind")
    .in("athlete_id", [...identities.values()].map((identity) => identity.user.id))
    .is("ended_at", null), "Verify active relationships");
  if (relationships.length !== manifest.relationships.length) stop("Fixture verification failed: active relationship count differs.");
  const guntisId = identities.get("guntis-ulmanis").user.id;
  if (relationships.filter((relationship) => relationship.athlete_id === guntisId).length !== 2) {
    stop("Fixture verification failed: Guntis must have two active coaches.");
  }
  if (relationships.some((relationship) => relationship.account_kind !== "test")) {
    stop("Fixture verification failed: a coaching edge is not test-isolated.");
  }
  const actualEdges = relationships.map((relationship) => {
    const athlete = [...identities].find(([, identity]) => identity.user.id === relationship.athlete_id)?.[0];
    const coach = [...identities].find(([, identity]) => identity.user.id === relationship.coach_id)?.[0];
    return `${athlete}:${coach}`;
  }).sort();
  const expectedEdges = manifest.relationships.map((edge) => `${edge.athlete}:${edge.coach}`).sort();
  if (JSON.stringify(actualEdges) !== JSON.stringify(expectedEdges)) {
    stop("Fixture verification failed: active relationship graph differs from the manifest.");
  }

  const egilsPrograms = expectData(await admin.from("programs").select("id").eq("athlete_id", identities.get("egils-levits").user.id), "Verify new account");
  if (egilsPrograms.length !== 0) stop("Fixture verification failed: Egils must remain a first-login account.");
  const edgarsAthletes = relationships.filter((relationship) => relationship.coach_id === edgars.user.id);
  if (edgarsAthletes.length !== 0) stop("Fixture verification failed: Edgars must have no active athletes.");

  for (const coachKey of ["valdis-zatlers", "raimonds-vejonis"]) {
    const visible = expectData(await clients.get(coachKey).from("programs").select("id").eq("athlete_id", guntisId), `Verify ${coachKey} shared access`);
    if (visible.length !== 1) stop(`Fixture verification failed: ${coachKey} cannot read Guntis.`);
  }
  const guntisConnections = expectData(await clients.get("guntis-ulmanis").from("coach_relationships")
    .select("id, coach_id").eq("athlete_id", guntisId).is("ended_at", null), "Verify Guntis coach list");
  if (guntisConnections.length !== 2) stop("Fixture verification failed: Guntis cannot list both coaches.");
  const guntisCoachProfiles = expectData(await clients.get("guntis-ulmanis").from("profiles")
    .select("id").in("id", guntisConnections.map((relationship) => relationship.coach_id)), "Verify Guntis coach profiles");
  if (guntisCoachProfiles.length !== 2) stop("Fixture verification failed: Guntis cannot read both coach profiles.");
  for (const [coachKey, expectedCount] of [["valdis-zatlers", 3], ["raimonds-vejonis", 2]]) {
    const coachId = identities.get(coachKey).user.id;
    const visibleAthletes = expectData(await clients.get(coachKey).from("coach_relationships")
      .select("athlete_id").eq("coach_id", coachId).is("ended_at", null), `Verify ${coachKey} athlete list`);
    if (visibleAthletes.length !== expectedCount) stop(`Fixture verification failed: ${coachKey} athlete count differs.`);
  }
  const unrelated = expectData(await clients.get("janis-cakste").from("programs").select("id").eq("athlete_id", guntisId), "Verify unrelated isolation");
  if (unrelated.length !== 0) stop("Fixture verification failed: unrelated athlete can read Guntis.");

  const valdisGuntisRelationship = activeRelationships.get("guntis-ulmanis:valdis-zatlers");
  expectData(await clients.get("guntis-ulmanis").from("coach_relationships")
    .update({ ended_at: new Date().toISOString() }).eq("id", valdisGuntisRelationship)
    .is("ended_at", null).select("id").single(), "Temporarily revoke one of Guntis's coaches");
  const revokedValdisRead = expectData(await clients.get("valdis-zatlers").from("programs").select("id").eq("athlete_id", guntisId), "Verify revoked Guntis access");
  if (revokedValdisRead.length !== 0) stop("Fixture verification failed: revoked coach retained Guntis access.");
  const remainingRaimondsRead = expectData(await clients.get("raimonds-vejonis").from("programs").select("id").eq("athlete_id", guntisId), "Verify remaining Guntis coach");
  if (remainingRaimondsRead.length !== 1) stop("Fixture verification failed: revoking one coach affected the other.");
  const reconnectInvite = expectData(await clients.get("guntis-ulmanis").rpc("create_coach_invite", {
    target_email: identities.get("valdis-zatlers").persona.email,
  }), "Reconnect Guntis and Valdis");
  expectData(await clients.get("valdis-zatlers").rpc("accept_coach_invite", {
    invite_token: reconnectInvite.token,
  }), "Restore Guntis and Valdis fixture edge");
  const finalActiveRelationships = expectData(await admin.from("coach_relationships")
    .select("id").in("athlete_id", [...identities.values()].map((identity) => identity.user.id))
    .is("ended_at", null), "Verify restored active graph");
  if (finalActiveRelationships.length !== manifest.relationships.length) {
    stop("Fixture verification failed: restoring a revoked coach changed the active graph size.");
  }

  const kindMutation = await clients.get("janis-cakste").from("profiles")
    .update({ account_kind: "real" }).eq("id", janisId).select("id");
  if (!kindMutation.error) stop("Fixture verification failed: a test account changed its account kind.");

  const realProfile = expectData(await admin.from("profiles").select("id").eq("account_kind", "real").limit(1).maybeSingle(), "Find real-account sentinel");
  if (realProfile) {
    const realAuthUser = existingUsers.find((user) => user.id === realProfile.id);
    if (realAuthUser?.email) {
      const forbiddenInvite = await clients.get("janis-cakste").rpc("create_coach_invite", { target_email: realAuthUser.email });
      if (!forbiddenInvite.error) stop("Fixture verification failed: test-to-real invitation was accepted.");
    }
    const forbidden = await admin.from("coach_relationships").insert({
      athlete_id: realProfile.id,
      coach_id: identities.get("valdis-zatlers").user.id,
      account_kind: "real",
    });
    if (!forbidden.error) stop("Fixture verification failed: cross-kind service relationship was accepted.");
  }

  process.stdout.write(`Seeded and verified ${manifest.personas.length} ${manifest.label} personas, ${relationships.length} active coaching relationships, and isolated QA history in liftlog-dev.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
