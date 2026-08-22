import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import manifest from "../test-population/manifest.json" with { type: "json" };

const DEV_PROJECT_REF = "ofyeejyfroblunbspgve";
const PROD_PROJECT_REF = "awdgjgziyrqdkybmlime";
const expectedHost = `${DEV_PROJECT_REF}.supabase.co`;
const localMode = process.argv.includes("--local");
const supabaseCli = resolve("node_modules/supabase/dist/supabase.js");
const nonprodEnvironment = loadEnv("nonprod", process.cwd(), "");
const fixtureEnvironment = loadEnv("test-personas", process.cwd(), "");
let supabaseUrl =
  process.env.SUPABASE_TEST_URL ||
  (localMode ? undefined : nonprodEnvironment.VITE_SUPABASE_URL);
const password =
  process.env.TEST_PERSONA_PASSWORD || fixtureEnvironment.TEST_PERSONA_PASSWORD;
const asOf =
  process.env.TEST_POPULATION_AS_OF ||
  fixtureEnvironment.TEST_POPULATION_AS_OF ||
  manifest.asOf;
let localEnvironment;
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

function loadLocalEnvironment() {
  if (localEnvironment) return localEnvironment;
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [supabaseCli, "status", "-o", "env"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    stop(
      "Local Supabase is not running. Start it with `npm run db:start` and retry.",
    );
  }

  localEnvironment = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(?:"(.*)"|(.*))$/);
    if (match) localEnvironment[match[1]] = match[2] ?? match[3] ?? "";
  }
  return localEnvironment;
}

function requireSafeTarget() {
  if (!supabaseUrl && localMode) supabaseUrl = loadLocalEnvironment().API_URL;
  if (!supabaseUrl)
    stop(
      localMode
        ? "Supabase status did not return a local API URL."
        : "Missing development Supabase URL in .env.nonprod.",
    );
  let parsed;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    stop("Fixture target must be a valid Supabase URL.");
  }
  if (parsed.hostname.includes(PROD_PROJECT_REF))
    stop("Production Supabase is never a valid fixture target.");
  if (localMode) {
    if (
      parsed.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(parsed.hostname)
    ) {
      stop("Local fixture target must be a loopback HTTP Supabase URL.");
    }
  } else if (parsed.protocol !== "https:" || parsed.hostname !== expectedHost) {
    stop(
      `Fixture target must be the exact liftlog-dev project (${DEV_PROJECT_REF}).`,
    );
  }
  if (!password || password.length < 12) {
    stop(
      "Set TEST_PERSONA_PASSWORD (12+ characters) in ignored .env.test-personas and retry.",
    );
  }
  const parsedAsOf = new Date(`${asOf}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    Number.isNaN(parsedAsOf.getTime()) ||
    isoDate(parsedAsOf) !== asOf
  ) {
    stop("TEST_POPULATION_AS_OF must be a valid YYYY-MM-DD date.");
  }
  if (manifest.personas.length !== 9)
    stop("The fixture manifest must contain exactly nine personas.");
  const personaKeys = manifest.personas.map((persona) => persona.key);
  const personaEmails = manifest.personas.map((persona) =>
    persona.email.toLowerCase(),
  );
  const personaLiftlogIds = manifest.personas.map((persona) =>
    persona.liftlogId.toUpperCase(),
  );
  if (
    new Set(personaKeys).size !== personaKeys.length ||
    new Set(personaEmails).size !== personaEmails.length ||
    new Set(personaLiftlogIds).size !== personaLiftlogIds.length
  ) {
    stop("Fixture persona keys, emails, and LiftLog IDs must be unique.");
  }
  if (
    manifest.personas.some(
      (persona) =>
        !persona.firstName?.trim() ||
        `${persona.firstName} ${persona.lastName}`.trim() !== persona.name ||
        !/^LL-[A-Z0-9]{16}$/.test(persona.liftlogId),
    )
  ) {
    stop(
      "Fixture names and LiftLog IDs must match the managed profile format.",
    );
  }
  const keySet = new Set(personaKeys);
  const edgeKeys = manifest.relationships.map(
    (edge) => `${edge.athlete}:${edge.coach}`,
  );
  if (
    new Set(edgeKeys).size !== edgeKeys.length ||
    manifest.relationships.some(
      (edge) =>
        edge.athlete === edge.coach ||
        !keySet.has(edge.athlete) ||
        !keySet.has(edge.coach),
    )
  )
    stop(
      "Fixture relationships must be unique, non-self edges between known personas.",
    );
  if (
    PROGRAM_PLANS.some(
      ([athlete, author]) => !keySet.has(athlete) || !keySet.has(author),
    )
  ) {
    stop("Fixture program plans must reference known personas.");
  }
  if (localMode) {
    if (
      !process.argv.includes("--apply") ||
      process.argv.some((argument) => argument.startsWith("--project-ref="))
    ) {
      stop(
        "Local mutation requires exactly --apply --local and no hosted project ref.",
      );
    }
  } else if (
    !process.argv.includes("--apply") ||
    !process.argv.includes(`--project-ref=${DEV_PROJECT_REF}`)
  ) {
    stop(`Mutation requires --apply --project-ref=${DEV_PROJECT_REF}.`);
  }
}

function loadProjectApiKeys() {
  const explicitSecret = process.env.SUPABASE_TEST_SECRET_KEY;
  const explicitPublishable =
    process.env.SUPABASE_TEST_PUBLISHABLE_KEY ||
    (localMode ? undefined : nonprodEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (explicitSecret && explicitPublishable) {
    return { secretKey: explicitSecret, publishableKey: explicitPublishable };
  }

  if (localMode) {
    const environment = loadLocalEnvironment();
    if (
      !environment.API_URL ||
      new URL(environment.API_URL).origin !== new URL(supabaseUrl).origin
    ) {
      stop(
        "The requested local fixture URL does not match the running local Supabase stack.",
      );
    }
    const secretKey =
      explicitSecret || environment.SECRET_KEY || environment.SERVICE_ROLE_KEY;
    const publishableKey =
      explicitPublishable ||
      environment.PUBLISHABLE_KEY ||
      environment.ANON_KEY;
    if (!secretKey || !publishableKey) {
      stop(
        "Supabase status did not return the local API keys required by the fixture seeder.",
      );
    }
    return { secretKey, publishableKey };
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
        DEV_PROJECT_REF,
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
      "Could not read liftlog-dev API keys. Sign in with the Supabase CLI and retry.",
    );
  }

  const secretKey =
    explicitSecret ||
    rows.find((row) => row.type === "secret")?.api_key ||
    rows.find((row) => row.type === "legacy" && row.name === "service_role")
      ?.api_key;
  const publishableKey =
    explicitPublishable ||
    rows.find((row) => row.type === "publishable")?.api_key ||
    rows.find((row) => row.type === "legacy" && row.name === "anon")?.api_key;
  if (!secretKey || !publishableKey)
    stop("The development project API keys are unavailable.");
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
    given_name: persona.firstName,
    family_name: persona.lastName,
    avatar_url: null,
    picture: null,
    test_persona: true,
    test_persona_key: persona.key,
  };
}

function appMetadata(persona) {
  return {
    provider: "email",
    providers: ["email"],
    account_kind: "test",
    test_persona_key: `${manifest.namespace}:${persona.key}`,
    fixture_namespace: manifest.namespace,
    liftlog_id: persona.liftlogId,
  };
}

function createUserClient(publishableKey) {
  return createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function isoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonday() {
  const date = new Date(`${asOf}T12:00:00Z`);
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - isoDay + 1);
  return isoDate(date);
}

function fixtureTimestamp(daysFromAsOf, hour = 12) {
  const date = new Date(`${asOf}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + daysFromAsOf);
  return date.toISOString();
}

