import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const enabled = process.env.SUPABASE_INTEGRATION === "1";
const testUrl = process.env.SUPABASE_TEST_URL;
const databaseUrl = process.env.SUPABASE_TEST_DB_URL;
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_TEST_SECRET_KEY;

function client(key) {
  return createClient(testUrl, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function expectData(result, label) {
  assert.equal(
    result.error,
    null,
    `${label}: ${result.error?.message ?? "unknown Supabase error"}`,
  );
  return result.data;
}

async function signIn(email, password) {
  const signedInClient = client(publishableKey);
  const { data, error } = await signedInClient.auth.signInWithPassword({
    email,
    password,
  });
  assert.equal(
    error,
    null,
    `sign in ${email}: ${error?.message ?? "unknown auth error"}`,
  );
  assert.ok(data.user);
  return signedInClient;
}

function datePlus(isoDate, days) {
  const value = new Date(`${isoDate}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function cleanupApplicationData(database, userIds) {
  if (!userIds.length) return;
  const guardedTables = [
    "program_versions",
    "program_phases",
    "program_weeks",
    "workouts",
    "workout_sections",
    "workout_items",
    "prescribed_entries",
    "workout_sessions",
    "session_item_logs",
    "session_entries",
  ];
  await database.begin(async (sql) => {
    for (const table of guardedTables)
      await sql.unsafe(`alter table public.${table} disable trigger user`);
    try {
      await sql`delete from public.coach_feedback where athlete_id in ${sql(userIds)} or coach_id in ${sql(userIds)}`;
      await sql`delete from public.workout_sessions where athlete_id in ${sql(userIds)}`;
      await sql`delete from public.scheduled_workouts where athlete_id in ${sql(userIds)}`;
      await sql`delete from public.programs where athlete_id in ${sql(userIds)}`;
      await sql`delete from public.coach_invites where athlete_id in ${sql(userIds)} or invited_profile_id in ${sql(userIds)}`;
      await sql`delete from public.coach_relationships where athlete_id in ${sql(userIds)} or coach_id in ${sql(userIds)}`;
      await sql`delete from public.exercises where owner_id in ${sql(userIds)}`;
    } finally {
      for (const table of [...guardedTables].reverse())
        await sql.unsafe(`alter table public.${table} enable trigger user`);
    }
  });
}

test(
  "Supabase enforces private accounts, exact invitations, explicit programs, and athlete-owned scheduling",
  { skip: !enabled },
  async () => {
    assert.ok(
      testUrl && databaseUrl && publishableKey && secretKey,
      "local Supabase credentials are required",
    );
    assert.ok(
      ["localhost", "127.0.0.1"].includes(new URL(testUrl).hostname),
      "integration tests may only mutate local Supabase",
    );
    assert.ok(
      ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
      "cleanup may only use local Postgres",
    );

    const admin = client(secretKey);
    const database = postgres(databaseUrl, { max: 1 });
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const password = `LiftLog-${randomUUID()}!`;
    const identities = [
      {
        role: "athlete A",
        email: `athlete-a-${suffix}@liftlog.test`,
        firstName: "Athlete",
        lastName: "Alpha",
      },
      {
        role: "athlete B",
        email: `athlete-b-${suffix}@liftlog.test`,
        firstName: "Athlete",
        lastName: "Beta",
      },
      {
        role: "coach",
        email: `coach-${suffix}@liftlog.test`,
        firstName: "Coach",
        lastName: "Gamma",
      },
    ];
    const userIds = [];
    let athleteAId;
    let athleteBId;
    let coachId;

    try {
      for (const identity of identities) {
        const { data, error } = await admin.auth.admin.createUser({
          email: identity.email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: `${identity.firstName} ${identity.lastName}`,
            given_name: identity.firstName,
            family_name: identity.lastName,
          },
        });
        assert.equal(
          error,
          null,
          `create ${identity.role}: ${error?.message ?? "unknown auth error"}`,
        );
        assert.ok(data.user);
        userIds.push(data.user.id);
      }
      [athleteAId, athleteBId, coachId] = userIds;
      const athleteA = await signIn(identities[0].email, password);
      const athleteB = await signIn(identities[1].email, password);
      const coach = await signIn(identities[2].email, password);

      const resetNamespace = `integration-${Date.now()}-${randomUUID().slice(0, 8)}-v1`;
      assert.match(
        (
          await athleteA.rpc("reset_test_population", {
            expected_namespace: resetNamespace,
            expected_persona_keys: ["missing-persona"],
          })
        ).error?.message ?? "",
        /permission denied/i,
      );
      assert.deepEqual(
        expectData(
          await admin.rpc("reset_test_population", {
            expected_namespace: resetNamespace,
            expected_persona_keys: ["missing-persona"],
          }),
          "probe exact reset signature",
        ),
        { removed: 0, namespace: resetNamespace },
      );

      for (let read = 0; read < 2; read += 1) {
        assert.deepEqual(
          expectData(
            await athleteA
              .from("programs")
              .select("id")
              .eq("athlete_id", athleteAId),
            `empty workspace read ${read + 1}`,
          ),
          [],
        );
      }
      assert.match(
        (
          await athleteA.rpc("ensure_starter_program", {
            target_athlete_id: athleteAId,
          })
        ).error?.message ?? "",
        /permission denied/i,
      );

      const ownProfile = expectData(
        await athleteA
          .from("profiles")
          .select("id,liftlog_id")
          .eq("id", athleteAId)
          .single(),
        "load own account",
      );
      assert.match(ownProfile.liftlog_id, /^LL-[A-Z0-9]{16}$/);
      assert.notEqual(ownProfile.liftlog_id, athleteAId);
      assert.deepEqual(
        expectData(
          await athleteB.from("profiles").select("id").eq("id", athleteAId),
          "unrelated account read",
        ),
        [],
      );
      const updatedProfile = expectData(
        await athleteA.rpc("update_own_profile", {
          target_first_name: "Alicia",
          target_last_name: "Athlete",
        }),
        "edit own account",
      );
      assert.equal(updatedProfile.displayName, "Alicia Athlete");
      assert.match(
        (
          await athleteA
            .from("profiles")
            .update({ liftlog_id: "LL-FFFFFFFFFFFFFFFF" })
            .eq("id", athleteAId)
        ).error?.message ?? "",
        /LiftLog ID cannot be changed/i,
      );
      assert.deepEqual(
        expectData(
          await athleteB
            .from("profiles")
            .update({ first_name: "Nope" })
            .eq("id", athleteAId)
            .select("id"),
          "unrelated account write",
        ),
        [],
      );

      const templates = expectData(
        await athleteB
          .from("program_templates")
          .select("id,title")
          .eq("is_active", true)
          .order("title"),
        "load program library",
      );
      assert.equal(templates.length, 3);
      const libraryProgramId = expectData(
        await athleteB.rpc("create_program_from_template", {
          target_template_id: templates[0].id,
        }),
        "choose library program",
      );
      const libraryProgram = expectData(
        await athleteB
          .from("programs")
          .select("source_type,template_id")
          .eq("id", libraryProgramId)
          .single(),
        "load library provenance",
      );
      assert.deepEqual(libraryProgram, {
        source_type: "library",
        template_id: templates[0].id,
      });
      const libraryPublished = expectData(
        await athleteB
          .from("program_versions")
          .select("id")
          .eq("program_id", libraryProgramId)
          .eq("status", "published")
          .single(),
        "load library version",
      );
      const libraryOccurrences = expectData(
        await athleteB
          .from("scheduled_workouts")
          .select("id,planned_date,scheduled_by_id")
          .eq("program_version_id", libraryPublished.id),
        "load undated library workouts",
      );
      assert.ok(libraryOccurrences.length > 0);
      assert.ok(
        libraryOccurrences.every(
          (occurrence) =>
            occurrence.planned_date === null &&
            occurrence.scheduled_by_id === athleteBId,
        ),
      );

      const programId = expectData(
        await athleteA.rpc("create_blank_program", {
          target_athlete_id: athleteAId,
          target_title: "Flexible test plan",
          target_planning_mode: "fixed_weeks",
        }),
        "create blank program",
      );
      assert.match(
        (
          await athleteA.rpc("create_blank_program", {
            target_athlete_id: athleteAId,
            target_title: "Duplicate",
            target_planning_mode: "fixed_weeks",
          })
        ).error?.message ?? "",
        /already has a current program/i,
      );
      const draftVersion = expectData(
        await athleteA
          .from("program_versions")
          .select("id")
          .eq("program_id", programId)
          .eq("status", "draft")
          .single(),
        "load draft",
      );
      const week = expectData(
        await athleteA
          .from("program_weeks")
          .select("id")
          .eq("program_version_id", draftVersion.id)
          .single(),
        "load week",
      );
      const athleteWorkout = expectData(
        await athleteA
          .from("workouts")
          .insert({
            program_week_id: week.id,
            title: "Strength session",
            day_of_week: null,
            schedule_label: "Workout 1",
            position: 0,
            estimated_minutes: 45,
          })
          .select("id,title")
          .single(),
        "add ordered workout",
      );
      const section = expectData(
        await athleteA
          .from("workout_sections")
          .insert({
            workout_id: athleteWorkout.id,
            title: "Main work",
            section_kind: "main",
            notes: "",
            position: 0,
          })
          .select("id")
          .single(),
        "add section",
      );
      const item = expectData(
        await athleteA
          .from("workout_items")
          .insert({
            section_id: section.id,
            snapshot_name: "Goblet squat",
            snapshot_cue: "Move with control.",
            entry_mode: "sets",
            tracking_fields: ["reps", "load", "rpe"],
            position: 0,
          })
          .select("id")
          .single(),
        "add universal exercise item",
      );
      expectData(
        await athleteA.from("prescribed_entries").insert({
          workout_item_id: item.id,
          position: 0,
          reps_min: 8,
          reps_max: 10,
          target_rpe_min: 7,
          target_rpe_max: 8,
        }),
        "add prescription",
      );

      const coachProfile = expectData(
        await coach
          .from("profiles")
          .select("liftlog_id")
          .eq("id", coachId)
          .single(),
        "load coach ID",
      );
      const emailTarget = expectData(
        await athleteA.rpc("resolve_coach_invite_target", {
          target_identifier: identities[2].email.toUpperCase(),
        }),
        "resolve exact email",
      );
      assert.equal(emailTarget.identifierType, "email");
      assert.equal(emailTarget.liftlogId, null);
      const idTarget = expectData(
        await athleteA.rpc("resolve_coach_invite_target", {
          target_identifier: coachProfile.liftlog_id.toLowerCase(),
        }),
        "resolve exact ID",
      );
      assert.equal(idTarget.liftlogId, coachProfile.liftlog_id);
      assert.doesNotMatch(JSON.stringify(idTarget), /@liftlog\.test/i);
      assert.ok(
        (
          await athleteA.rpc("resolve_coach_invite_target", {
            target_identifier: coachProfile.liftlog_id.slice(0, -2),
          })
        ).error,
      );
      assert.match(
        (
          await athleteA.rpc("resolve_coach_invite_target", {
            target_identifier: `missing-${suffix}@liftlog.test`,
          })
        ).error?.message ?? "",
        /No available account/i,
      );
      assert.match(
        (
          await athleteA.rpc("create_coach_invite", {
            target_email: `missing-${suffix}@liftlog.test`,
          })
        ).error?.message ?? "",
        /No available account/i,
      );

      const idInvitation = expectData(
        await athleteA.rpc("create_coach_invite", {
          target_email: coachProfile.liftlog_id,
        }),
        "invite by ID",
      );
      assert.equal(idInvitation.targetProfileId, coachId);
      assert.equal(idInvitation.targetName, "Coach Gamma");
      assert.equal("token" in idInvitation, false);
      assert.deepEqual(
        expectData(
          await athleteA
            .from("coach_invites")
            .select("invited_email,invited_profile_id,target_identifier_kind")
            .eq("id", idInvitation.id)
            .single(),
          "load ID invite",
        ),
        {
          invited_email: null,
          invited_profile_id: coachId,
          target_identifier_kind: "id",
        },
      );
      assert.match(
        (
          await athleteB.rpc("respond_to_coach_invite", {
            target_invite_id: idInvitation.id,
            target_response: "accepted",
          })
        ).error?.message ?? "",
        /not found/i,
      );
      const pendingInvites = expectData(
        await coach.rpc("list_pending_coach_invites"),
        "list pending in-app invitations",
      );
      assert.equal(pendingInvites.length, 1);
      assert.equal(pendingInvites[0].id, idInvitation.id);
      assert.equal(pendingInvites[0].athlete_id, athleteAId);
      assert.equal(pendingInvites[0].athlete_name, "Alicia Athlete");

      const acceptedInvitation = expectData(
        await coach.rpc("respond_to_coach_invite", {
          target_invite_id: idInvitation.id,
          target_response: "accepted",
        }),
        "accept bound in-app request",
      );
      const relationshipId = acceptedInvitation.relationshipId;
      assert.ok(relationshipId);

      const emailInvitation = expectData(
        await athleteB.rpc("create_coach_invite", {
          target_email: identities[2].email,
        }),
        "invite by email",
      );
      assert.deepEqual(
        expectData(
          await athleteB
            .from("coach_invites")
            .select("invited_email,invited_profile_id,target_identifier_kind")
            .eq("id", emailInvitation.id)
            .single(),
          "load email invite",
        ),
        {
          invited_email: null,
          invited_profile_id: coachId,
          target_identifier_kind: "email",
        },
      );
      expectData(
        await coach.rpc("respond_to_coach_invite", {
          target_invite_id: emailInvitation.id,
          target_response: "declined",
        }),
        "decline email invitation",
      );
      assert.equal(
        expectData(
          await athleteB
            .from("coach_invites")
            .select("status")
            .eq("id", emailInvitation.id)
            .single(),
          "load declined invitation",
        ).status,
        "declined",
      );
      const replacementEmailInvitation = expectData(
        await athleteB.rpc("create_coach_invite", {
          target_email: identities[2].email,
        }),
        "re-invite after declining",
      );
      expectData(
        await coach.rpc("respond_to_coach_invite", {
          target_invite_id: replacementEmailInvitation.id,
          target_response: "accepted",
        }),
        "accept replacement email invitation",
      );
      assert.equal(
        expectData(
          await coach.from("programs").select("id").eq("id", programId),
          "coach reads program",
        ).length,
        1,
      );
      assert.equal(
        expectData(
          await coach
            .from("profiles")
            .select("display_name")
            .eq("id", athleteAId)
            .single(),
          "coach reads connected name",
        ).display_name,
        "Alicia Athlete",
      );

      const coachWorkout = expectData(
        await coach
          .from("workouts")
          .insert({
            program_week_id: week.id,
            title: "Coach mobility session",
            day_of_week: null,
            schedule_label: "Workout 2",
            position: 1,
            estimated_minutes: 30,
          })
          .select("id,title")
          .single(),
        "coach edits future content",
      );
      const effectiveOn = new Date().toISOString().slice(0, 10);
      assert.equal(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("athlete_id", athleteAId),
          "calendar before publish",
        ).length,
        0,
      );
      assert.equal(
        expectData(
          await coach.rpc("publish_program_version", {
            target_version_id: draftVersion.id,
            effective_on: effectiveOn,
          }),
          "coach publishes content",
        ),
        draftVersion.id,
      );
      assert.equal(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("athlete_id", athleteAId),
          "calendar after publish",
        ).length,
        0,
      );

      assert.match(
        (
          await coach.rpc("prepare_program_schedule", {
            target_program_version_id: draftVersion.id,
          })
        ).error?.message ?? "",
        /Only the athlete/i,
      );
      assert.match(
        (
          await athleteA.rpc("prepare_program_schedule", {
            target_program_version_id: draftVersion.id,
          })
        ).error?.message ?? "",
        /not available/i,
      );
      assert.equal(
        expectData(
          await athleteA.rpc("set_program_availability", {
            target_program_id: programId,
            make_available: true,
          }),
          "athlete makes program available",
        ),
        true,
      );
      assert.equal(
        expectData(
          await athleteA.rpc("prepare_program_schedule", {
            target_program_version_id: draftVersion.id,
          }),
          "repeat calendar preparation",
        ),
        0,
      );
      const occurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select("*")
          .eq("program_version_id", draftVersion.id)
          .order("sequence_number"),
        "load occurrences",
      );
      assert.equal(occurrences.length, 2);
      assert.deepEqual(
        occurrences.map((occurrence) => ({
          athlete_id: occurrence.athlete_id,
          scheduled_by_id: occurrence.scheduled_by_id,
          program_version_id: occurrence.program_version_id,
          workout_id: occurrence.workout_id,
          planned_date: occurrence.planned_date,
          sequence_number: occurrence.sequence_number,
          status: occurrence.status,
        })),
        [
          {
            athlete_id: athleteAId,
            scheduled_by_id: athleteAId,
            program_version_id: draftVersion.id,
            workout_id: athleteWorkout.id,
            planned_date: null,
            sequence_number: 1,
            status: "planned",
          },
          {
            athlete_id: athleteAId,
            scheduled_by_id: athleteAId,
            program_version_id: draftVersion.id,
            workout_id: coachWorkout.id,
            planned_date: null,
            sequence_number: 2,
            status: "planned",
          },
        ],
      );
      assert.equal(
        new Set(occurrences.map((occurrence) => occurrence.id)).size,
        2,
      );
      assert.match(
        (
          await athleteA
            .from("scheduled_workouts")
            .update({ planned_date: effectiveOn })
            .eq("id", occurrences[0].id)
        ).error?.message ?? "",
        /permission denied/i,
      );
      assert.match(
        (
          await coach
            .from("scheduled_workouts")
            .update({ planned_date: effectiveOn })
            .eq("id", occurrences[0].id)
        ).error?.message ?? "",
        /permission denied/i,
      );
      assert.match(
        (
          await coach.rpc("schedule_workout", {
            target_scheduled_workout_id: occurrences[0].id,
            target_planned_date: effectiveOn,
          })
        ).error?.message ?? "",
        /cannot be scheduled/i,
      );

      expectData(
        await athleteA.rpc("schedule_workout", {
          target_scheduled_workout_id: occurrences[0].id,
          target_planned_date: effectiveOn,
        }),
        "schedule first",
      );
      expectData(
        await athleteA.rpc("schedule_workout", {
          target_scheduled_workout_id: occurrences[1].id,
          target_planned_date: datePlus(effectiveOn, 1),
        }),
        "schedule second",
      );
      expectData(
        await athleteA.rpc("schedule_workout", {
          target_scheduled_workout_id: occurrences[0].id,
          target_planned_date: datePlus(effectiveOn, 2),
        }),
        "reschedule first",
      );
      const coachCalendar = expectData(
        await coach
          .from("scheduled_workouts")
          .select("*")
          .eq("program_version_id", draftVersion.id)
          .order("sequence_number"),
        "coach reads calendar",
      );
      assert.equal(coachCalendar[0].planned_date, datePlus(effectiveOn, 2));

      const freshDraft = expectData(
        await coach
          .from("program_versions")
          .select("id")
          .eq("program_id", programId)
          .eq("status", "draft")
          .single(),
        "load next draft",
      );
      const calendarBeforeRepublish = structuredClone(coachCalendar);
      assert.deepEqual(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("program_version_id", freshDraft.id),
          "future version calendar before publish",
        ),
        [],
      );
      expectData(
        await coach.rpc("publish_program_version", {
          target_version_id: freshDraft.id,
          effective_on: effectiveOn,
        }),
        "publish later content revision",
      );
      const calendarAfterRepublish = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select("*")
          .eq("program_version_id", draftVersion.id)
          .order("sequence_number"),
        "calendar after republish",
      );
      assert.deepEqual(calendarAfterRepublish, calendarBeforeRepublish);
      assert.equal(
        expectData(
          await athleteA
            .from("program_versions")
            .select("status")
            .eq("id", draftVersion.id)
            .single(),
          "load superseded version",
        ).status,
        "superseded",
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("program_version_id", freshDraft.id),
          "new published calendar before preparation",
        ),
        [],
      );
      assert.equal(
        expectData(
          await athleteA.rpc("prepare_program_schedule", {
            target_program_version_id: freshDraft.id,
          }),
          "prepare replacement version calendar",
        ),
        2,
      );
      assert.equal(
        expectData(
          await athleteA.rpc("prepare_program_schedule", {
            target_program_version_id: freshDraft.id,
          }),
          "repeat replacement calendar preparation",
        ),
        0,
      );
      const replacementOccurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select("*")
          .eq("program_version_id", freshDraft.id)
          .order("sequence_number"),
        "load replacement occurrences",
      );
      assert.equal(replacementOccurrences.length, 2);
      assert.ok(
        replacementOccurrences.every(
          (occurrence, index) =>
            occurrence.athlete_id === athleteAId &&
            occurrence.scheduled_by_id === athleteAId &&
            occurrence.program_version_id === freshDraft.id &&
            occurrence.planned_date === null &&
            occurrence.sequence_number === index + 1 &&
            occurrence.status === "planned",
        ),
      );
      assert.equal(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("athlete_id", athleteAId),
          "complete versioned calendar",
        ).length,
        4,
      );

      assert.deepEqual(
        expectData(
          await athleteA
            .from("workouts")
            .update({ title: "Changed" })
            .eq("id", coachWorkout.id)
            .select("id"),
          "published content write",
        ),
        [],
      );
      assert.match(
        (
          await admin
            .from("workouts")
            .update({ title: "Service change" })
            .eq("id", coachWorkout.id)
        ).error?.message ?? "",
        /Published program content is immutable/,
      );

      const occurrence = occurrences[0];
      const sessionId = expectData(
        await athleteA.rpc("start_or_resume_workout", {
          target_workout_id: occurrence.workout_id,
          target_program_version_id: occurrence.program_version_id,
          target_scheduled_workout_id: occurrence.id,
        }),
        "start workout",
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select(
              "athlete_id,scheduled_by_id,program_version_id,workout_id,planned_date,sequence_number,status",
            )
            .eq("id", occurrence.id)
            .single(),
          "load active occurrence",
        ),
        {
          athlete_id: athleteAId,
          scheduled_by_id: athleteAId,
          program_version_id: draftVersion.id,
          workout_id: occurrence.workout_id,
          planned_date: datePlus(effectiveOn, 2),
          sequence_number: 1,
          status: "in_progress",
        },
      );
      assert.equal(
        expectData(
          await athleteA.rpc("start_or_resume_workout", {
            target_workout_id: occurrence.workout_id,
            target_program_version_id: occurrence.program_version_id,
            target_scheduled_workout_id: occurrence.id,
          }),
          "resume workout",
        ),
        sessionId,
      );
      assert.match(
        (
          await athleteA.rpc("schedule_workout", {
            target_scheduled_workout_id: occurrence.id,
            target_planned_date: datePlus(effectiveOn, 3),
          })
        ).error?.message ?? "",
        /cannot be scheduled/i,
      );
      const loggedItem = expectData(
        await athleteA
          .from("session_item_logs")
          .select("id")
          .eq("workout_session_id", sessionId)
          .neq("entry_mode", "none")
          .limit(1)
          .single(),
        "load logged item",
      );
      const sessionEntry = expectData(
        await athleteA
          .from("session_entries")
          .select("id")
          .eq("session_item_log_id", loggedItem.id)
          .limit(1)
          .single(),
        "load entry",
      );
      expectData(
        await athleteA
          .from("session_entries")
          .update({ reps: 9, load_kg: 24, rpe: 7 })
          .eq("id", sessionEntry.id)
          .select("id")
          .single(),
        "save result",
      );
      expectData(
        await athleteA.rpc("complete_workout_session", {
          target_session_id: sessionId,
          final_rpe: 7,
          final_note: "Controlled.",
        }),
        "complete workout",
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("workout_sessions")
            .select("status,session_rpe")
            .eq("id", sessionId)
            .single(),
          "load completed workout",
        ),
        { status: "completed", session_rpe: 7 },
      );
      assert.equal(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("status")
            .eq("id", occurrence.id)
            .single(),
          "load completed occurrence",
        ).status,
        "completed",
      );
      assert.match(
        (
          await athleteA.rpc("schedule_workout", {
            target_scheduled_workout_id: occurrence.id,
            target_planned_date: datePlus(effectiveOn, 4),
          })
        ).error?.message ?? "",
        /cannot be scheduled/i,
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("session_entries")
            .update({ reps: 99 })
            .eq("id", sessionEntry.id)
            .select("id"),
          "completed result write",
        ),
        [],
      );
      assert.match(
        (
          await admin
            .from("session_entries")
            .update({ reps: 100 })
            .eq("id", sessionEntry.id)
        ).error?.message ?? "",
        /Completed workout history is immutable/,
      );

      expectData(
        await athleteA
          .from("coach_relationships")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", relationshipId)
          .select("id")
          .single(),
        "revoke coach",
      );
      assert.deepEqual(
        expectData(
          await coach.from("programs").select("id").eq("id", programId),
          "revoked coach read",
        ),
        [],
      );
      assert.equal(
        expectData(
          await coach.from("programs").select("id").eq("id", libraryProgramId),
          "other athlete remains connected",
        ).length,
        1,
      );
      assert.ok(
        (
          await coach.from("workouts").insert({
            program_week_id: week.id,
            title: "Forbidden",
            schedule_label: "Workout 3",
            position: 2,
            estimated_minutes: 20,
          })
        ).error,
      );
    } finally {
      await cleanupApplicationData(database, userIds);
      for (const userId of [coachId, athleteBId, athleteAId].filter(Boolean)) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        assert.equal(
          error,
          null,
          `delete temporary user: ${error?.message ?? "unknown auth error"}`,
        );
      }
      await database.end();
    }
  },
);
