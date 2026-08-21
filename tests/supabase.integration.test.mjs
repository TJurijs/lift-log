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
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

function expectData(result, label) {
  assert.equal(result.error, null, `${label}: ${result.error?.message ?? "unknown Supabase error"}`);
  return result.data;
}

async function signIn(email, password) {
  const signedInClient = client(publishableKey);
  const { data, error } = await signedInClient.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `sign in ${email}: ${error?.message ?? "unknown auth error"}`);
  assert.ok(data.user);
  return signedInClient;
}

async function cleanupApplicationData(database, userIds) {
  if (userIds.length === 0) return;
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
    for (const table of guardedTables) {
      await sql.unsafe(`alter table public.${table} disable trigger user`);
    }
    try {
      await sql`delete from public.coach_feedback where athlete_id in ${sql(userIds)} or coach_id in ${sql(userIds)}`;
      await sql`delete from public.workout_sessions where athlete_id in ${sql(userIds)}`;
      await sql`delete from public.scheduled_workouts where athlete_id in ${sql(userIds)}`;
      await sql`delete from public.programs where athlete_id in ${sql(userIds)}`;
      await sql`delete from public.coach_invites where athlete_id in ${sql(userIds)}`;
      await sql`delete from public.coach_relationships where athlete_id in ${sql(userIds)} or coach_id in ${sql(userIds)}`;
      await sql`delete from public.exercises where owner_id in ${sql(userIds)}`;
    } finally {
      for (const table of [...guardedTables].reverse()) {
        await sql.unsafe(`alter table public.${table} enable trigger user`);
      }
    }
  });
}