function completedHistory(userId, entries) {
  const now = new Date(`${asOf}T18:00:00Z`).getTime();
  return entries.map((entry, index) => {
    const completedAt = new Date(
      now - entry.daysAgo * 86_400_000 - index * 3_600_000,
    );
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

async function loadFixtureOccurrence(client, versionId, sequenceNumber, label) {
  return expectData(
    await client
      .from("scheduled_workouts")
      .select("id, workout_id, program_version_id, sequence_number")
      .eq("program_version_id", versionId)
      .eq("sequence_number", sequenceNumber)
      .single(),
    `Load ${label} occurrence ${sequenceNumber}`,
  );
}

async function completeFixtureOccurrence(
  client,
  versionId,
  sequenceNumber,
  rpe,
  note,
  label,
) {
  const occurrence = await loadFixtureOccurrence(
    client,
    versionId,
    sequenceNumber,
    label,
  );
  const sessionId = expectData(
    await client.rpc("start_or_resume_workout", {
      target_workout_id: occurrence.workout_id,
      target_program_version_id: occurrence.program_version_id,
      target_scheduled_workout_id: occurrence.id,
    }),
    `Start ${label} occurrence ${sequenceNumber}`,
  );
  expectData(
    await client.rpc("complete_workout_session", {
      target_session_id: sessionId,
      final_rpe: rpe,
      final_note: note,
    }),
    `Complete ${label} occurrence ${sequenceNumber}`,
  );
  return { occurrence, sessionId };
}

async function populateFixtureProgram(client, programId, title) {
  const draft = expectData(
    await client
      .from("program_versions")
      .select("id")
      .eq("program_id", programId)
      .eq("status", "draft")
      .single(),
    `Load ${title} draft`,
  );
  const week = expectData(
    await client
      .from("program_weeks")
      .select("id")
      .eq("program_version_id", draft.id)
      .eq("week_index", 1)
      .single(),
    `Load ${title} week`,
  );
  const workouts = expectData(
    await client
      .from("workouts")
      .insert([
        {
          program_week_id: week.id,
          title: "Strength session",
          day_of_week: null,
          schedule_label: "Workout 1",
          position: 0,
          estimated_minutes: 50,
        },
        {
          program_week_id: week.id,
          title: "Cardio & mobility",
          day_of_week: null,
          schedule_label: "Workout 2",
          position: 1,
          estimated_minutes: 35,
        },
      ])
      .select("id, position"),
    `Create ${title} workouts`,
  );

  const strength = workouts.find((workout) => workout.position === 0);
  const cardio = workouts.find((workout) => workout.position === 1);
  const sections = expectData(
    await client
      .from("workout_sections")
      .insert([
        {
          workout_id: strength.id,
          title: "Warm-up",
          section_kind: "warmup",
          notes: "5 minutes of easy movement and joint preparation.",
          position: 0,
        },
        {
          workout_id: strength.id,
          title: "Main work",
          section_kind: "main",
          notes: "Move with control and stop before technique changes.",
          position: 1,
        },
        {
          workout_id: strength.id,
          title: "Cool-down",
          section_kind: "cooldown",
          notes: "Easy breathing and mobility for 5 minutes.",
          position: 2,
        },
        {
          workout_id: cardio.id,
          title: "Main work",
          section_kind: "main",
          notes: "Keep the effort sustainable.",
          position: 0,
        },
      ])
      .select("id, workout_id, section_kind"),
    `Create ${title} sections`,
  );
  const strengthMain = sections.find(
    (section) =>
      section.workout_id === strength.id && section.section_kind === "main",
  );
  const cardioMain = sections.find(
    (section) =>
      section.workout_id === cardio.id && section.section_kind === "main",
  );
  const items = expectData(
    await client
      .from("workout_items")
      .insert([
        {
          section_id: strengthMain.id,
          source_exercise_id: null,
          snapshot_name: "Goblet squat",
          snapshot_cue: "Brace, sit between the hips, and stand smoothly.",
          entry_mode: "sets",
          tracking_fields: ["reps", "load", "rpe"],
          position: 0,
        },
        {
          section_id: strengthMain.id,
          source_exercise_id: null,
          snapshot_name: "Push-up",
          snapshot_cue: "Keep a straight line and use a controlled range.",
          entry_mode: "sets",
          tracking_fields: ["reps", "rpe"],
          position: 1,
        },
        {
          section_id: cardioMain.id,
          source_exercise_id: null,
          snapshot_name: "Easy cardio",
          snapshot_cue: "Use any modality and keep a conversational pace.",
          entry_mode: "result",
          tracking_fields: ["duration", "distance", "rpe"],
          position: 0,
        },
        {
          section_id: cardioMain.id,
          source_exercise_id: null,
          snapshot_name: "Mobility flow",
          snapshot_cue: "Move continuously through comfortable ranges.",
          entry_mode: "none",
          tracking_fields: [],
          position: 1,
        },
      ])
      .select("id, snapshot_name"),
    `Create ${title} exercise items`,
  );
  const squat = items.find((item) => item.snapshot_name === "Goblet squat");
  const pushup = items.find((item) => item.snapshot_name === "Push-up");
  const easyCardio = items.find((item) => item.snapshot_name === "Easy cardio");
  expectData(
    await client.from("prescribed_entries").insert([
      ...Array.from({ length: 3 }, (_, position) => ({
        workout_item_id: squat.id,
        position,
        reps_min: 8,
        reps_max: 10,
        target_rpe_min: 7,
        target_rpe_max: 8,
      })),
      ...Array.from({ length: 3 }, (_, position) => ({
        workout_item_id: pushup.id,
        position,
        reps_min: 8,
        reps_max: 12,
        target_rpe_min: 7,
        target_rpe_max: 8,
      })),
      {
        workout_item_id: easyCardio.id,
        position: 0,
        duration_seconds: 1200,
        target_rpe_min: 5,
        target_rpe_max: 6,
      },
    ]),
    `Create ${title} prescriptions`,
  );
  return draft.id;
}

async function main() {
  requireSafeTarget();
  const { secretKey, publishableKey } = loadProjectApiKeys();
  const admin = createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const publicPreflight = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
  });
  if (!publicPreflight.ok)
    stop(
      localMode
        ? "The local publishable key does not match the running local Supabase stack; no reset was attempted."
        : "The development publishable key does not match liftlog-dev; no reset was attempted.",
    );

  const existingUsers = await listAllUsers(admin);
  const personaKeys = manifest.personas.map((persona) => persona.key);
  const qualifiedPersonaKeys = personaKeys
    .map((key) => `${manifest.namespace}:${key}`)
    .sort();
  const expectedEmails = new Set(
    manifest.personas.map((persona) => persona.email.toLowerCase()),
  );
  const expectedLiftlogIds = new Set(
    manifest.personas.map((persona) => persona.liftlogId),
  );
  for (const existing of existingUsers) {
    const email = existing.email?.toLowerCase();
    const fixtureKey = existing.app_metadata?.test_persona_key;
    if (email && expectedEmails.has(email)) {
      const persona = manifest.personas.find(
        (item) => item.email.toLowerCase() === email,
      );
      const expectedKey = `${manifest.namespace}:${persona.key}`;
      if (
        existing.app_metadata?.account_kind !== "test" ||
        fixtureKey !== expectedKey
      ) {
        stop(
          `Expected fixture email ${email} belongs to an unmarked account; no changes were made.`,
        );
      }
    }
    const belongsToFixtureNamespace =
      existing.app_metadata?.fixture_namespace === manifest.namespace ||
      (typeof fixtureKey === "string" &&
        fixtureKey.startsWith(`${manifest.namespace}:`));
    if (belongsToFixtureNamespace && !expectedEmails.has(email)) {
      stop(
        `Fixture key ${fixtureKey} belongs to an unexpected Auth account; reset aborted.`,
      );
    }
  }

  const existingFixtureUsers = existingUsers.filter((user) =>
    expectedEmails.has(user.email?.toLowerCase()),
  );
  const existingFixtureProfiles = existingFixtureUsers.length
    ? expectData(
        await admin
          .from("profiles")
          .select("id, account_kind, test_persona_key, liftlog_id")
          .in(
            "id",
            existingFixtureUsers.map((user) => user.id),
          ),
        "Validate existing fixture profiles",
      )
    : [];
  for (const user of existingFixtureUsers) {
    const profile = existingFixtureProfiles.find((item) => item.id === user.id);
    if (
      !profile ||
      profile.account_kind !== "test" ||
      profile.test_persona_key !== user.app_metadata?.test_persona_key
    ) {
      stop(
        "An existing fixture Auth identity and profile marker disagree; reset aborted.",
      );
    }
  }

  const namespaceProfiles = expectData(
    await admin
      .from("profiles")
      .select("id, account_kind, test_persona_key, liftlog_id")
      .like("test_persona_key", `${manifest.namespace}:%`),
    "Validate complete fixture namespace",
  );
  const actualPersonaKeys = namespaceProfiles
    .map((profile) => profile.test_persona_key)
    .sort();
  if (
    actualPersonaKeys.length !== 0 &&
    JSON.stringify(actualPersonaKeys) !== JSON.stringify(qualifiedPersonaKeys)
  ) {
    stop(
      "Fixture namespace does not match the complete manifest persona set; no reset was attempted.",
    );
  }
  for (const profile of namespaceProfiles) {
    const persona = manifest.personas.find(
      (candidate) =>
        `${manifest.namespace}:${candidate.key}` === profile.test_persona_key,
    );
    const authUser =
      persona &&
      existingUsers.find(
        (candidate) =>
          candidate.email?.toLowerCase() === persona.email.toLowerCase(),
      );
    if (
      !persona ||
      !authUser ||
      authUser.id !== profile.id ||
      profile.account_kind !== "test"
    ) {
      stop(
        "Fixture namespace profile ownership differs from the manifest; no reset was attempted.",
      );
    }
  }

  const liftlogIdOwners = expectData(
    await admin
      .from("profiles")
      .select("id, liftlog_id, test_persona_key")
      .in("liftlog_id", [...expectedLiftlogIds]),
    "Validate LiftLog ID ownership",
  );
  for (const owner of liftlogIdOwners) {
    const persona = manifest.personas.find(
      (candidate) => candidate.liftlogId === owner.liftlog_id,
    );
    const expectedUser =
      persona &&
      existingUsers.find(
        (candidate) =>
          candidate.email?.toLowerCase() === persona.email.toLowerCase(),
      );
    if (!persona || !expectedUser || owner.id !== expectedUser.id) {
      stop(
        `LiftLog ID ${owner.liftlog_id} belongs to a non-fixture profile; no reset was attempted.`,
      );
    }
  }

  const resetResult = expectData(
    await admin.rpc("reset_test_population", {
      expected_namespace: manifest.namespace,
      expected_persona_keys: personaKeys,
    }),
    "Reset the previous fixture",
  );
  if (resetResult.removed !== namespaceProfiles.length) {
    stop(
      "Reset count differed from the preflighted fixture identities; seeding stopped.",
    );
  }

  const identities = new Map();
  for (const persona of manifest.personas) {
    const existing = existingUsers.find(
      (user) => user.email?.toLowerCase() === persona.email.toLowerCase(),
    );
    let user;
    if (existing) {
      const updated = await admin.auth.admin.updateUserById(existing.id, {
        email: persona.email,
        password,
        email_confirm: true,
        user_metadata: userMetadata(persona),
        app_metadata: appMetadata(persona),
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

    expectData(
      await admin
        .from("profiles")
        .update({
          display_name: persona.name,
          first_name: persona.firstName,
          last_name: persona.lastName,
          liftlog_id: persona.liftlogId,
          avatar_url: null,
          timezone: "Europe/Riga",
          load_unit: "kg",
          distance_unit: "km",
          account_kind: "test",
          test_persona_key: `${manifest.namespace}:${persona.key}`,
        })
        .eq("id", user.id)
        .select("id")
        .single(),
      `Mark ${persona.name} profile`,
    );
    identities.set(persona.key, { persona, user });
  }

  const clients = new Map();
  for (const persona of manifest.personas) {
    const client = createUserClient(publishableKey);
    expectData(
      await client.auth.signInWithPassword({ email: persona.email, password }),
      `Sign in ${persona.name}`,
    );
    clients.set(persona.key, client);
  }

  for (const [edgeIndex, edge] of manifest.relationships.entries()) {
    const athlete = identities.get(edge.athlete);
    const coach = identities.get(edge.coach);
    const targetIdentifier =
      edgeIndex % 2 === 0 ? coach.persona.liftlogId : coach.persona.email;
    const invitation = expectData(
      await clients
        .get(edge.athlete)
        .rpc("create_coach_invite", { target_email: targetIdentifier }),
      `Invite ${coach.persona.name} for ${athlete.persona.name}`,
    );
    expectData(
      await clients.get(edge.coach).rpc("respond_to_coach_invite", {
        target_invite_id: invitation.id,
        target_response: "accepted",
      }),
      `Connect ${coach.persona.name} to ${athlete.persona.name}`,
    );
  }

  const programs = new Map();
  const initialDrafts = new Map();
  for (const [athleteKey, authorKey, title] of PROGRAM_PLANS) {
    const athleteId = identities.get(athleteKey).user.id;
    const authorClient = clients.get(authorKey);
    const programId = expectData(
      await authorClient.rpc("create_blank_program", {
        target_athlete_id: athleteId,
        target_title: title,
        target_planning_mode: "fixed_weeks",
      }),
      `Create ${title}`,
    );
    const draftId = await populateFixtureProgram(
      authorClient,
      programId,
      title,
    );
    programs.set(athleteKey, programId);
    initialDrafts.set(athleteKey, draftId);
  }

  // Give the shared athlete one independent plan from each coach. This is the
  // core fixture for verifying that a coach sees only programs they authored.
  const sharedCoachProgramKey = "guntis-ulmanis:raimonds-vejonis";
  const sharedCoachProgramTitle = "Aerobic Support";
  const sharedCoachProgramId = expectData(
    await clients.get("raimonds-vejonis").rpc("create_blank_program", {
      target_athlete_id: identities.get("guntis-ulmanis").user.id,
      target_title: sharedCoachProgramTitle,
      target_planning_mode: "fixed_weeks",
    }),
    `Create ${sharedCoachProgramTitle}`,
  );
  const sharedCoachDraftId = await populateFixtureProgram(
    clients.get("raimonds-vejonis"),
    sharedCoachProgramId,
    sharedCoachProgramTitle,
  );
  programs.set(sharedCoachProgramKey, sharedCoachProgramId);
  initialDrafts.set(sharedCoachProgramKey, sharedCoachDraftId);

  const effectiveOn = currentMonday();
  const publishedVersions = new Map();
  for (const athleteKey of [
    "janis-cakste",
    "alberts-kviesis",
    "guntis-ulmanis",
    "vaira-vike-freiberga",
    "valdis-zatlers",
    "raimonds-vejonis",
  ]) {
    const authorKey = PROGRAM_PLANS.find(([key]) => key === athleteKey)[1];
    const authorClient = clients.get(authorKey);
    const publishedVersionId = expectData(
      await authorClient.rpc("publish_program_version", {
        target_version_id: initialDrafts.get(athleteKey),
        effective_on: effectiveOn,
      }),
      `Publish ${athleteKey} program`,
    );
    publishedVersions.set(athleteKey, publishedVersionId);
  }
  const sharedCoachVersionId = expectData(
    await clients.get("raimonds-vejonis").rpc("publish_program_version", {
      target_version_id: sharedCoachDraftId,
      effective_on: effectiveOn,
    }),
    `Publish ${sharedCoachProgramTitle}`,
  );
  publishedVersions.set(sharedCoachProgramKey, sharedCoachVersionId);

  for (const [offset, athleteKey] of [
    "janis-cakste",
    "alberts-kviesis",
    "guntis-ulmanis",
    "vaira-vike-freiberga",
    "raimonds-vejonis",
  ].entries()) {
    const athleteClient = clients.get(athleteKey);
    const versionId = publishedVersions.get(athleteKey);
    expectData(
      await athleteClient.rpc("set_program_availability", {
        target_program_id: programs.get(athleteKey),
        make_available: true,
      }),
      `Make ${athleteKey} program available`,
    );
    const occurrences = expectData(
      await athleteClient
        .from("scheduled_workouts")
        .select("id, sequence_number")
        .eq("program_version_id", versionId)
        .eq("status", "planned")
        .order("sequence_number"),
      `Load ${athleteKey} calendar workouts`,
    );
    for (const [workoutIndex, occurrence] of occurrences.entries()) {
      const plannedDate = new Date(`${asOf}T12:00:00Z`);
      plannedDate.setUTCDate(
        plannedDate.getUTCDate() + offset + workoutIndex * 3,
      );
      expectData(
        await athleteClient.rpc("schedule_workout", {
          target_scheduled_workout_id: occurrence.id,
          target_planned_date: isoDate(plannedDate),
        }),
        `Schedule ${athleteKey} workout ${workoutIndex + 1}`,
      );
    }
  }

  const sharedAthleteClient = clients.get("guntis-ulmanis");
  expectData(
    await sharedAthleteClient.rpc("set_program_availability", {
      target_program_id: sharedCoachProgramId,
      make_available: true,
    }),
    `Make ${sharedCoachProgramTitle} available`,
  );
  const sharedCoachOccurrences = expectData(
    await sharedAthleteClient
      .from("scheduled_workouts")
      .select("id, sequence_number")
      .eq("program_version_id", sharedCoachVersionId)
      .eq("status", "planned")
      .order("sequence_number"),
    `Load ${sharedCoachProgramTitle} calendar workouts`,
  );
  for (const [workoutIndex, occurrence] of sharedCoachOccurrences.entries()) {
    const plannedDate = new Date(`${asOf}T12:00:00Z`);
    plannedDate.setUTCDate(plannedDate.getUTCDate() - 5 + workoutIndex * 3);
    expectData(
      await sharedAthleteClient.rpc("schedule_workout", {
        target_scheduled_workout_id: occurrence.id,
        target_planned_date: isoDate(plannedDate),
      }),
      `Schedule ${sharedCoachProgramTitle} workout ${workoutIndex + 1}`,
    );
  }

  for (const exercise of [
    {
      owner: "valdis-zatlers",
      name: "Tempo suitcase carry",
      category: "Carry",
      cue: "Stay tall and walk slowly.",
    },
    {
      owner: "raimonds-vejonis",
      name: "Recovery movement circuit",
      category: "Mobility",
      cue: "Move continuously at an easy pace.",
    },
  ]) {
    const ownerId = identities.get(exercise.owner).user.id;
    expectData(
      await clients
        .get(exercise.owner)
        .from("exercises")
        .insert({
          scope: "personal",
          owner_id: ownerId,
          name: exercise.name,
          category: exercise.category,
          cue: exercise.cue,
          default_entry_mode: "result",
          default_tracking_fields: ["duration", "rpe"],
        })
        .select("id")
        .single(),
      `Create ${exercise.name}`,
    );
  }

  await completeFixtureOccurrence(
    clients.get("alberts-kviesis"),
    publishedVersions.get("alberts-kviesis"),
    1,
    3,
    "Easy return to the plan.",
    "Alberts Strength Foundation",
  );
  const albertsActiveOccurrence = await loadFixtureOccurrence(
    clients.get("alberts-kviesis"),
    publishedVersions.get("alberts-kviesis"),
    2,
    "Alberts Strength Foundation",
  );
  expectData(
    await clients.get("alberts-kviesis").rpc("schedule_workout", {
      target_scheduled_workout_id: albertsActiveOccurrence.id,
      target_planned_date: asOf,
    }),
    "Reschedule Alberts active workout",
  );
  expectData(
    await clients.get("alberts-kviesis").rpc("start_or_resume_workout", {
      target_workout_id: albertsActiveOccurrence.workout_id,
      target_program_version_id: albertsActiveOccurrence.program_version_id,
      target_scheduled_workout_id: albertsActiveOccurrence.id,
    }),
    "Start Alberts active workout",
  );

  await completeFixtureOccurrence(
    clients.get("guntis-ulmanis"),
    publishedVersions.get("guntis-ulmanis"),
    1,
    9,
    "High fatigue; Valdis should review.",
    "Guntis Hybrid Performance",
  );
  const guntisOverdueOccurrence = await loadFixtureOccurrence(
    clients.get("guntis-ulmanis"),
    publishedVersions.get("guntis-ulmanis"),
    2,
    "Guntis Hybrid Performance",
  );
  const overdueDate = new Date(`${asOf}T12:00:00Z`);
  overdueDate.setUTCDate(overdueDate.getUTCDate() - 1);
  expectData(
    await clients.get("guntis-ulmanis").rpc("schedule_workout", {
      target_scheduled_workout_id: guntisOverdueOccurrence.id,
      target_planned_date: isoDate(overdueDate),
    }),
    "Make Guntis follow-up workout overdue",
  );

  const vairaSkippedOccurrence = await loadFixtureOccurrence(
    clients.get("vaira-vike-freiberga"),
    publishedVersions.get("vaira-vike-freiberga"),
    2,
    "Vaira Mobility & Conditioning",
  );
  expectData(
    await admin
      .from("scheduled_workouts")
      .update({ status: "skipped" })
      .eq("id", vairaSkippedOccurrence.id)
      .select("id")
      .single(),
    "Skip Vaira terminal workout",
  );
  await completeFixtureOccurrence(
    clients.get("vaira-vike-freiberga"),
    publishedVersions.get("vaira-vike-freiberga"),
    1,
    7,
    "Comfortable and controlled.",
    "Vaira Mobility & Conditioning",
  );

  await completeFixtureOccurrence(
    sharedAthleteClient,
    sharedCoachVersionId,
    1,
    7,
    "Aerobic work felt sustainable.",
    sharedCoachProgramTitle,
  );
  await completeFixtureOccurrence(
    sharedAthleteClient,
    sharedCoachVersionId,
    2,
    null,
    "Session completed without an RPE entry.",
    sharedCoachProgramTitle,
  );

  const history = [
    [
      "janis-cakste",
      [
        {
          daysAgo: 1,
          title: "Full body",
          rpe: 7,
          note: "Steady and controlled.",
        },
        {
          daysAgo: 3,
          title: "Strength + engine",
          rpe: 8,
          note: "Strong finish.",
        },
        {
          daysAgo: 6,
          title: "Cardio + core",
          rpe: 6,
          note: "Conversational pace.",
        },
      ],
    ],
  ];
  for (const [athleteKey, entries] of history) {
    expectData(
      await admin
        .from("workout_sessions")
        .insert(completedHistory(identities.get(athleteKey).user.id, entries)),
      `Create ${athleteKey} history`,
    );
  }

  const janisId = identities.get("janis-cakste").user.id;
  const janisOccurrence = expectData(
    await clients
      .get("janis-cakste")
      .from("scheduled_workouts")
      .select("id, workout_id, program_version_id")
      .eq("athlete_id", janisId)
      .eq("status", "planned")
      .eq("planned_date", asOf)
      .limit(1)
      .single(),
    "Load Jānis planned workout",
  );
  expectData(
    await clients.get("janis-cakste").rpc("start_or_resume_workout", {
      target_workout_id: janisOccurrence.workout_id,
      target_program_version_id: janisOccurrence.program_version_id,
      target_scheduled_workout_id: janisOccurrence.id,
    }),
    "Create Jānis in-progress session",
  );

  const gustavs = identities.get("gustavs-zemgals");
  const edgars = identities.get("edgars-rinkevics");
  expectData(
    await clients
      .get("gustavs-zemgals")
      .rpc("create_coach_invite", { target_email: edgars.persona.email }),
    "Create Gustavs invitation",
  );
  expectData(
    await clients
      .get("gustavs-zemgals")
      .rpc("create_coach_invite", { target_email: edgars.persona.email }),
    "Retry Gustavs invitation idempotently",
  );
  expectData(
    await admin
      .from("coach_relationships")
      .insert({
        athlete_id: gustavs.user.id,
        coach_id: edgars.user.id,
        accepted_at: fixtureTimestamp(-14, 10),
        ended_at: fixtureTimestamp(-7, 10),
        created_at: fixtureTimestamp(-14, 10),
        updated_at: fixtureTimestamp(-7, 10),
        account_kind: "test",
      })
      .select("id")
      .single(),
    "Create deterministic historical relationship",
  );

  expectData(
    await clients
      .get("gustavs-zemgals")
      .rpc("create_coach_invite", { target_email: edgars.persona.email }),
    "Create Gustavs pending invite",
  );
  expectData(
    await clients.get("gustavs-zemgals").rpc("create_coach_invite", {
      target_email: identities.get("valdis-zatlers").persona.email,
    }),
    "Create second Gustavs pending invite",
  );
  expectData(
    await clients
      .get("janis-cakste")
      .rpc("create_coach_invite", { target_email: edgars.persona.email }),
    "Create Jānis pending invite",
  );

  expectData(
    await admin.from("coach_invites").insert({
      athlete_id: gustavs.user.id,
      invited_email: null,
      invited_profile_id: identities.get("raimonds-vejonis").user.id,
      target_identifier_kind: "id",
      token_hash: createHash("sha256")
        .update(`${manifest.namespace}:expired`)
        .digest("hex"),
      status: "expired",
      expires_at: fixtureTimestamp(-1, 12),
      created_at: fixtureTimestamp(-8, 12),
      updated_at: fixtureTimestamp(-1, 12),
      account_kind: "test",
    }),
    "Create expired invitation",
  );

  const profiles = expectData(
    await admin
      .from("profiles")
      .select(
        "id, first_name, last_name, liftlog_id, avatar_url, timezone, load_unit, distance_unit, account_kind, test_persona_key",
      )
      .in("test_persona_key", qualifiedPersonaKeys),
    "Verify fixture profiles",
  );
  if (
    profiles.length !== 9 ||
    profiles.some((profile) => profile.account_kind !== "test")
  ) {
    stop("Fixture verification failed: expected nine marked test profiles.");
  }
  for (const [key, identity] of identities) {
    const profile = profiles.find(
      (candidate) => candidate.id === identity.user.id,
    );
    if (
      !profile ||
      profile.first_name !== identity.persona.firstName ||
      profile.last_name !== identity.persona.lastName ||
      profile.liftlog_id !== identity.persona.liftlogId ||
      profile.avatar_url !== null ||
      profile.timezone !== "Europe/Riga" ||
      profile.load_unit !== "kg" ||
      profile.distance_unit !== "km"
    ) {
      stop(
        `Fixture verification failed: ${key} profile identity differs from the manifest.`,
      );
    }
  }

  const relationships = expectData(
    await admin
      .from("coach_relationships")
      .select("athlete_id, coach_id, ended_at, account_kind")
      .in(
        "athlete_id",
        [...identities.values()].map((identity) => identity.user.id),
      )
      .is("ended_at", null),
    "Verify active relationships",
  );
  if (relationships.length !== manifest.relationships.length)
    stop("Fixture verification failed: active relationship count differs.");
  const guntisId = identities.get("guntis-ulmanis").user.id;
  if (
    relationships.filter((relationship) => relationship.athlete_id === guntisId)
      .length !== 2
  ) {
    stop("Fixture verification failed: Guntis must have two active coaches.");
  }
  if (
    relationships.some((relationship) => relationship.account_kind !== "test")
  ) {
    stop("Fixture verification failed: a coaching edge is not test-isolated.");
  }
  const actualEdges = relationships
    .map((relationship) => {
      const athlete = [...identities].find(
        ([, identity]) => identity.user.id === relationship.athlete_id,
      )?.[0];
      const coach = [...identities].find(
        ([, identity]) => identity.user.id === relationship.coach_id,
      )?.[0];
      return `${athlete}:${coach}`;
    })
    .sort();
  const expectedEdges = manifest.relationships
    .map((edge) => `${edge.athlete}:${edge.coach}`)
    .sort();
  if (JSON.stringify(actualEdges) !== JSON.stringify(expectedEdges)) {
    stop(
      "Fixture verification failed: active relationship graph differs from the manifest.",
    );
  }

  const egilsPrograms = expectData(
    await admin
      .from("programs")
      .select("id")
      .eq("athlete_id", identities.get("egils-levits").user.id),
    "Verify new account",
  );
  if (egilsPrograms.length !== 0)
    stop(
      "Fixture verification failed: Egils must remain a first-login account.",
    );
  const edgarsAthletes = relationships.filter(
    (relationship) => relationship.coach_id === edgars.user.id,
  );
  if (edgarsAthletes.length !== 0)
    stop("Fixture verification failed: Edgars must have no active athletes.");

  const valdisOwnPublishedVersions = expectData(
    await admin
      .from("program_versions")
      .select("id")
      .eq("program_id", programs.get("valdis-zatlers"))
      .eq("status", "published"),
    "Verify Valdis assignment source",
  );
  if (valdisOwnPublishedVersions.length !== 1)
    stop(
      "Fixture verification failed: Valdis needs one published Own program for assignment QA.",
    );

  for (const coachKey of ["valdis-zatlers", "raimonds-vejonis"]) {
    const visible = expectData(
      await clients
        .get(coachKey)
        .from("programs")
        .select("id")
        .eq("athlete_id", guntisId),
      `Verify ${coachKey} shared access`,
    );
    if (visible.length !== 2)
      stop(
        `Fixture verification failed: ${coachKey} cannot read both Guntis programs.`,
      );
  }
  const guntisCoachPrograms = expectData(
    await admin
      .from("programs")
      .select("id, created_by_id, source_type")
      .eq("athlete_id", guntisId)
      .eq("source_type", "coach")
      .is("archived_at", null),
    "Verify shared-athlete coach programs",
  );
  for (const coachKey of ["valdis-zatlers", "raimonds-vejonis"]) {
    const coachId = identities.get(coachKey).user.id;
    if (
      guntisCoachPrograms.filter(
        (candidate) => candidate.created_by_id === coachId,
      ).length !== 1
    ) {
      stop(
        `Fixture verification failed: ${coachKey} must author exactly one Guntis program.`,
      );
    }
  }

  const coachFixtureVersionIds = [
    publishedVersions.get("alberts-kviesis"),
    publishedVersions.get("guntis-ulmanis"),
    publishedVersions.get("vaira-vike-freiberga"),
    sharedCoachVersionId,
  ];
  const linkedCoachSessions = expectData(
    await admin
      .from("workout_sessions")
      .select(
        "id, program_version_id, workout_id, scheduled_workout_id, status, session_rpe",
      )
      .in("program_version_id", coachFixtureVersionIds)
      .eq("status", "completed"),
    "Verify coach-program workout history",
  );
  if (
    linkedCoachSessions.length !== 5 ||
    linkedCoachSessions.some(
      (session) =>
        !session.program_version_id ||
        !session.workout_id ||
        !session.scheduled_workout_id,
    )
  ) {
    stop(
      "Fixture verification failed: coach-program history must contain five fully linked sessions.",
    );
  }
  const linkedRpes = new Set(
    linkedCoachSessions
      .map((session) => session.session_rpe)
      .filter((rpe) => rpe !== null)
      .map(Number),
  );
  if (
    !linkedRpes.has(3) ||
    !linkedRpes.has(7) ||
    !linkedRpes.has(9) ||
    linkedCoachSessions.filter((session) => session.session_rpe === null)
      .length !== 1
  ) {
    stop(
      "Fixture verification failed: linked coach history needs low, normal, high, and missing RPE examples.",
    );
  }
  const coachFixtureOccurrences = expectData(
    await admin
      .from("scheduled_workouts")
      .select("id, planned_date, status")
      .in("program_version_id", coachFixtureVersionIds),
    "Verify coach-program occurrence states",
  );
  if (
    !coachFixtureOccurrences.some(
      (occurrence) => occurrence.status === "in_progress",
    ) ||
    !coachFixtureOccurrences.some(
      (occurrence) => occurrence.status === "skipped",
    ) ||
    !coachFixtureOccurrences.some(
      (occurrence) =>
        occurrence.status === "planned" && occurrence.planned_date < asOf,
    )
  ) {
    stop(
      "Fixture verification failed: coach workspace needs in-progress, skipped, and overdue occurrences.",
    );
  }
  const guntisConnections = expectData(
    await clients
      .get("guntis-ulmanis")
      .from("coach_relationships")
      .select("id, coach_id")
      .eq("athlete_id", guntisId)
      .is("ended_at", null),
    "Verify Guntis coach list",
  );
  if (guntisConnections.length !== 2)
    stop("Fixture verification failed: Guntis cannot list both coaches.");
  const guntisCoachProfiles = expectData(
    await clients
      .get("guntis-ulmanis")
      .from("profiles")
      .select("id")
      .in(
        "id",
        guntisConnections.map((relationship) => relationship.coach_id),
      ),
    "Verify Guntis coach profiles",
  );
  if (guntisCoachProfiles.length !== 2)
    stop(
      "Fixture verification failed: Guntis cannot read both coach profiles.",
    );
  for (const [coachKey, expectedCount] of [
    ["valdis-zatlers", 3],
    ["raimonds-vejonis", 2],
  ]) {
    const coachId = identities.get(coachKey).user.id;
    const visibleAthletes = expectData(
      await clients
        .get(coachKey)
        .from("coach_relationships")
        .select("athlete_id")
        .eq("coach_id", coachId)
        .is("ended_at", null),
      `Verify ${coachKey} athlete list`,
    );
    if (visibleAthletes.length !== expectedCount)
      stop(`Fixture verification failed: ${coachKey} athlete count differs.`);
  }
  const unrelated = expectData(
    await clients
      .get("janis-cakste")
      .from("programs")
      .select("id")
      .eq("athlete_id", guntisId),
    "Verify unrelated isolation",
  );
  if (unrelated.length !== 0)
    stop("Fixture verification failed: unrelated athlete can read Guntis.");

  const kindMutation = await clients
    .get("janis-cakste")
    .from("profiles")
    .update({ account_kind: "real" })
    .eq("id", janisId)
    .select("id");
  if (!kindMutation.error)
    stop(
      "Fixture verification failed: a test account changed its account kind.",
    );

  const realProfile = expectData(
    await admin
      .from("profiles")
      .select("id")
      .eq("account_kind", "real")
      .limit(1)
      .maybeSingle(),
    "Find real-account sentinel",
  );
  if (realProfile) {
    const realAuthUser = existingUsers.find(
      (user) => user.id === realProfile.id,
    );
    if (realAuthUser?.email) {
      const forbiddenInvite = await clients
        .get("janis-cakste")
        .rpc("create_coach_invite", { target_email: realAuthUser.email });
      if (!forbiddenInvite.error)
        stop(
          "Fixture verification failed: test-to-real invitation was accepted.",
        );
    }
    const forbidden = await admin.from("coach_relationships").insert({
      athlete_id: realProfile.id,
      coach_id: identities.get("valdis-zatlers").user.id,
      account_kind: "real",
    });
    if (!forbidden.error)
      stop(
        "Fixture verification failed: cross-kind service relationship was accepted.",
      );
  }

  const targetLabel = localMode ? "local Supabase" : "liftlog-dev";
  process.stdout.write(
    `Seeded and verified ${manifest.personas.length} ${manifest.label} personas, ${relationships.length} active coaching relationships, and isolated QA history in ${targetLabel}.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