test("Supabase enforces the complete athlete and coach authorization lifecycle", { skip: !enabled }, async () => {
  assert.ok(testUrl && databaseUrl && publishableKey && secretKey, "local Supabase credentials are required");
  const hostname = new URL(testUrl).hostname;
  assert.ok(hostname === "localhost" || hostname === "127.0.0.1", "integration tests may only mutate local Supabase");
  const databaseHostname = new URL(databaseUrl).hostname;
  assert.ok(databaseHostname === "localhost" || databaseHostname === "127.0.0.1", "cleanup may only use local Postgres");

  const admin = client(secretKey);
  const database = postgres(databaseUrl, { max: 1 });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const password = `LiftLog-${randomUUID()}!`;
  const identities = [
    { role: "athlete A", email: `athlete-a-${suffix}@liftlog.test`, name: "Athlete A" },
    { role: "athlete B", email: `athlete-b-${suffix}@liftlog.test`, name: "Athlete B" },
    { role: "coach", email: `coach-${suffix}@liftlog.test`, name: "Coach" },
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
          user_metadata: { full_name: identity.name },
      });
      assert.equal(error, null, `create ${identity.role}: ${error?.message ?? "unknown auth error"}`);
      assert.ok(data.user);
      userIds.push(data.user.id);
    }
    [athleteAId, athleteBId, coachId] = userIds;

    const athleteA = await signIn(identities[0].email, password);
    const athleteB = await signIn(identities[1].email, password);
    const coach = await signIn(identities[2].email, password);

    const programId = expectData(
      await athleteA.rpc("ensure_starter_program", { target_athlete_id: athleteAId }),
      "create starter program",
    );
    assert.equal(
      expectData(
        await athleteA.rpc("ensure_starter_program", { target_athlete_id: athleteAId }),
        "reuse starter program",
      ),
      programId,
      "starter creation must be idempotent",
    );

    const draftVersion = expectData(
      await athleteA
        .from("program_versions")
        .select("id,status")
        .eq("program_id", programId)
        .eq("status", "draft")
        .single(),
      "load starter draft",
    );
    const weeks = expectData(
      await athleteA
        .from("program_weeks")
        .select("id,week_index")
        .eq("program_version_id", draftVersion.id)
        .order("week_index"),
      "load starter weeks",
    );
    assert.equal(weeks.length, 6);

    const globalExercises = expectData(
      await athleteA.from("exercises").select("id").eq("scope", "global"),
      "load global exercise library",
    );
    assert.equal(globalExercises.length, 12);

    const isolatedRead = expectData(
      await athleteB.from("programs").select("id").eq("id", programId),
      "test athlete isolation",
    );
    assert.deepEqual(isolatedRead, []);
    const forbiddenStarter = await athleteB.rpc("ensure_starter_program", { target_athlete_id: athleteAId });
    assert.ok(forbiddenStarter.error, "another athlete must not create or access this program through the RPC");

    const invitation = expectData(
      await athleteA.rpc("create_coach_invite", { target_email: identities[2].email }),
      "create coach invitation",
    );
    assert.ok(invitation.token);
    const relationshipId = expectData(
      await coach.rpc("accept_coach_invite", { invite_token: invitation.token }),
      "accept coach invitation",
    );

    const coachRead = expectData(
      await coach.from("programs").select("id").eq("id", programId),
      "coach reads athlete program",
    );
    assert.equal(coachRead.length, 1);

    const coachWorkout = expectData(
      await coach
        .from("workouts")
        .insert({
          program_week_id: weeks[0].id,
          title: "Coach mobility check-in",
          day_of_week: 3,
          schedule_label: "Wednesday",
          position: 3,
          estimated_minutes: 30,
        })
        .select("id,title")
        .single(),
      "coach edits draft program",
    );

    expectData(
      await athleteA
        .from("coach_relationships")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", relationshipId)
        .select("id")
        .single(),
      "athlete revokes coach",
    );

    const revokedRead = expectData(
      await coach.from("programs").select("id").eq("id", programId),
      "revoked coach read",
    );
    assert.deepEqual(revokedRead, []);
    const revokedWrite = await coach.from("workouts").insert({
      program_week_id: weeks[0].id,
      title: "Forbidden change",
      schedule_label: "Flexible",
      position: 4,
      estimated_minutes: 20,
    });
    assert.ok(revokedWrite.error, "a revoked coach must not edit the athlete draft");

    const effectiveOn = new Date().toISOString().slice(0, 10);
    const publishedVersionId = expectData(
      await athleteA.rpc("publish_program_version", {
        target_version_id: draftVersion.id,
        effective_on: effectiveOn,
      }),
      "publish program",
    );
    assert.equal(publishedVersionId, draftVersion.id);

    const scheduledWorkouts = expectData(
      await athleteA
        .from("scheduled_workouts")
        .select("id,workout_id,program_version_id,sequence_number,status")
        .eq("program_version_id", publishedVersionId)
        .order("sequence_number"),
      "load published schedule",
    );
    assert.equal(scheduledWorkouts.length, 19, "six three-day weeks plus the coach-added workout are scheduled");

    const immutablePlanWrite = expectData(
      await athleteA
        .from("workouts")
        .update({ title: "Changed after publication" })
        .eq("id", coachWorkout.id)
        .select("id"),
      "attempt published workout update",
    );
    assert.deepEqual(immutablePlanWrite, []);
    const unchangedWorkout = expectData(
      await athleteA.from("workouts").select("title").eq("id", coachWorkout.id).single(),
      "reload published workout",
    );
    assert.equal(unchangedWorkout.title, coachWorkout.title);
    const triggerProtectedPlan = await admin
      .from("workouts")
      .update({ title: "Service-key change" })
      .eq("id", coachWorkout.id);
    assert.match(triggerProtectedPlan.error?.message ?? "", /Published program content is immutable/);

    const occurrence = scheduledWorkouts[0];
    const sessionId = expectData(
      await athleteA.rpc("start_or_resume_workout", {
        target_workout_id: occurrence.workout_id,
        target_program_version_id: occurrence.program_version_id,
        target_scheduled_workout_id: occurrence.id,
      }),
      "start workout",
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

    const loggedItem = expectData(
      await athleteA
        .from("session_item_logs")
        .select("id")
        .eq("workout_session_id", sessionId)
        .neq("entry_mode", "none")
        .order("position")
        .limit(1)
        .single(),
      "load logged exercise",
    );
    const sessionEntry = expectData(
      await athleteA
        .from("session_entries")
        .select("id")
        .eq("session_item_log_id", loggedItem.id)
        .order("position")
        .limit(1)
        .single(),
      "load session entry",
    );
    expectData(
      await athleteA
        .from("session_entries")
        .update({ reps: 6, load_kg: 80, rpe: 7 })
        .eq("id", sessionEntry.id)
        .select("id")
        .single(),
      "save in-progress session entry",
    );

    expectData(
      await athleteA.rpc("complete_workout_session", {
        target_session_id: sessionId,
        final_rpe: 7,
        final_note: "Controlled and repeatable.",
      }),
      "complete workout",
    );
    const completedSession = expectData(
      await athleteA.from("workout_sessions").select("status,session_rpe").eq("id", sessionId).single(),
      "load completed session",
    );
    assert.deepEqual(completedSession, { status: "completed", session_rpe: 7 });
    const completedOccurrence = expectData(
      await athleteA.from("scheduled_workouts").select("status").eq("id", occurrence.id).single(),
      "load completed occurrence",
    );
    assert.equal(completedOccurrence.status, "completed");

    const immutableEntryWrite = expectData(
      await athleteA
        .from("session_entries")
        .update({ reps: 99 })
        .eq("id", sessionEntry.id)
        .select("id"),
      "attempt completed entry update",
    );
    assert.deepEqual(immutableEntryWrite, []);
    const unchangedEntry = expectData(
      await athleteA.from("session_entries").select("reps").eq("id", sessionEntry.id).single(),
      "reload completed entry",
    );
    assert.equal(unchangedEntry.reps, 6);
    const triggerProtectedEntry = await admin
      .from("session_entries")
      .update({ reps: 100 })
      .eq("id", sessionEntry.id);
    assert.match(triggerProtectedEntry.error?.message ?? "", /Completed workout history is immutable/);
    const triggerProtectedSession = await admin
      .from("workout_sessions")
      .update({ athlete_note: "Service-key change" })
      .eq("id", sessionId);
    assert.match(triggerProtectedSession.error?.message ?? "", /Completed workout sessions are immutable/);
  } finally {
    await cleanupApplicationData(database, userIds);
    for (const userId of [coachId, athleteBId, athleteAId].filter(Boolean)) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      assert.equal(error, null, `delete temporary user: ${error?.message ?? "unknown auth error"}`);
    }
    await database.end();
  }
});
