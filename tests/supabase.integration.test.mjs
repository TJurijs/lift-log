import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { throwIntegrationFailures } from "./supabase-integration-fixture.mjs";
import {
  validateIntegrationCredentials,
  validateIntegrationTarget,
} from "./supabase-integration-target.mjs";

const enabled = process.env.SUPABASE_INTEGRATION === "1";
const testUrl = process.env.SUPABASE_TEST_URL;
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

function dateInTimeZone(timeZone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

// Several assertions below retain historical schedule rows as test fixtures
// for read/session compatibility. The app-facing V0 occurrence RPC is revoked
// now, so fixture setup is deliberately explicit and service-role-only.
async function insertLegacyOccurrenceFixture(
  admin,
  {
    athleteId,
    scheduledById,
    assignmentId = null,
    programVersionId,
    workoutId,
    plannedDate,
    requestKey,
  },
) {
  const existing = expectData(
    await admin
      .from("scheduled_workouts")
      .select("*")
      .eq("athlete_id", athleteId)
      .eq("request_key", requestKey),
    "load legacy fixture receipt",
  )[0];
  if (existing) {
    if (
      existing.assignment_id !== assignmentId ||
      existing.program_version_id !== programVersionId ||
      existing.workout_id !== workoutId ||
      existing.planned_date !== plannedDate
    ) {
      throw new Error("Idempotency key was already used for another occurrence");
    }
    return {
      id: existing.id,
      assignmentId: existing.assignment_id,
      programVersionId: existing.program_version_id,
      workoutId: existing.workout_id,
      plannedDate: existing.planned_date,
      sequenceNumber: existing.sequence_number,
      status: existing.status,
      created: false,
    };
  }

  const latest = expectData(
    await admin
      .from("scheduled_workouts")
      .select("sequence_number")
      .eq("athlete_id", athleteId)
      .eq("program_version_id", programVersionId)
      .order("sequence_number", { ascending: false })
      .limit(1),
    "load legacy fixture sequence",
  )[0];
  const inserted = expectData(
    await admin
      .from("scheduled_workouts")
      .insert({
        athlete_id: athleteId,
        scheduled_by_id: scheduledById,
        assignment_id: assignmentId,
        program_version_id: programVersionId,
        workout_id: workoutId,
        planned_date: plannedDate,
        sequence_number: (latest?.sequence_number ?? 0) + 1,
        status: "planned",
        request_key: requestKey,
      })
      .select("*")
      .single(),
    "insert legacy schedule fixture",
  );
  return {
    id: inserted.id,
    assignmentId: inserted.assignment_id,
    programVersionId: inserted.program_version_id,
    workoutId: inserted.workout_id,
    plannedDate: inserted.planned_date,
    sequenceNumber: inserted.sequence_number,
    status: inserted.status,
    created: true,
  };
}

// Historical assignment coverage uses explicit service-role fixtures. No
// authenticated client retains an assignment writer after program runs become
// the sole V1 usage aggregate.
async function insertLegacyAssignmentsFixture(
  admin,
  { athleteIds, coachId, programId, versionId, requestKey },
) {
  const inserted = expectData(
    await admin
      .from("program_assignments")
      .insert(
        athleteIds.map((athleteId) => ({
          id: randomUUID(),
          athlete_id: athleteId,
          assigned_by_id: coachId,
          source_program_id: programId,
          source_version_id: versionId,
          assignment_request_key: requestKey,
          status: "active",
        })),
      )
      .select("id,athlete_id")
      .order("athlete_id"),
    "insert historical assignment fixtures",
  );
  return inserted.map((assignment) => ({
    athlete_id: assignment.athlete_id,
    assignment_id: assignment.id,
    created: true,
  }));
}

test(
  "Supabase enforces private accounts, exact invitations, explicit programs, and athlete-owned scheduling",
  { skip: !enabled },
  async () => {
    validateIntegrationTarget(process.env);
    validateIntegrationCredentials(process.env);

    const admin = client(secretKey);
    const runToken = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const fixtureNamespace = `integration-${runToken}-v1`;
    const suffix = `integration-${runToken}`;
    const password = `LiftLog-${randomUUID()}!`;
    const identities = [
      {
        key: "athlete-a",
        role: "athlete A",
        email: `athlete-a-${suffix}@liftlog.test`,
        firstName: "Athlete",
        lastName: "Alpha",
      },
      {
        key: "athlete-b",
        role: "athlete B",
        email: `athlete-b-${suffix}@liftlog.test`,
        firstName: "Athlete",
        lastName: "Beta",
      },
      {
        key: "coach",
        role: "coach",
        email: `coach-${suffix}@liftlog.test`,
        firstName: "Coach",
        lastName: "Gamma",
      },
      {
        key: "other-coach",
        role: "other coach",
        email: `other-coach-${suffix}@liftlog.test`,
        firstName: "Coach",
        lastName: "Delta",
      },
    ];
    const userIds = [];
    const createdPersonaKeys = [];
    let athleteAId;
    let athleteBId;
    let coachId;
    let otherCoachId;
    let testFailure = null;

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
            test_persona: true,
            test_persona_key: identity.key,
          },
          app_metadata: {
            account_kind: "test",
            test_persona_key: `${fixtureNamespace}:${identity.key}`,
            fixture_namespace: fixtureNamespace,
          },
        });
        assert.equal(
          error,
          null,
          `create ${identity.role}: ${error?.message ?? "unknown auth error"}`,
        );
        assert.ok(data.user);
        userIds.push(data.user.id);
        createdPersonaKeys.push(identity.key);
        assert.deepEqual(
          expectData(
            await admin
              .from("profiles")
              .update({
                account_kind: "test",
                test_persona_key: `${fixtureNamespace}:${identity.key}`,
              })
              .eq("id", data.user.id)
              .select("id,account_kind,test_persona_key")
              .single(),
            `mark generated ${identity.role} profile`,
          ),
          {
            id: data.user.id,
            account_kind: "test",
            test_persona_key: `${fixtureNamespace}:${identity.key}`,
          },
        );
      }
      [athleteAId, athleteBId, coachId, otherCoachId] = userIds;
      const athleteA = await signIn(identities[0].email, password);
      const athleteASecondTab = await signIn(identities[0].email, password);
      const athleteB = await signIn(identities[1].email, password);
      const coach = await signIn(identities[2].email, password);
      const otherCoach = await signIn(identities[3].email, password);

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
      const ownProfileProjection = expectData(
        await athleteA.rpc("get_own_profile"),
        "load own private profile projection",
      );
      assert.equal(ownProfileProjection.length, 1);
      assert.deepEqual(
        Object.keys(ownProfileProjection[0]).sort(),
        [
          "display_name",
          "distance_unit",
          "first_name",
          "id",
          "last_name",
          "liftlog_id",
          "timezone",
          "week_starts_on_sunday",
          "weight_unit",
        ],
      );
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

      const programId = expectData(
        await athleteA.rpc("create_blank_program", {
          target_athlete_id: athleteAId,
          target_title: "Flexible test plan",
          target_planning_mode: "fixed_weeks",
        }),
        "create blank program",
      );
      const additionalProgramId = expectData(
        await athleteA.rpc("create_blank_program", {
          target_athlete_id: athleteAId,
          target_title: "Additional test plan",
          target_planning_mode: "fixed_weeks",
        }),
        "create an additional own program",
      );
      assert.notEqual(additionalProgramId, programId);
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
          .select("id,phase_id,week_index,label")
          .eq("program_version_id", draftVersion.id)
          .single(),
        "load implicit workout container",
      );
      assert.equal(week.week_index, 1);
      assert.equal(week.label, "Program");
      assert.match(
        (
          await athleteA.from("program_weeks").insert({
            program_version_id: draftVersion.id,
            phase_id: week.phase_id,
            week_index: 2,
            label: "Forbidden second container",
          })
        ).error?.message ?? "",
        /duplicate key|idx_program_weeks_one_per_version/i,
        "a program version must reject a second internal workout container",
      );

      const quickWorkoutProgramId = expectData(
        await athleteA.rpc("create_blank_quick_workout", {
          target_title: "Integration quick workout",
        }),
        "create quick workout with one exercise list",
      );
      const quickWorkoutVersion = expectData(
        await athleteA
          .from("program_versions")
          .select("id")
          .eq("program_id", quickWorkoutProgramId)
          .eq("status", "draft")
          .single(),
        "load quick workout draft",
      );
      const quickWorkoutContainer = expectData(
        await athleteA
          .from("program_weeks")
          .select("id,week_index,label")
          .eq("program_version_id", quickWorkoutVersion.id)
          .single(),
        "load quick workout container",
      );
      assert.equal(quickWorkoutContainer.week_index, 1);
      assert.equal(quickWorkoutContainer.label, "Workout");
      const quickWorkout = expectData(
        await athleteA
          .from("workouts")
          .select("id")
          .eq("program_week_id", quickWorkoutContainer.id)
          .single(),
        "load quick workout content",
      );
      assert.match(
        (
          await athleteA.rpc("create_scheduled_occurrence_for_use", {
            target_workout_id: quickWorkout.id,
            target_planned_date: dateInTimeZone("Europe/Riga"),
            target_idempotency_key: randomUUID(),
            target_program_id: quickWorkoutProgramId,
          })
        ).error?.message ?? "",
        /permission denied/i,
        "the quick-workout compatibility wrapper cannot bypass program runs",
      );
      const quickWorkoutGroups = expectData(
        await athleteA
          .from("workout_sections")
          .select("title,section_kind,position")
          .eq("workout_id", quickWorkout.id)
          .order("position"),
        "load quick workout groups",
      );
      assert.deepEqual(quickWorkoutGroups, [
        { title: "Exercises", section_kind: "main", position: 0 },
      ]);
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
            title: "Exercises",
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
      expectData(
        await athleteA.rpc("reorder_workout_items", {
          target_workout_id: athleteWorkout.id,
          ordered_ids: [item.id],
        }),
        "reorder the workout exercise list",
      );
      const orderedItem = expectData(
        await athleteA
          .from("workout_items")
          .select("position")
          .eq("id", item.id)
          .single(),
        "read ordered workout item",
      );
      assert.deepEqual(orderedItem, { position: 0 });

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

      const otherCoachInvitation = expectData(
        await athleteA.rpc("create_coach_invite", {
          target_email: identities[3].email,
        }),
        "invite second coach",
      );
      const otherCoachRelationship = expectData(
        await otherCoach.rpc("respond_to_coach_invite", {
          target_invite_id: otherCoachInvitation.id,
          target_response: "accepted",
        }),
        "accept second coach relationship",
      );
      assert.ok(otherCoachRelationship.relationshipId);

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
      assert.deepEqual(
        expectData(
          await coach.from("programs").select("id").eq("id", programId),
          "coach cannot read athlete-authored program",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("profiles")
            .select("display_name")
            .eq("id", athleteAId),
          "coach cannot read connected private profile row",
        ),
        [],
      );
      const connectedProfiles = expectData(
        await coach.rpc("list_connected_profile_summaries"),
        "load basic connected profile summaries",
      );
      assert.deepEqual(
        connectedProfiles.map((profile) => profile.id).sort(),
        [athleteAId, athleteBId, coachId].sort(),
      );
      assert.equal(
        connectedProfiles.find((profile) => profile.id === athleteAId)
          ?.display_name,
        updatedProfile.displayName,
      );
      assert.ok(
        connectedProfiles.every(
          (profile) =>
            JSON.stringify(Object.keys(profile).sort()) ===
            JSON.stringify(["display_name", "id"]),
        ),
      );
      const otherConnectedProfiles = expectData(
        await otherCoach.rpc("list_connected_profile_summaries"),
        "load second coach basic profile summaries",
      );
      assert.deepEqual(
        otherConnectedProfiles.map((profile) => profile.id).sort(),
        [athleteAId, otherCoachId].sort(),
      );
      assert.ok(
        [...connectedProfiles, ...otherConnectedProfiles].every(
          (profile) =>
            JSON.stringify(Object.keys(profile).sort()) ===
            JSON.stringify(["display_name", "id"]),
        ),
      );

      assert.ok(
        (
          await coach.from("workouts").insert({
            program_week_id: week.id,
            title: "Forbidden athlete-authored edit",
            schedule_label: "Workout 2",
            position: 1,
            estimated_minutes: 30,
          })
        ).error,
      );

      const effectiveOn = new Date().toISOString().slice(0, 10);
      const sharedProgramId = expectData(
        await coach.rpc("create_blank_program", {
          target_athlete_id: coachId,
          target_title: "Shared coaching template",
          target_planning_mode: "fixed_weeks",
        }),
        "coach creates own shared program",
      );
      const sharedDraftVersion = expectData(
        await coach
          .from("program_versions")
          .select("id")
          .eq("program_id", sharedProgramId)
          .eq("status", "draft")
          .single(),
        "load shared program draft",
      );
      const sharedWeek = expectData(
        await coach
          .from("program_weeks")
          .select("id")
          .eq("program_version_id", sharedDraftVersion.id)
          .single(),
        "load shared program week",
      );
      const sharedWorkout = expectData(
        await coach
          .from("workouts")
          .insert({
            program_week_id: sharedWeek.id,
            title: "Shared strength session",
            day_of_week: null,
            schedule_label: "Workout 1",
            position: 0,
            estimated_minutes: 40,
          })
          .select("id,title")
          .single(),
        "add shared program workout",
      );
      const sharedRecoveryWorkout = expectData(
        await coach
          .from("workouts")
          .insert({
            program_week_id: sharedWeek.id,
            title: "Shared recovery session",
            day_of_week: null,
            schedule_label: "Workout 2",
            position: 1,
            estimated_minutes: 25,
          })
          .select("id,title")
          .single(),
        "add second shared program workout",
      );
      expectData(
        await coach.rpc("publish_program_version", {
          target_version_id: sharedDraftVersion.id,
          effective_on: effectiveOn,
        }),
        "publish shared coaching program",
      );
      assert.ok(
        expectData(
          await coach
            .from("programs")
            .select("locked_at")
            .eq("id", sharedProgramId)
            .single(),
          "verify compatibility publishing records first use",
        ).locked_at,
      );
      const assignmentRequestKey = randomUUID();
      assert.match(
        (
          await coach.rpc("assign_published_program_version", {
            target_program_id: sharedProgramId,
            target_version_id: sharedDraftVersion.id,
            target_athlete_ids: [athleteAId, athleteBId],
            target_idempotency_key: assignmentRequestKey,
          })
        ).error?.message ?? "",
        /permission denied/i,
        "authenticated clients cannot create shared legacy assignments",
      );
      assert.match(
        (
          await coach.rpc("assign_quick_workout_for_use", {
            target_program_id: sharedProgramId,
            target_athlete_ids: [athleteAId],
            target_planned_date: effectiveOn,
            target_idempotency_key: randomUUID(),
          })
        ).error?.message ?? "",
        /permission denied/i,
        "authenticated clients cannot call the legacy quick-assignment wrapper",
      );
      const sharedAssignments = await insertLegacyAssignmentsFixture(admin, {
        athleteIds: [athleteAId, athleteBId],
        coachId,
        programId: sharedProgramId,
        versionId: sharedDraftVersion.id,
        requestKey: assignmentRequestKey,
      });
      assert.equal(sharedAssignments.length, 2);
      assert.ok(sharedAssignments.every((assignment) => assignment.created));
      assert.equal(
        new Set(sharedAssignments.map((assignment) => assignment.assignment_id))
          .size,
        2,
      );
      const sharedAssignmentRows = expectData(
        await coach
          .from("program_assignments")
          .select(
            "id,athlete_id,assigned_by_id,source_program_id,source_version_id,customized_program_id,status",
          )
          .in(
            "id",
            sharedAssignments.map((assignment) => assignment.assignment_id),
          )
          .order("athlete_id"),
        "load shared assignment identities",
      );
      assert.equal(sharedAssignmentRows.length, 2);
      assert.ok(
        sharedAssignmentRows.every(
          (assignment) =>
            assignment.assigned_by_id === coachId &&
            assignment.source_program_id === sharedProgramId &&
            assignment.source_version_id === sharedDraftVersion.id &&
            assignment.customized_program_id === null &&
            assignment.status === "active",
        ),
      );
      assert.deepEqual(
        expectData(
          await admin
            .from("programs")
            .select("id")
            .eq("assigned_from_program_id", sharedProgramId),
          "verify shared assignment does not clone program trees",
        ),
        [],
      );
      const athleteAAssignment = sharedAssignments.find(
        (assignment) => assignment.athlete_id === athleteAId,
      );
      const athleteBAssignment = sharedAssignments.find(
        (assignment) => assignment.athlete_id === athleteBId,
      );
      assert.ok(athleteAAssignment);
      assert.ok(athleteBAssignment);
      for (const [attempt, message] of [
        [
          coach.rpc("fork_program_assignment", {
            target_assignment_id: athleteBAssignment.assignment_id,
            target_idempotency_key: randomUUID(),
          }),
          "legacy assignment forks are revoked",
        ],
        [
          coach.rpc("assign_quick_workout_to_athletes", {
            target_program_id: sharedProgramId,
            target_athlete_ids: [athleteBId],
            target_planned_date: effectiveOn,
            target_idempotency_key: randomUUID(),
          }),
          "the low-level quick assignment writer is revoked",
        ],
        [
          athleteB.rpc("create_scheduled_occurrence_for_use", {
            target_workout_id: sharedWorkout.id,
            target_planned_date: effectiveOn,
            target_idempotency_key: randomUUID(),
            target_assignment_id: athleteBAssignment.assignment_id,
          }),
          "the guarded legacy occurrence wrapper is revoked",
        ],
        [
          coach.rpc("create_coach_scheduled_occurrence", {
            target_assignment_id: athleteBAssignment.assignment_id,
            target_workout_id: sharedWorkout.id,
            target_planned_date: effectiveOn,
            target_idempotency_key: randomUUID(),
          }),
          "the coach legacy occurrence writer is revoked",
        ],
      ]) {
        assert.match((await attempt).error?.message ?? "", /permission denied/i, message);
      }
      assert.deepEqual(
        expectData(
          await athleteA
            .from("program_assignments")
            .select("id")
            .in("id", [
              athleteAAssignment.assignment_id,
              athleteBAssignment.assignment_id,
            ]),
          "athlete reads only own shared assignment identity",
        ),
        [{ id: athleteAAssignment.assignment_id }],
      );
      const athleteASharedCandidates = expectData(
        await athleteA.rpc("list_schedulable_workouts", { page_limit: 100 }),
        "list athlete A shared scheduling candidates",
      );
      const athleteBSharedCandidates = expectData(
        await athleteB.rpc("list_schedulable_workouts", { page_limit: 100 }),
        "list athlete B shared scheduling candidates",
      );
      assert.equal(
        athleteASharedCandidates.some(
          (entry) => entry.workout_id === sharedWorkout.id,
        ),
        false,
      );
      assert.equal(
        athleteBSharedCandidates.some(
          (entry) => entry.workout_id === sharedWorkout.id,
        ),
        false,
      );
      const sharedOccurrenceKey = randomUUID();
      const sharedOccurrenceDate = datePlus(effectiveOn, 3);
      assert.match(
        (
          await athleteB.rpc("create_scheduled_occurrence", {
            target_workout_id: sharedWorkout.id,
            target_planned_date: sharedOccurrenceDate,
            target_idempotency_key: randomUUID(),
            target_assignment_id: athleteBAssignment.assignment_id,
          })
        ).error?.message ?? "",
        /permission denied/i,
        "authenticated clients cannot bypass program runs through the V0 occurrence writer",
      );
      assert.match(
        (
          await coach.rpc("assign_program_for_use", {
            target_program_id: sharedProgramId,
            target_athlete_ids: [athleteBId],
            target_idempotency_key: randomUUID(),
          })
        ).error?.message ?? "",
        /permission denied/i,
        "authenticated clients cannot create legacy assignments",
      );
      const sharedOccurrence = expectData(
        {
          data: await insertLegacyOccurrenceFixture(admin, {
            athleteId: athleteBId,
            scheduledById: athleteBId,
            assignmentId: athleteBAssignment.assignment_id,
            programVersionId: sharedDraftVersion.id,
            workoutId: sharedWorkout.id,
            plannedDate: sharedOccurrenceDate,
            requestKey: sharedOccurrenceKey,
          }),
          error: null,
        },
        "seed explicitly dated occurrence from a historical shared assignment",
      );
      assert.deepEqual(
        {
          assignmentId: sharedOccurrence.assignmentId,
          programVersionId: sharedOccurrence.programVersionId,
          workoutId: sharedOccurrence.workoutId,
          plannedDate: sharedOccurrence.plannedDate,
          sequenceNumber: sharedOccurrence.sequenceNumber,
          status: sharedOccurrence.status,
          created: sharedOccurrence.created,
        },
        {
          assignmentId: athleteBAssignment.assignment_id,
          programVersionId: sharedDraftVersion.id,
          workoutId: sharedWorkout.id,
          plannedDate: sharedOccurrenceDate,
          sequenceNumber: 1,
          status: "planned",
          created: true,
        },
      );
      const sharedOccurrenceReplay = expectData(
        {
          data: await insertLegacyOccurrenceFixture(admin, {
            athleteId: athleteBId,
            scheduledById: athleteBId,
            assignmentId: athleteBAssignment.assignment_id,
            programVersionId: sharedDraftVersion.id,
            workoutId: sharedWorkout.id,
            plannedDate: sharedOccurrenceDate,
            requestKey: sharedOccurrenceKey,
          }),
          error: null,
        },
        "replay historical shared-assignment fixture creation",
      );
      assert.equal(sharedOccurrenceReplay.id, sharedOccurrence.id);
      assert.equal(sharedOccurrenceReplay.created, false);
      assert.deepEqual(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("id", sharedOccurrence.id),
          "other athlete cannot read shared-assignment occurrence",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("scheduled_workouts")
            .select(
              "id,athlete_id,assignment_id,program_version_id,workout_id,planned_date,status",
            )
            .eq("id", sharedOccurrence.id)
            .single(),
          "author reads shared-assignment occurrence identity",
        ),
        {
          id: sharedOccurrence.id,
          athlete_id: athleteBId,
          assignment_id: athleteBAssignment.assignment_id,
          program_version_id: sharedDraftVersion.id,
          workout_id: sharedWorkout.id,
          planned_date: sharedOccurrenceDate,
          status: "planned",
        },
      );
      assert.equal(
        expectData(
          await athleteB.rpc("list_schedulable_workouts", { page_limit: 100 }),
          "keep the full-program assignment out of Calendar discovery",
        ).some((candidate) => candidate.workout_id === sharedWorkout.id),
        false,
      );

      assert.match(
        (
          await coach.rpc("create_program_runs", {
            target_program_id: sharedProgramId,
            target_athlete_ids: [athleteAId],
            target_workout_dates: [
              {
                workoutId: sharedWorkout.id,
                plannedDate: datePlus(effectiveOn, 8),
              },
              {
                workoutId: sharedRecoveryWorkout.id,
                plannedDate: datePlus(effectiveOn, 7),
              },
            ],
            target_idempotency_key: randomUUID(),
          })
        ).error?.message ?? "",
        /Workout dates must follow program order/i,
        "run creation must reject a later workout dated before an earlier one",
      );

      const coachRunRequestKey = randomUUID();
      const coachRuns = expectData(
        await coach.rpc("create_program_runs", {
          target_program_id: sharedProgramId,
          target_athlete_ids: [athleteAId, athleteBId],
          target_workout_dates: [],
          target_idempotency_key: coachRunRequestKey,
        }),
        "create one immutable run per athlete",
      );
      assert.equal(coachRuns.length, 2);
      assert.ok(
        coachRuns.every(
          (run) =>
            run.created &&
            run.program_id === sharedProgramId &&
            run.program_version_id === sharedDraftVersion.id,
        ),
      );
      const runsByAthlete = new Map(
        coachRuns.map((run) => [run.athlete_id, run]),
      );
      const athleteARun = runsByAthlete.get(athleteAId);
      const athleteBRun = runsByAthlete.get(athleteBId);
      assert.ok(athleteARun);
      assert.ok(athleteBRun);

      const replayedCoachRuns = expectData(
        await coach.rpc("create_program_runs", {
          target_program_id: sharedProgramId,
          target_athlete_ids: [athleteBId, athleteAId],
          target_workout_dates: [],
          target_idempotency_key: coachRunRequestKey,
        }),
        "replay multi-athlete run creation",
      );
      assert.deepEqual(
        replayedCoachRuns
          .map((run) => ({
            athlete_id: run.athlete_id,
            run_id: run.run_id,
            created: run.created,
          }))
          .sort((left, right) => left.athlete_id.localeCompare(right.athlete_id)),
        coachRuns
          .map((run) => ({
            athlete_id: run.athlete_id,
            run_id: run.run_id,
            created: false,
          }))
          .sort((left, right) => left.athlete_id.localeCompare(right.athlete_id)),
      );

      const paginationProbeIds = [];
      for (let index = 0; index < 3; index += 1) {
        const [probe] = expectData(
          await coach.rpc("create_program_runs", {
            target_program_id: sharedProgramId,
            target_athlete_ids: [athleteAId],
            target_workout_dates: [],
            target_idempotency_key: randomUUID(),
          }),
          "create immutable run-summary cursor probe",
        );
        assert.ok(probe?.run_id);
        paginationProbeIds.unshift(probe.run_id);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      try {
        const runPageOne = expectData(
          await athleteA.rpc("list_program_run_summaries", {
            target_athlete_id: null,
            page_limit: 2,
            creator_scope: "coach",
          }),
          "load the first immutable run-summary page",
        );
        assert.deepEqual(
          runPageOne.map((run) => run.id),
          paginationProbeIds.slice(0, 2),
        );
        const runCursor = runPageOne.at(-1);

        expectData(
          await admin
            .from("program_runs")
            .update({
              status: "ended",
              ended_at: "2099-02-01T10:00:00.000Z",
              ended_by_id: coachId,
            })
            .eq("id", paginationProbeIds[0]),
          "move a visible cursor probe to ended",
        );
        expectData(
          await admin
            .from("program_runs")
            .update({
              status: "in_progress",
              started_at: "2099-01-01T12:00:00.000Z",
            })
            .eq("id", paginationProbeIds[2]),
          "move an unseen cursor probe to in progress",
        );

        const runPageTwo = expectData(
          await athleteA.rpc("list_program_run_summaries", {
            target_athlete_id: null,
            page_limit: 2,
            after_created_at: runCursor.created_at,
            after_id: runCursor.id,
            creator_scope: "coach",
          }),
          "load an immutable run-summary page after lifecycle changes",
        );
        assert.equal(runPageTwo[0]?.id, paginationProbeIds[2]);
        assert.equal(
          runPageTwo.some((run) => run.id === paginationProbeIds[0]),
          false,
          "a lifecycle change must not move an already-seen run behind the cursor",
        );
      } finally {
        expectData(
          await admin
            .from("program_run_workouts")
            .delete()
            .in("program_run_id", paginationProbeIds),
          "remove immutable run-summary cursor probe workouts",
        );
        expectData(
          await admin.from("program_runs").delete().in("id", paginationProbeIds),
          "remove immutable run-summary cursor probes",
        );
      }

      const athleteBRunSlots = expectData(
        await athleteB
          .from("program_run_workouts")
          .select("id,workout_id,position,status,scheduled_workout_id")
          .eq("program_run_id", athleteBRun.run_id)
          .order("position"),
        "load athlete B immutable run slots",
      );
      assert.deepEqual(
        athleteBRunSlots.map((slot) => slot.workout_id),
        [sharedWorkout.id, sharedRecoveryWorkout.id],
      );
      const successorDraft = expectData(
        await coach
          .from("program_versions")
          .select("id")
          .eq("program_id", sharedProgramId)
          .eq("status", "draft")
          .single(),
        "load successor reusable draft",
      );
      assert.notEqual(successorDraft.id, sharedDraftVersion.id);
      const successorWeek = expectData(
        await coach
          .from("program_weeks")
          .select("id")
          .eq("program_version_id", successorDraft.id)
          .single(),
        "load successor draft week",
      );
      const successorWorkoutIds = expectData(
        await coach
          .from("workouts")
          .select("id")
          .eq("program_week_id", successorWeek.id),
        "load successor draft workouts",
      ).map((workout) => workout.id);
      assert.equal(successorWorkoutIds.length, 2);
      assert.equal(successorWorkoutIds.includes(sharedWorkout.id), false);
      assert.equal(successorWorkoutIds.includes(sharedRecoveryWorkout.id), false);

      expectData(
        await coach
          .from("programs")
          .update({ title: "Shared coaching template revised" })
          .eq("id", sharedProgramId),
        "revise reusable content after assigning its snapshot",
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("program_versions")
            .select("title")
            .in("id", [sharedDraftVersion.id, successorDraft.id])
            .order("title"),
          "compare immutable run metadata with the successor draft",
        ).map((entry) => entry.title),
        ["Shared coaching template", "Shared coaching template revised"],
      );
      assert.equal(
        expectData(
          await coach.rpc("publish_program_version", {
            target_version_id: successorDraft.id,
            effective_on: datePlus(effectiveOn, 1),
          }),
          "publish the successor so the assigned run uses a superseded revision",
        ),
        successorDraft.id,
      );
      assert.equal(
        expectData(
          await coach
            .from("program_versions")
            .select("status")
            .eq("id", sharedDraftVersion.id)
            .single(),
          "confirm the run snapshot is no longer the latest published revision",
        ).status,
        "superseded",
      );
      assert.match(
        (
          await athleteA.rpc("copy_program_run_to_own", {
            target_run_id: athleteBRun.run_id,
          })
        ).error?.message ?? "",
        /Program run was not found/i,
        "one athlete cannot copy another athlete's run",
      );
      const coachCopiedRunProgramId = expectData(
        await coach.rpc("copy_program_run_to_own", {
          target_run_id: athleteBRun.run_id,
        }),
        "let the assigning coach recover the exact run revision",
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("programs")
            .select("athlete_id,created_by_id,title,source_type")
            .eq("id", coachCopiedRunProgramId)
            .single(),
          "load the assigning coach's exact run copy",
        ),
        {
          athlete_id: coachId,
          created_by_id: coachId,
          title: "Shared coaching template copy",
          source_type: "self",
        },
      );
      const copiedRunProgramId = expectData(
        await athleteB.rpc("copy_program_run_to_own", {
          target_run_id: athleteBRun.run_id,
        }),
        "copy the exact assigned run revision",
      );
      const copiedRunProgram = expectData(
        await athleteB
          .from("programs")
          .select("title,source_type,content_type")
          .eq("id", copiedRunProgramId)
          .single(),
        "load the athlete-owned run copy",
      );
      assert.deepEqual(copiedRunProgram, {
        title: "Shared coaching template copy",
        source_type: "self",
        content_type: "program",
      });
      const copiedRunVersion = expectData(
        await athleteB
          .from("program_versions")
          .select("id,based_on_version_id,status,title")
          .eq("program_id", copiedRunProgramId)
          .single(),
        "load copied run draft",
      );
      assert.deepEqual(
        {
          based_on_version_id: copiedRunVersion.based_on_version_id,
          status: copiedRunVersion.status,
          title: copiedRunVersion.title,
        },
        {
          based_on_version_id: sharedDraftVersion.id,
          status: "draft",
          title: "Shared coaching template copy",
        },
      );
      const copiedRunContainer = expectData(
        await athleteB
          .from("program_weeks")
          .select("id")
          .eq("program_version_id", copiedRunVersion.id)
          .single(),
        "load copied run workout container",
      );
      assert.deepEqual(
        expectData(
          await athleteB
            .from("workouts")
            .select("title")
            .eq("program_week_id", copiedRunContainer.id)
            .order("position"),
          "load exact workouts copied from the run snapshot",
        ).map((workout) => workout.title),
        ["Shared strength session", "Shared recovery session"],
      );
      expectData(
        await athleteB.rpc("delete_own_program", {
          target_program_id: copiedRunProgramId,
        }),
        "archive the run-copy probe",
      );

      assert.deepEqual(
        expectData(
          await athleteA
            .from("program_runs")
            .select("id")
            .in("id", coachRuns.map((run) => run.run_id)),
          "athlete A sees only their run",
        ),
        [{ id: athleteARun.run_id }],
      );
      assert.deepEqual(
        expectData(
          await athleteB
            .from("program_runs")
            .select("id")
            .in("id", coachRuns.map((run) => run.run_id)),
          "athlete B sees only their run",
        ),
        [{ id: athleteBRun.run_id }],
      );
      assert.deepEqual(
        expectData(
          await otherCoach
            .from("program_runs")
            .select("id")
            .in("id", coachRuns.map((run) => run.run_id)),
          "another coach cannot read runs they did not create",
        ),
        [],
      );

      const athleteARunSchedule = [
        {
          workoutId: sharedWorkout.id,
          plannedDate: datePlus(effectiveOn, 1),
        },
        {
          workoutId: sharedRecoveryWorkout.id,
          plannedDate: datePlus(effectiveOn, 2),
        },
      ];
      expectData(
        await athleteA.rpc("schedule_program_run_workouts", {
          target_run_id: athleteARun.run_id,
          target_workout_dates: athleteARunSchedule,
          target_idempotency_key: randomUUID(),
        }),
        "athlete schedules their flexible coach-created run",
      );
      assert.match(
        (
          await athleteA.rpc("schedule_program_run_workouts", {
            target_run_id: athleteARun.run_id,
            target_workout_dates: [
              {
                workoutId: sharedWorkout.id,
                plannedDate: datePlus(effectiveOn, 4),
              },
            ],
            target_idempotency_key: randomUUID(),
          })
        ).error?.message ?? "",
        /Workout dates must follow program order/i,
        "a partial reschedule must account for the later slot's retained date",
      );
      const athleteARunOccurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select(
            "id,workout_id,program_run_id,program_run_workout_id,planned_date,status,scheduled_by_id",
          )
          .eq("program_run_id", athleteARun.run_id)
          .order("planned_date"),
        "load athlete-scheduled coach-run occurrences",
      );
      assert.deepEqual(
        athleteARunOccurrences.map((occurrence) => occurrence.planned_date),
        athleteARunSchedule.map((entry) => entry.plannedDate),
        "the rejected partial update must leave the ordered dates unchanged",
      );
      assert.ok(
        athleteARunOccurrences.every(
          (occurrence) => occurrence.scheduled_by_id === athleteAId,
        ),
      );

      const athleteABootstrap = expectData(
        await athleteA.rpc("get_workspace_bootstrap"),
        "load run-aware Next bootstrap",
      );
      const athleteANextRunWorkout = athleteABootstrap.nextWorkouts.find(
        (occurrence) => occurrence.programRunId === athleteARun.run_id,
      );
      assert.ok(athleteANextRunWorkout);
      assert.equal(athleteANextRunWorkout.sourceType, "coach");
      assert.equal(athleteANextRunWorkout.scheduledById, athleteAId);
      assert.ok(athleteANextRunWorkout.programRunWorkoutId);

      const athleteACalendarRunWorkout = expectData(
        await athleteA.rpc("list_calendar_occurrences", {
          range_start: athleteARunSchedule[0].plannedDate,
          range_end: athleteARunSchedule[1].plannedDate,
          page_limit: 100,
        }),
        "load canonical calendar provenance",
      ).find((occurrence) => occurrence.program_run_id === athleteARun.run_id);
      assert.ok(athleteACalendarRunWorkout);
      assert.equal(athleteACalendarRunWorkout.source_type, "coach");
      assert.equal(athleteACalendarRunWorkout.scheduled_by_id, athleteAId);

      const athleteARunWorkoutDetail = expectData(
        await athleteA.rpc("get_scheduled_workout_detail", {
          target_schedule_id: athleteARunOccurrences[0].id,
        }),
        "load canonical scheduled-workout provenance",
      );
      assert.equal(athleteARunWorkoutDetail.sourceType, "coach");
      assert.equal(athleteARunWorkoutDetail.scheduledById, athleteAId);
      assert.equal(athleteARunWorkoutDetail.programRunId, athleteARun.run_id);

      for (const occurrence of athleteARunOccurrences) {
        expectData(
          await athleteA.rpc("set_scheduled_workout_status", {
            target_scheduled_workout_id: occurrence.id,
            target_status: "skipped",
          }),
          "skip a run workout",
        );
      }
      const skipCompletedRun = expectData(
        await athleteA
          .from("program_runs")
          .select("status,started_at,completed_at")
          .eq("id", athleteARun.run_id)
          .single(),
        "load skip-completed run",
      );
      assert.equal(skipCompletedRun.status, "completed");
      assert.ok(skipCompletedRun.started_at);
      assert.ok(skipCompletedRun.completed_at);

      expectData(
        await athleteA.rpc("set_scheduled_workout_status", {
          target_scheduled_workout_id: athleteARunOccurrences[1].id,
          target_status: "planned",
        }),
        "restore the final skipped workout from a completed run",
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("program_runs")
            .select("status,completed_at")
            .eq("id", athleteARun.run_id)
            .single(),
          "load reopened partially skipped run",
        ),
        { status: "in_progress", completed_at: null },
      );
      expectData(
        await athleteA.rpc("set_scheduled_workout_status", {
          target_scheduled_workout_id: athleteARunOccurrences[0].id,
          target_status: "planned",
        }),
        "restore the remaining skipped workout",
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("program_runs")
            .select("status,started_at,completed_at")
            .eq("id", athleteARun.run_id)
            .single(),
          "load fully restored run",
        ),
        { status: "not_started", started_at: null, completed_at: null },
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("program_run_workouts")
            .select("position,status")
            .eq("program_run_id", athleteARun.run_id)
            .order("position"),
          "load restored run slots",
        ),
        [
          { position: 0, status: "scheduled" },
          { position: 1, status: "scheduled" },
        ],
      );

      const runScheduleKey = randomUUID();
      const runSchedule = [
        {
          workoutId: sharedWorkout.id,
          plannedDate: datePlus(effectiveOn, 9),
        },
        {
          workoutId: sharedRecoveryWorkout.id,
          plannedDate: datePlus(effectiveOn, 10),
        },
      ];
      assert.deepEqual(
        expectData(
          await coach.rpc("schedule_program_run_workouts", {
            target_run_id: athleteBRun.run_id,
            target_workout_dates: runSchedule,
            target_idempotency_key: runScheduleKey,
          }),
          "bulk schedule an athlete run",
        ),
        { runId: athleteBRun.run_id },
      );
      assert.deepEqual(
        expectData(
          await coach.rpc("schedule_program_run_workouts", {
            target_run_id: athleteBRun.run_id,
            target_workout_dates: [...runSchedule].reverse(),
            target_idempotency_key: runScheduleKey,
          }),
          "replay bulk run scheduling",
        ),
        { runId: athleteBRun.run_id },
      );
      const athleteBRunOccurrences = expectData(
        await athleteB
          .from("scheduled_workouts")
          .select(
            "id,workout_id,program_run_id,program_run_workout_id,planned_date,status",
          )
          .eq("program_run_id", athleteBRun.run_id),
        "load run-linked occurrences",
      );
      assert.equal(athleteBRunOccurrences.length, 2);
      assert.ok(
        athleteBRunOccurrences.every(
          (occurrence) =>
            occurrence.program_run_id === athleteBRun.run_id &&
            occurrence.program_run_workout_id,
        ),
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("program_run_id", athleteBRun.run_id),
          "athlete A cannot read athlete B schedule metadata from a shared version",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await athleteB
            .from("scheduled_workouts")
            .select("id")
            .eq("program_run_id", athleteARun.run_id),
          "athlete B cannot read athlete A schedule metadata from a shared version",
        ),
        [],
      );

      const upcomingPageOne = expectData(
        await athleteB.rpc("list_upcoming_scheduled_workouts", {
          page_limit: 2,
        }),
        "load the first bounded Next page",
      );
      assert.equal(upcomingPageOne.length, 2);
      const upcomingCursor = upcomingPageOne.at(-1);
      const upcomingPageTwo = expectData(
        await athleteB.rpc("list_upcoming_scheduled_workouts", {
          page_limit: 2,
          after_planned_date: upcomingCursor.planned_date,
          after_id: upcomingCursor.id,
        }),
        "load the next bounded Next page",
      );
      const pagedUpcoming = [...upcomingPageOne, ...upcomingPageTwo];
      assert.deepEqual(
        pagedUpcoming.map((occurrence) => occurrence.planned_date),
        [sharedOccurrenceDate, ...runSchedule.map((entry) => entry.plannedDate)],
      );
      assert.deepEqual(
        pagedUpcoming.map((occurrence) => occurrence.estimated_minutes),
        [40, 40, 25],
      );
      assert.match(
        (
          await athleteB.rpc("list_upcoming_scheduled_workouts", {
            page_limit: 2,
            after_planned_date: upcomingCursor.planned_date,
          })
        ).error?.message ?? "",
        /Upcoming-workout cursor is incomplete/i,
      );

      const completedRunOccurrence = athleteBRunOccurrences.find(
        (occurrence) => occurrence.workout_id === sharedWorkout.id,
      );
      assert.ok(completedRunOccurrence);
      const runSessionId = expectData(
        await athleteB.rpc("start_scheduled_workout", {
          target_scheduled_workout_id: completedRunOccurrence.id,
        }),
        "start a run-linked workout",
      );
      const savedRunDraft = expectData(
        await athleteB.rpc("save_workout_session_draft", {
          target_session_id: runSessionId,
          expected_revision: 0,
          write_token: randomUUID(),
          draft_payload: {
            sessionRpe: 7,
            sessionNote: "",
            items: [],
          },
        }),
        "save the run-linked workout draft",
      );
      assert.equal(savedRunDraft.revision, 1);
      assert.equal(
        expectData(
          await athleteB.rpc("complete_workout_session_confirmed", {
            target_session_id: runSessionId,
            expected_revision: savedRunDraft.revision,
            completion_token: randomUUID(),
            final_rpe: 7,
            final_note: "",
          }),
          "complete one workout in the run",
        ),
        runSessionId,
      );
      const athleteBRunDetail = expectData(
        await athleteB.rpc("get_program_run_detail", {
          target_run_id: athleteBRun.run_id,
        }),
        "load completed result metadata with the run plan",
      );
      const completedRunSlot = athleteBRunDetail.workouts.find(
        (slot) => slot.id === completedRunOccurrence.program_run_workout_id,
      );
      assert.ok(completedRunSlot);
      assert.equal(completedRunSlot.sessionId, runSessionId);
      assert.equal(completedRunSlot.completedForDate, completedRunOccurrence.planned_date);
      assert.equal(completedRunSlot.sessionRpe, 7);
      assert.ok(completedRunSlot.completedAt);
      assert.equal(
        expectData(
          await coach.rpc("get_program_run_detail", {
            target_run_id: athleteBRun.run_id,
          }),
          "coach loads the same complete run result",
        ).workouts.find((slot) => slot.id === completedRunSlot.id).sessionId,
        runSessionId,
      );
      assert.equal(
        expectData(
          await athleteB
            .from("program_runs")
            .select("status")
            .eq("id", athleteBRun.run_id)
            .single(),
          "load partially completed run",
        ).status,
        "in_progress",
      );
      expectData(
        await coach.rpc("end_program_run", {
          target_run_id: athleteBRun.run_id,
        }),
        "end the partially completed run",
      );
      assert.equal(
        expectData(
          await athleteB
            .from("program_runs")
            .select("status")
            .eq("id", athleteBRun.run_id)
            .single(),
          "load ended run",
        ).status,
        "ended",
      );
      assert.deepEqual(
        expectData(
          await athleteB
            .from("program_run_workouts")
            .select("position,status")
            .eq("program_run_id", athleteBRun.run_id)
            .order("position"),
          "preserve completed work while cancelling the remainder",
        ),
        [
          { position: 0, status: "completed" },
          { position: 1, status: "cancelled" },
        ],
      );
      assert.deepEqual(
        expectData(
          await athleteB
            .from("scheduled_workouts")
            .select("status")
            .eq("program_run_id", athleteBRun.run_id)
            .order("sequence_number"),
          "retain ended-run occurrence lineage",
        ),
        [{ status: "completed" }, { status: "skipped" }],
      );
      const endedRunCalendar = expectData(
        await athleteB.rpc("list_calendar_occurrences", {
          range_start: runSchedule[0].plannedDate,
          range_end: runSchedule[1].plannedDate,
          page_limit: 100,
        }),
        "exclude ended-run occurrences from Calendar planning",
      );
      assert.equal(
        endedRunCalendar.some(
          (occurrence) => occurrence.program_run_id === athleteBRun.run_id,
        ),
        false,
      );
      const endedRunUpcoming = expectData(
        await athleteB.rpc("list_upcoming_scheduled_workouts", {
          page_limit: 100,
        }),
        "exclude ended-run occurrences from Next planning",
      );
      assert.equal(
        endedRunUpcoming.some(
          (occurrence) => occurrence.program_run_id === athleteBRun.run_id,
        ),
        false,
      );
      assert.deepEqual(
        expectData(
          await athleteB
            .from("workout_sessions")
            .select("id,status,program_run_id")
            .eq("id", runSessionId)
            .single(),
          "retain completed run history after ending",
        ),
        {
          id: runSessionId,
          status: "completed",
          program_run_id: athleteBRun.run_id,
        },
      );

      const repeatRunKey = randomUUID();
      const repeatedRun = expectData(
        await coach.rpc("repeat_program_run", {
          target_run_id: athleteBRun.run_id,
          target_workout_dates: [],
          target_idempotency_key: repeatRunKey,
        }),
        "repeat an ended immutable run",
      );
      assert.equal(repeatedRun.athleteId, athleteBId);
      assert.equal(repeatedRun.programVersionId, sharedDraftVersion.id);
      assert.equal(repeatedRun.created, true);
      assert.deepEqual(
        expectData(
          await athleteB
            .from("program_runs")
            .select("status,repeated_from_run_id")
            .eq("id", repeatedRun.runId)
            .single(),
          "load repeated run lineage",
        ),
        {
          status: "not_started",
          repeated_from_run_id: athleteBRun.run_id,
        },
      );

      const originalProgramTitle = "Coach-authored test plan";
      const originalProgramDescription = "Original coaching description";
      const revisedProgramTitle = "Coach-authored test plan v2";
      const revisedProgramDescription = "Revised coaching description";
      const coachProgramId = expectData(
        await coach.rpc("create_blank_program", {
          target_athlete_id: athleteAId,
          target_title: originalProgramTitle,
          target_planning_mode: "fixed_weeks",
        }),
        "coach creates athlete-specific program",
      );
      expectData(
        await coach
          .from("programs")
          .update({ description: originalProgramDescription })
          .eq("id", coachProgramId)
          .select("id")
          .single(),
        "set original program description",
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("programs")
            .select("athlete_id,created_by_id,source_type")
            .eq("id", coachProgramId)
            .single(),
          "load coach-authored provenance",
        ),
        {
          athlete_id: athleteAId,
          created_by_id: coachId,
          source_type: "coach",
        },
      );
      const coachDraftVersion = expectData(
        await coach
          .from("program_versions")
          .select("id,title,description")
          .eq("program_id", coachProgramId)
          .eq("status", "draft")
          .single(),
        "load coach-authored draft",
      );
      assert.equal(coachDraftVersion.title, originalProgramTitle);
      assert.equal(coachDraftVersion.description, originalProgramDescription);
      const coachWeek = expectData(
        await coach
          .from("program_weeks")
          .select("id")
          .eq("program_version_id", coachDraftVersion.id)
          .single(),
        "load coach-authored week",
      );
      const coachWorkout = expectData(
        await coach
          .from("workouts")
          .insert({
            program_week_id: coachWeek.id,
            title: "Coach strength session",
            day_of_week: null,
            schedule_label: "Workout 1",
            position: 0,
            estimated_minutes: 45,
          })
          .select("id,title")
          .single(),
        "coach edits future content",
      );
      const coachSection = expectData(
        await coach
          .from("workout_sections")
          .insert({
            workout_id: coachWorkout.id,
            title: "Main work",
            section_kind: "main",
            notes: "",
            position: 0,
          })
          .select("id")
          .single(),
        "coach adds section",
      );
      const coachItem = expectData(
        await coach
          .from("workout_items")
          .insert({
            section_id: coachSection.id,
            snapshot_name: "Goblet squat",
            snapshot_cue: "Move with control.",
            entry_mode: "sets",
            tracking_fields: ["reps", "load", "rpe"],
            position: 0,
          })
          .select("id")
          .single(),
        "coach adds exercise item",
      );
      expectData(
        await coach.from("prescribed_entries").insert({
          workout_item_id: coachItem.id,
          position: 0,
          reps_min: 8,
          reps_max: 10,
          target_rpe_min: 7,
          target_rpe_max: 8,
        }),
        "coach adds prescription",
      );
      const coachMobilityWorkout = expectData(
        await coach
          .from("workouts")
          .insert({
            program_week_id: coachWeek.id,
            title: "Coach mobility session",
            day_of_week: null,
            schedule_label: "Workout 2",
            position: 1,
            estimated_minutes: 30,
          })
          .select("id,title")
          .single(),
        "coach adds second workout",
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("program_versions")
            .select("id")
            .eq("id", coachDraftVersion.id),
          "athlete cannot read coach-authored draft version",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("workouts")
            .select("id")
            .eq("id", coachWorkout.id),
          "athlete cannot read descendant rows from coach-authored draft",
        ),
        [],
      );
      assert.equal(
        expectData(
          await athleteA.rpc("get_program_version_detail", {
            target_program_id: coachProgramId,
            target_version_id: coachDraftVersion.id,
          }),
          "detail RPC hides coach-authored draft from athlete",
        ),
        null,
      );
      assert.equal(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("athlete_id", athleteAId)
            .eq("program_version_id", coachDraftVersion.id),
          "calendar before publish",
        ).length,
        0,
      );
      assert.equal(
        expectData(
          await coach.rpc("publish_program_version", {
            target_version_id: coachDraftVersion.id,
            effective_on: effectiveOn,
          }),
          "coach publishes content",
        ),
        coachDraftVersion.id,
      );
      assert.equal(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("athlete_id", athleteAId)
            .eq("program_version_id", coachDraftVersion.id),
          "calendar after publish",
        ).length,
        0,
      );

      const coachProgramCandidates = expectData(
        await athleteA.rpc("list_schedulable_workouts", { page_limit: 100 }),
        "list bounded coach-program scheduling candidates",
      ).filter(
        (candidate) =>
          candidate.program_version_id === coachDraftVersion.id,
      );
      assert.deepEqual(coachProgramCandidates, []);
      const firstOccurrenceKey = randomUUID();
      const secondOccurrenceKey = randomUUID();
      assert.match(
        (
          await coach.rpc("create_scheduled_occurrence", {
            target_workout_id: coachWorkout.id,
            target_planned_date: effectiveOn,
            target_idempotency_key: randomUUID(),
            target_program_id: coachProgramId,
          })
        ).error?.message ?? "",
        /permission denied/i,
      );
      const createdFirstOccurrence = expectData(
        {
          data: await insertLegacyOccurrenceFixture(admin, {
            athleteId: athleteAId,
            scheduledById: athleteAId,
            programVersionId: coachDraftVersion.id,
            workoutId: coachWorkout.id,
            plannedDate: effectiveOn,
            requestKey: firstOccurrenceKey,
          }),
          error: null,
        },
        "seed one historical coach-program occurrence",
      );
      assert.deepEqual(
        {
          assignmentId: createdFirstOccurrence.assignmentId,
          programVersionId: createdFirstOccurrence.programVersionId,
          workoutId: createdFirstOccurrence.workoutId,
          plannedDate: createdFirstOccurrence.plannedDate,
          sequenceNumber: createdFirstOccurrence.sequenceNumber,
          status: createdFirstOccurrence.status,
          created: createdFirstOccurrence.created,
        },
        {
          assignmentId: null,
          programVersionId: coachDraftVersion.id,
          workoutId: coachWorkout.id,
          plannedDate: effectiveOn,
          sequenceNumber: 1,
          status: "planned",
          created: true,
        },
      );
      const replayedFirstOccurrence = expectData(
        {
          data: await insertLegacyOccurrenceFixture(admin, {
            athleteId: athleteAId,
            scheduledById: athleteAId,
            programVersionId: coachDraftVersion.id,
            workoutId: coachWorkout.id,
            plannedDate: effectiveOn,
            requestKey: firstOccurrenceKey,
          }),
          error: null,
        },
        "replay historical occurrence fixture idempotently",
      );
      assert.equal(replayedFirstOccurrence.id, createdFirstOccurrence.id);
      assert.equal(replayedFirstOccurrence.created, false);
      await assert.rejects(
        () =>
          insertLegacyOccurrenceFixture(admin, {
            athleteId: athleteAId,
            scheduledById: athleteAId,
            programVersionId: coachDraftVersion.id,
            workoutId: coachWorkout.id,
            plannedDate: datePlus(effectiveOn, 1),
            requestKey: firstOccurrenceKey,
          }),
        /Idempotency key was already used for another occurrence/i,
      );
      const createdSecondOccurrence = expectData(
        {
          data: await insertLegacyOccurrenceFixture(admin, {
            athleteId: athleteAId,
            scheduledById: athleteAId,
            programVersionId: coachDraftVersion.id,
            workoutId: coachMobilityWorkout.id,
            plannedDate: datePlus(effectiveOn, 1),
            requestKey: secondOccurrenceKey,
          }),
          error: null,
        },
        "seed second historical coach-program occurrence",
      );
      assert.equal(createdSecondOccurrence.sequenceNumber, 2);
      const occurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select(
            "id,athlete_id,scheduled_by_id,assignment_id,program_version_id,workout_id,planned_date,sequence_number,status,request_key",
          )
          .eq("program_version_id", coachDraftVersion.id)
          .order("sequence_number"),
        "load occurrences",
      );
      assert.equal(occurrences.length, 2);
      assert.deepEqual(
        occurrences.map((occurrence) => ({
          athlete_id: occurrence.athlete_id,
          scheduled_by_id: occurrence.scheduled_by_id,
          assignment_id: occurrence.assignment_id,
          program_version_id: occurrence.program_version_id,
          workout_id: occurrence.workout_id,
          planned_date: occurrence.planned_date,
          sequence_number: occurrence.sequence_number,
          status: occurrence.status,
          request_key: occurrence.request_key,
        })),
        [
          {
            athlete_id: athleteAId,
            scheduled_by_id: athleteAId,
            assignment_id: null,
            program_version_id: coachDraftVersion.id,
            workout_id: coachWorkout.id,
            planned_date: effectiveOn,
            sequence_number: 1,
            status: "planned",
            request_key: firstOccurrenceKey,
          },
          {
            athlete_id: athleteAId,
            scheduled_by_id: athleteAId,
            assignment_id: null,
            program_version_id: coachDraftVersion.id,
            workout_id: coachMobilityWorkout.id,
            planned_date: datePlus(effectiveOn, 1),
            sequence_number: 2,
            status: "planned",
            request_key: secondOccurrenceKey,
          },
        ],
      );
      assert.equal(
        new Set(occurrences.map((occurrence) => occurrence.id)).size,
        2,
      );

      const selfRun = expectData(
        await athleteA.rpc("create_program_runs", {
          target_program_id: programId,
          target_athlete_ids: [athleteAId],
          target_workout_dates: [],
          target_idempotency_key: randomUUID(),
        }),
        "start an unscheduled self program run",
      )[0];
      assert.ok(selfRun);
      assert.equal(selfRun.athlete_id, athleteAId);
      assert.equal(selfRun.program_id, programId);
      assert.equal(selfRun.program_version_id, draftVersion.id);
      assert.equal(selfRun.created, true);
      const athleteProgramCandidate = expectData(
        await athleteA.rpc("list_schedulable_workouts", { page_limit: 100 }),
        "list own-program scheduling candidate",
      ).find((candidate) => candidate.workout_id === athleteWorkout.id);
      assert.equal(athleteProgramCandidate, undefined);
      expectData(
        {
          data: await insertLegacyOccurrenceFixture(admin, {
            athleteId: athleteAId,
            scheduledById: athleteAId,
            programVersionId: draftVersion.id,
            workoutId: athleteWorkout.id,
            plannedDate: datePlus(effectiveOn, 5),
            requestKey: randomUUID(),
          }),
          error: null,
        },
        "seed historical own-program occurrence",
      );
      const athleteAuthoredOccurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select("id,assignment_id,program_version_id,workout_id,planned_date")
          .eq("program_version_id", draftVersion.id),
        "load athlete-authored occurrence",
      );
      assert.equal(athleteAuthoredOccurrences.length, 1);
      assert.equal(athleteAuthoredOccurrences[0].assignment_id, null);
      assert.equal(
        athleteAuthoredOccurrences[0].planned_date,
        datePlus(effectiveOn, 5),
      );

      const otherCoachProgramId = expectData(
        await otherCoach.rpc("create_blank_program", {
          target_athlete_id: athleteAId,
          target_title: "Second coach plan",
          target_planning_mode: "fixed_weeks",
        }),
        "second coach creates athlete-specific program",
      );
      const otherCoachDraftVersion = expectData(
        await otherCoach
          .from("program_versions")
          .select("id")
          .eq("program_id", otherCoachProgramId)
          .eq("status", "draft")
          .single(),
        "load second coach draft",
      );
      const otherCoachWeek = expectData(
        await otherCoach
          .from("program_weeks")
          .select("id")
          .eq("program_version_id", otherCoachDraftVersion.id)
          .single(),
        "load second coach week",
      );
      const otherCoachWorkout = expectData(
        await otherCoach
          .from("workouts")
          .insert({
            program_week_id: otherCoachWeek.id,
            title: "Second coach session",
            day_of_week: null,
            schedule_label: "Workout 1",
            position: 0,
            estimated_minutes: 30,
          })
          .select("id")
          .single(),
        "second coach adds workout",
      );
      assert.match(
        (
          await coach.rpc("publish_program_version", {
            target_version_id: otherCoachDraftVersion.id,
            effective_on: effectiveOn,
          })
        ).error?.message ?? "",
        /not editable/i,
        "the compatibility grant must not let another coach publish the draft",
      );
      expectData(
        await otherCoach.rpc("publish_program_version", {
          target_version_id: otherCoachDraftVersion.id,
          effective_on: effectiveOn,
        }),
        "second coach publishes content",
      );
      const otherCoachCandidate = expectData(
        await athleteA.rpc("list_schedulable_workouts", { page_limit: 100 }),
        "list second-coach scheduling candidate",
      ).find((candidate) => candidate.workout_id === otherCoachWorkout.id);
      assert.equal(otherCoachCandidate, undefined);
      expectData(
        {
          data: await insertLegacyOccurrenceFixture(admin, {
            athleteId: athleteAId,
            scheduledById: athleteAId,
            programVersionId: otherCoachDraftVersion.id,
            workoutId: otherCoachWorkout.id,
            plannedDate: datePlus(effectiveOn, 6),
            requestKey: randomUUID(),
          }),
          error: null,
        },
        "seed second-coach historical occurrence",
      );
      const otherCoachOccurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select("id,assignment_id,program_version_id,workout_id,planned_date")
          .eq("program_version_id", otherCoachDraftVersion.id),
        "load second coach occurrence",
      );
      assert.equal(otherCoachOccurrences.length, 1);
      assert.equal(otherCoachOccurrences[0].assignment_id, null);
      assert.equal(
        otherCoachOccurrences[0].planned_date,
        datePlus(effectiveOn, 6),
      );
      assert.deepEqual(
        expectData(
          await otherCoach
            .from("scheduled_workouts")
            .select(
              "id,assignment_id,program_version_id,workout_id,planned_date",
            )
            .eq("id", otherCoachOccurrences[0].id)
            .single(),
          "second coach reads own authored occurrence",
        ),
        otherCoachOccurrences[0],
      );

      for (const [viewer, label] of [
        [coach, "first coach"],
        [otherCoach, "second coach"],
      ]) {
        assert.deepEqual(
          expectData(
            await viewer.from("programs").select("id").eq("id", programId),
            `${label} cannot read athlete-authored program`,
          ),
          [],
        );
        assert.deepEqual(
          expectData(
            await viewer
              .from("program_versions")
              .select("id")
              .eq("id", draftVersion.id),
            `${label} cannot read athlete-authored version`,
          ),
          [],
        );
        assert.deepEqual(
          expectData(
            await viewer.from("workouts").select("id").eq("id", athleteWorkout.id),
            `${label} cannot read athlete-authored tree`,
          ),
          [],
        );
        assert.deepEqual(
          expectData(
            await viewer
              .from("scheduled_workouts")
              .select("id")
              .eq("id", athleteAuthoredOccurrences[0].id),
            `${label} cannot read athlete-authored occurrence`,
          ),
          [],
        );
        assert.deepEqual(
          expectData(
            await viewer
              .from("program_runs")
              .select("id")
              .eq("id", selfRun.run_id),
            `${label} cannot read the athlete's self-created run`,
          ),
          [],
        );
      }
      assert.deepEqual(
        expectData(
          await coach
            .from("programs")
            .select("id")
            .eq("id", otherCoachProgramId),
          "first coach cannot read second coach program",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("program_versions")
            .select("id")
            .eq("id", otherCoachDraftVersion.id),
          "first coach cannot read second coach version",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("workouts")
            .select("id")
            .eq("id", otherCoachWorkout.id),
          "first coach cannot read second coach tree",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("scheduled_workouts")
            .select("id")
            .eq("id", otherCoachOccurrences[0].id),
          "first coach cannot read second coach occurrence",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await otherCoach
            .from("programs")
            .select("id")
            .eq("id", coachProgramId),
          "second coach cannot read first coach program",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await otherCoach
            .from("program_versions")
            .select("id")
            .eq("id", coachDraftVersion.id),
          "second coach cannot read first coach version",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await otherCoach
            .from("workouts")
            .select("id")
            .eq("id", coachWorkout.id),
          "second coach cannot read first coach tree",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await otherCoach
            .from("scheduled_workouts")
            .select("id")
            .eq("id", occurrences[0].id),
          "second coach cannot read first coach occurrence",
        ),
        [],
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
          target_planned_date: datePlus(effectiveOn, 2),
        }),
        "reschedule first",
      );
      const coachCalendar = expectData(
        await coach
          .from("scheduled_workouts")
          .select("*")
          .eq("program_version_id", coachDraftVersion.id)
          .order("sequence_number"),
        "coach reads calendar",
      );
      assert.equal(coachCalendar[0].planned_date, datePlus(effectiveOn, 2));

      const freshDraftId = expectData(
        await coach.rpc("create_program_draft", {
          target_program_id: coachProgramId,
        }),
        "create the next editable coach draft explicitly",
      );
      const freshDraft = expectData(
        await coach
          .from("program_versions")
          .select("id,title,description")
          .eq("id", freshDraftId)
          .single(),
        "load next draft",
      );
      assert.equal(freshDraft.title, originalProgramTitle);
      assert.equal(freshDraft.description, originalProgramDescription);
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
        await coach
          .from("programs")
          .update({
            title: revisedProgramTitle,
            description: revisedProgramDescription,
          })
          .eq("id", coachProgramId)
          .select("id")
          .single(),
        "rename only the later draft",
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("program_versions")
            .select("title,description")
            .eq("id", coachDraftVersion.id)
            .single(),
          "load unchanged first version metadata before republish",
        ),
        {
          title: originalProgramTitle,
          description: originalProgramDescription,
        },
      );
      assert.deepEqual(
        expectData(
          await coach
            .from("program_versions")
            .select("title,description")
            .eq("id", freshDraft.id)
            .single(),
          "load renamed second draft metadata",
        ),
        {
          title: revisedProgramTitle,
          description: revisedProgramDescription,
        },
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
          .eq("program_version_id", coachDraftVersion.id)
          .order("sequence_number"),
        "calendar after republish",
      );
      assert.deepEqual(calendarAfterRepublish, calendarBeforeRepublish);
      assert.deepEqual(
        expectData(
          await athleteA
            .from("program_versions")
            .select("title,description")
            .eq("id", coachDraftVersion.id)
            .single(),
          "load historical first-version metadata",
        ),
        {
          title: originalProgramTitle,
          description: originalProgramDescription,
        },
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("program_versions")
            .select("title,description")
            .eq("id", freshDraft.id)
            .single(),
          "load published second-version metadata",
        ),
        {
          title: revisedProgramTitle,
          description: revisedProgramDescription,
        },
      );
      assert.equal(
        expectData(
          await athleteA
            .from("program_versions")
            .select("status")
            .eq("id", coachDraftVersion.id)
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
      const replacementCandidates = expectData(
        await athleteA.rpc("list_schedulable_workouts", { page_limit: 100 }),
        "list replacement-version scheduling candidates",
      ).filter((candidate) => candidate.program_version_id === freshDraft.id);
      assert.deepEqual(replacementCandidates, []);
      const replacementWeek = expectData(
        await athleteA
          .from("program_weeks")
          .select("id")
          .eq("program_version_id", freshDraft.id)
          .single(),
        "load replacement compatibility week",
      );
      const replacementWorkouts = expectData(
        await athleteA
          .from("workouts")
          .select("id,position")
          .eq("program_week_id", replacementWeek.id)
          .order("position"),
        "load replacement workouts without using Calendar discovery",
      );
      assert.equal(replacementWorkouts.length, 2);
      const replacementRequestKeys = [randomUUID(), randomUUID()];
      const replacementDates = [
        datePlus(effectiveOn, 7),
        datePlus(effectiveOn, 8),
      ];
      const createdReplacementOccurrences = [];
      for (let index = 0; index < replacementWorkouts.length; index += 1) {
        createdReplacementOccurrences.push(
          expectData(
            {
              data: await insertLegacyOccurrenceFixture(admin, {
                athleteId: athleteAId,
                scheduledById: athleteAId,
                programVersionId: freshDraft.id,
                workoutId: replacementWorkouts[index].id,
                plannedDate: replacementDates[index],
                requestKey: replacementRequestKeys[index],
              }),
              error: null,
            },
            `seed replacement occurrence ${index + 1}`,
          ),
        );
      }
      const replayedReplacement = expectData(
        {
          data: await insertLegacyOccurrenceFixture(admin, {
            athleteId: athleteAId,
            scheduledById: athleteAId,
            programVersionId: freshDraft.id,
            workoutId: replacementWorkouts[0].id,
            plannedDate: replacementDates[0],
            requestKey: replacementRequestKeys[0],
          }),
          error: null,
        },
        "replay replacement occurrence fixture creation",
      );
      assert.equal(
        replayedReplacement.id,
        createdReplacementOccurrences[0].id,
      );
      assert.equal(replayedReplacement.created, false);
      const replacementOccurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select(
            "id,athlete_id,scheduled_by_id,assignment_id,program_version_id,workout_id,planned_date,sequence_number,status,request_key",
          )
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
            occurrence.assignment_id === null &&
            occurrence.program_version_id === freshDraft.id &&
            occurrence.planned_date === replacementDates[index] &&
            occurrence.sequence_number === index + 1 &&
            occurrence.status === "planned" &&
            occurrence.request_key === replacementRequestKeys[index],
        ),
      );
      assert.equal(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("id")
            .eq("athlete_id", athleteAId)
            .is("program_run_id", null),
          "complete versioned calendar",
        ).length,
        6,
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
        await athleteA.rpc("start_scheduled_workout", {
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
          program_version_id: coachDraftVersion.id,
          workout_id: occurrence.workout_id,
          planned_date: datePlus(effectiveOn, 2),
          sequence_number: 1,
          status: "in_progress",
        },
      );
      assert.equal(
        expectData(
          await athleteA.rpc("start_scheduled_workout", {
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
      const sessionItems = expectData(
        await athleteA
          .from("session_item_logs")
          .select("id,entry_mode,tracking_fields,position")
          .eq("workout_session_id", sessionId)
          .order("position"),
        "load complete session item set",
      );
      assert.equal(sessionItems.length, 1);
      assert.equal(sessionItems[0].entry_mode, "sets");
      const loggedItem = sessionItems[0];
      const initialDraftState = expectData(
        await athleteA
          .from("workout_sessions")
          .select(
            "draft_revision,draft_write_token,draft_write_payload_hash,draft_saved_at",
          )
          .eq("id", sessionId)
          .single(),
        "load initial draft revision",
      );
      assert.deepEqual(initialDraftState, {
        draft_revision: 0,
        draft_write_token: null,
        draft_write_payload_hash: null,
        draft_saved_at: null,
      });
      const draftPayload = {
        sessionRpe: 7,
        sessionNote: "Controlled.",
        items: sessionItems.map((sessionItem) => ({
          itemLogId: sessionItem.id,
          entries:
            sessionItem.id === loggedItem.id
              ? [{ position: 0, reps: 9, loadKg: 24, rpe: 7 }]
              : [],
        })),
      };
      const draftWriteToken = randomUUID();
      const firstDraftSave = expectData(
        await athleteA.rpc("save_workout_session_draft", {
          target_session_id: sessionId,
          expected_revision: 0,
          write_token: draftWriteToken,
          draft_payload: draftPayload,
        }),
        "save atomic workout draft",
      );
      assert.equal(firstDraftSave.revision, 1);
      assert.ok(firstDraftSave.savedAt);

      const staleDraftPayload = structuredClone(draftPayload);
      staleDraftPayload.items[0].entries[0].reps = 99;
      const [draftReplayResult, staleWriterResult] = await Promise.all([
        athleteA.rpc("save_workout_session_draft", {
          target_session_id: sessionId,
          expected_revision: 0,
          write_token: draftWriteToken,
          draft_payload: draftPayload,
        }),
        athleteASecondTab.rpc("save_workout_session_draft", {
          target_session_id: sessionId,
          expected_revision: 0,
          write_token: randomUUID(),
          draft_payload: staleDraftPayload,
        }),
      ]);
      assert.deepEqual(
        expectData(draftReplayResult, "replay identical workout draft token"),
        firstDraftSave,
      );
      assert.match(
        (
          await athleteA.rpc("save_workout_session_draft", {
            target_session_id: sessionId,
            expected_revision: 0,
            write_token: draftWriteToken,
            draft_payload: staleDraftPayload,
          })
        ).error?.message ?? "",
        /token was already used with a different payload/i,
      );
      assert.equal(
        staleWriterResult.error?.code,
        "PT409",
        `unexpected stale draft response: ${JSON.stringify(staleWriterResult)}`,
      );
      assert.equal(staleWriterResult.status, 409);
      assert.equal(
        staleWriterResult.error?.message,
        "Workout draft revision is stale",
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("workout_sessions")
            .select("draft_revision,draft_write_token,session_rpe,athlete_note")
            .eq("id", sessionId)
            .single(),
          "load confirmed unchanged draft state",
        ),
        {
          draft_revision: 1,
          draft_write_token: draftWriteToken,
          session_rpe: 7,
          athlete_note: "Controlled.",
        },
      );
      const sessionEntry = expectData(
        await athleteA
          .from("session_entries")
          .select("id,reps,load_kg,rpe")
          .eq("session_item_log_id", loggedItem.id)
          .eq("position", 0)
          .single(),
        "load atomically saved entry",
      );
      assert.deepEqual(
        {
          reps: Number(sessionEntry.reps),
          load_kg: Number(sessionEntry.load_kg),
          rpe: Number(sessionEntry.rpe),
        },
        { reps: 9, load_kg: 24, rpe: 7 },
      );
      assert.match(
        (
          await athleteA
            .from("session_entries")
            .update({ reps: 99 })
            .eq("id", sessionEntry.id)
        ).error?.message ?? "",
        /permission denied/i,
        "the final contract must prevent direct writes that bypass draft CAS",
      );

      const staleCompletionResult = await athleteASecondTab.rpc(
        "complete_workout_session_confirmed",
        {
          target_session_id: sessionId,
          expected_revision: 2,
          completion_token: randomUUID(),
          final_rpe: 7,
          final_note: "Controlled.",
        },
      );
      assert.equal(
        staleCompletionResult.error?.code,
        "PT409",
        `unexpected stale completion response: ${JSON.stringify(staleCompletionResult)}`,
      );
      assert.equal(staleCompletionResult.status, 409);
      assert.equal(
        staleCompletionResult.error?.message,
        "Workout draft revision is stale",
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("workout_sessions")
            .select("status,draft_revision,completed_at")
            .eq("id", sessionId)
            .single(),
          "load unchanged session after stale completion",
        ),
        {
          status: "in_progress",
          draft_revision: 1,
          completed_at: null,
        },
      );
      assert.match(
        (
          await athleteA.rpc("complete_workout_session", {
            target_session_id: randomUUID(),
            final_rpe: 7,
            final_note: "",
          })
        ).error?.message ?? "",
        /permission denied/i,
        "the final contract must disable the legacy completion path",
      );
      const completionToken = randomUUID();
      const confirmedCompletion = {
        target_session_id: sessionId,
        expected_revision: 1,
        completion_token: completionToken,
        final_rpe: 7,
        final_note: "Controlled.",
      };
      assert.equal(
        expectData(
          await athleteASecondTab.rpc(
            "complete_workout_session_confirmed",
            confirmedCompletion,
          ),
          "complete confirmed workout",
        ),
        sessionId,
      );
      assert.equal(
        expectData(
          await athleteA.rpc(
            "complete_workout_session_confirmed",
            confirmedCompletion,
          ),
          "replay confirmed completion token",
        ),
        sessionId,
      );

      const coachSessionSummaries = expectData(
        await coach.rpc("list_authored_coach_session_summaries", {
          target_limit: 250,
        }),
        "load authored note-free coach session summaries",
      );
      const coachSessionSummary = coachSessionSummaries.find(
        (session) => session.id === sessionId,
      );
      assert.ok(coachSessionSummary);
      assert.equal(coachSessionSummary.athlete_id, athleteAId);
      assert.equal(coachSessionSummary.program_id, coachProgramId);
      assert.equal(coachSessionSummary.program_title, originalProgramTitle);
      assert.equal(coachSessionSummary.program_run_id, null);
      assert.equal(coachSessionSummary.program_run_workout_id, null);
      assert.equal(coachSessionSummary.program_version_id, coachDraftVersion.id);
      assert.equal(coachSessionSummary.workout_title, coachWorkout.title);
      assert.deepEqual(Object.keys(coachSessionSummary).sort(), [
        "athlete_id",
        "completed_at",
        "completed_for_date",
        "id",
        "program_id",
        "program_run_id",
        "program_run_workout_id",
        "program_title",
        "program_version_id",
        "scheduled_workout_id",
        "session_rpe",
        "started_at",
        "workout_id",
        "workout_title",
      ]);
      assert.doesNotMatch(JSON.stringify(coachSessionSummary), /note/i);
      assert.equal(
        expectData(
          await otherCoach.rpc("list_authored_coach_session_summaries", {
            target_limit: 250,
          }),
          "load isolated second coach session summaries",
        ).some((session) => session.id === sessionId),
        false,
      );
      const timezoneProbeInstant = new Date();
      const athleteTimezone =
        timezoneProbeInstant.getUTCHours() < 10
          ? "Pacific/Pago_Pago"
          : "Pacific/Kiritimati";
      const utcDate = dateInTimeZone("UTC", timezoneProbeInstant);
      const athleteDate = dateInTimeZone(athleteTimezone, timezoneProbeInstant);
      assert.notEqual(athleteDate, utcDate);
      expectData(
        await athleteA
          .from("profiles")
          .update({ timezone: athleteTimezone })
          .eq("id", athleteAId)
          .select("id")
          .single(),
        "set athlete timezone boundary fixture",
      );
      const timezoneProbeDate = athleteDate < utcDate ? athleteDate : utcDate;
      expectData(
        await athleteA.rpc("schedule_workout", {
          target_scheduled_workout_id: occurrences[1].id,
          target_planned_date: timezoneProbeDate,
        }),
        "schedule athlete-timezone boundary fixture",
      );
      const coachAthleteOverviews = expectData(
        await coach.rpc("list_authored_coach_athlete_overviews", {
          target_limit: 250,
        }),
        "load bounded coach athlete identities",
      );
      const athleteOverview = coachAthleteOverviews.find(
        (athlete) => athlete.id === athleteAId,
      );
      assert.ok(athleteOverview);
      assert.ok(Number(athleteOverview.assigned_program_count) >= 1);
      assert.deepEqual(Object.keys(athleteOverview).sort(), [
        "assigned_program_count",
        "display_name",
        "id",
        "relationship_id",
      ]);

      const coachAthleteDetail = expectData(
        await coach.rpc("get_authored_coach_athlete_detail", {
          target_athlete_id: athleteAId,
          target_program_limit: 250,
          target_upcoming_limit: 6,
          target_completed_limit: 6,
        }),
        "load selected author-scoped athlete detail",
      );
      assert.equal(coachAthleteDetail.id, athleteAId);
      assert.equal(
        coachAthleteDetail.assignedPrograms.some(
          (program) => program.id === coachProgramId,
        ),
        true,
      );
      assert.equal(
        coachAthleteDetail.assignedPrograms.some(
          (program) => program.id === otherCoachProgramId,
        ),
        false,
      );
      assert.equal(
        coachAthleteDetail.agenda.some(
          (entry) =>
            entry.id === `session:${sessionId}` && entry.sessionId === sessionId,
        ),
        true,
      );
      assert.doesNotMatch(JSON.stringify(coachAthleteDetail), /note/i);
      const timezoneAgendaEntry = coachAthleteDetail.agenda.find(
        (entry) => entry.scheduleId === occurrences[1].id,
      );
      assert.ok(timezoneAgendaEntry);
      assert.equal(timezoneAgendaEntry.date, timezoneProbeDate);
      assert.equal(
        timezoneAgendaEntry.status,
        timezoneProbeDate < athleteDate ? "overdue" : "planned",
      );

      const otherCoachAthleteDetail = expectData(
        await otherCoach.rpc("get_authored_coach_athlete_detail", {
          target_athlete_id: athleteAId,
          target_program_limit: 250,
          target_upcoming_limit: 6,
          target_completed_limit: 6,
        }),
        "load isolated second-coach athlete detail",
      );
      assert.equal(
        otherCoachAthleteDetail.assignedPrograms.some(
          (program) => program.id === otherCoachProgramId,
        ),
        true,
      );
      assert.equal(
        otherCoachAthleteDetail.assignedPrograms.some(
          (program) => program.id === coachProgramId,
        ),
        false,
      );
      assert.equal(
        otherCoachAthleteDetail.agenda.some((entry) => entry.id === sessionId),
        false,
      );
      assert.doesNotMatch(JSON.stringify(otherCoachAthleteDetail), /note/i);
      assert.deepEqual(
        expectData(
          await coach
            .from("workout_sessions")
            .select("id")
            .eq("id", sessionId),
          "coach cannot read the private session base row",
        ),
        [],
      );
      for (const [privateTable, privateId] of [
        ["session_item_logs", loggedItem.id],
        ["session_entries", sessionEntry.id],
      ]) {
        assert.deepEqual(
          expectData(
            await coach.from(privateTable).select("id").eq("id", privateId),
            `coach cannot read the private ${privateTable} base row`,
          ),
          [],
        );
      }
      const coachSessionDetail = expectData(
        await coach.rpc("get_authored_coach_session_detail", {
          target_session_id: sessionId,
        }),
        "load authored note-free coach session detail",
      );
      assert.equal(coachSessionDetail.id, sessionId);
      assert.equal(coachSessionDetail.programRunId, null);
      assert.equal(coachSessionDetail.programRunWorkoutId, null);
      assert.equal(coachSessionDetail.programVersionId, coachDraftVersion.id);
      assert.equal(coachSessionDetail.workoutTitle, coachWorkout.title);
      assert.equal(coachSessionDetail.items[0].entries[0].reps, 9);
      assert.deepEqual(Object.keys(coachSessionDetail).sort(), [
        "completedAt",
        "completedForDate",
        "id",
        "items",
        "programRunId",
        "programRunWorkoutId",
        "programVersionId",
        "scheduledWorkoutId",
        "sessionRpe",
        "startedAt",
        "workoutId",
        "workoutTitle",
      ]);
      assert.deepEqual(Object.keys(coachSessionDetail.items[0]).sort(), [
        "cue",
        "entries",
        "exerciseCategory",
        "fields",
        "id",
        "mode",
        "position",
        "title",
        "videoUrl",
      ]);
      assert.deepEqual(
        Object.keys(coachSessionDetail.items[0].entries[0]).sort(),
        [
          "distanceMetres",
          "durationSeconds",
          "heartRate",
          "id",
          "loadKg",
          "position",
          "reps",
          "rounds",
          "rpe",
        ],
      );
      assert.doesNotMatch(JSON.stringify(coachSessionDetail), /note/i);
      assert.equal(
        expectData(
          await otherCoach.rpc("get_authored_coach_session_detail", {
            target_session_id: sessionId,
          }),
          "deny another coach's session detail",
        ),
        null,
      );
      assert.deepEqual(
        expectData(
          await athleteA.rpc("get_own_session_notes", {
            target_session_id: sessionId,
          }),
          "load owner-only session notes",
        ),
        {
          sessionNote: "Controlled.",
          itemNotes: { [loggedItem.id]: "" },
          entryNotes: { [sessionEntry.id]: "" },
        },
      );
      assert.equal(
        expectData(
          await coach.rpc("get_own_session_notes", {
            target_session_id: sessionId,
          }),
          "coach cannot load athlete notes",
        ),
        null,
      );
      const completedWorkout = expectData(
        await athleteA
          .from("workout_sessions")
          .select(
            "status,session_rpe,completed_for_date,program_version_id,workout_title,draft_revision",
          )
          .eq("id", sessionId)
          .single(),
        "load completed workout",
      );
      assert.deepEqual(completedWorkout, {
        status: "completed",
        session_rpe: 7,
        completed_for_date: datePlus(effectiveOn, 2),
        program_version_id: coachDraftVersion.id,
        workout_title: coachWorkout.title,
        draft_revision: 1,
      });
      assert.deepEqual(
        expectData(
          await athleteA
            .from("program_versions")
            .select("title,description")
            .eq("id", completedWorkout.program_version_id)
            .single(),
          "load completed result historical label",
        ),
        {
          title: originalProgramTitle,
          description: originalProgramDescription,
        },
      );
      assert.deepEqual(
        expectData(
          await athleteA
            .from("scheduled_workouts")
            .select("status,program_version_id,workout_id")
            .eq("id", occurrence.id)
            .single(),
          "load completed occurrence historical label",
        ),
        {
          status: "completed",
          program_version_id: coachDraftVersion.id,
          workout_id: coachWorkout.id,
        },
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
      const completedResultWrite = await athleteA
        .from("session_entries")
        .update({ reps: 99 })
        .eq("id", sessionEntry.id)
        .select("id");
      assert.equal(completedResultWrite.error?.code, "42501");
      assert.match(
        completedResultWrite.error?.message ?? "",
        /permission denied for table session_entries/i,
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
        await athleteA.rpc("deactivate_current_program", {
          target_program_id: coachProgramId,
        }),
        "deactivate completed coach-authored program",
      );
      const archivedCoachAthleteDetail = expectData(
        await coach.rpc("get_authored_coach_athlete_detail", {
          target_athlete_id: athleteAId,
          target_program_limit: 250,
          target_upcoming_limit: 6,
          target_completed_limit: 6,
          target_progress_limit: 104,
        }),
        "load completed coach history after program deactivation",
      );
      assert.equal(
        archivedCoachAthleteDetail.assignedPrograms.some(
          (program) => program.id === coachProgramId,
        ),
        false,
      );
      assert.equal(
        archivedCoachAthleteDetail.agenda.some(
          (entry) =>
            entry.id === `session:${sessionId}` && entry.sessionId === sessionId,
        ),
        true,
      );

      const oversizedProgramId = expectData(
        await coach.rpc("create_blank_program", {
          target_athlete_id: coachId,
          target_title: "Oversized run boundary probe",
          target_planning_mode: "fixed_weeks",
        }),
        "create oversized run boundary program",
      );
      const oversizedVersion = expectData(
        await coach
          .from("program_versions")
          .select("id")
          .eq("program_id", oversizedProgramId)
          .eq("status", "draft")
          .single(),
        "load oversized boundary draft",
      );
      const oversizedWeek = expectData(
        await coach
          .from("program_weeks")
          .select("id")
          .eq("program_version_id", oversizedVersion.id)
          .single(),
        "load oversized boundary workout container",
      );
      expectData(
        await admin.from("workouts").insert(
          Array.from({ length: 201 }, (_, position) => ({
            id: randomUUID(),
            program_week_id: oversizedWeek.id,
            title: `Boundary workout ${position + 1}`,
            schedule_label: `Workout ${position + 1}`,
            position,
            estimated_minutes: 30,
          })),
        ),
        "seed oversized boundary content",
      );
      assert.match(
        (
          await coach.rpc("create_program_runs", {
            target_program_id: oversizedProgramId,
            target_athlete_ids: [coachId],
            target_workout_dates: [],
            target_idempotency_key: randomUUID(),
          })
        ).error?.message ?? "",
        /at most 200 workouts/i,
        "server rejects an authored tree that exceeds the run workout cap",
      );
      assert.deepEqual(
        expectData(
          await admin
            .from("program_runs")
            .select("id")
            .eq("source_program_id", oversizedProgramId),
          "oversized content leaves no partial run",
        ),
        [],
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
          await coach.from("programs").select("id").eq("id", coachProgramId),
          "revoked coach read",
        ),
        [],
      );
      assert.deepEqual(
        expectData(
          await coach.from("programs").select("id").eq("id", programId),
          "revoked coach cannot read athlete-authored programs",
        ),
        [],
      );
      assert.ok(
        (
          await coach.from("workouts").insert({
            program_week_id: coachWeek.id,
            title: "Forbidden",
            schedule_label: "Workout 3",
            position: 2,
            estimated_minutes: 20,
          })
        ).error,
      );
    } catch (error) {
      testFailure = error;
    } finally {
      const cleanupErrors = [];
      try {
        assert.equal(
          new Set(createdPersonaKeys).size,
          createdPersonaKeys.length,
          "cleanup persona keys must be exact and unique",
        );
        assert.equal(
          new Set(userIds).size,
          userIds.length,
          "cleanup user IDs must be exact and unique",
        );
        assert.equal(
          createdPersonaKeys.length,
          userIds.length,
          "cleanup persona keys and user IDs must match",
        );
        if (createdPersonaKeys.length > 0) {
          assert.deepEqual(
            expectData(
              await admin.rpc("reset_test_population", {
                expected_namespace: fixtureNamespace,
                expected_persona_keys: createdPersonaKeys,
              }),
              "reset exact generated integration namespace",
            ),
            {
              removed: createdPersonaKeys.length,
              namespace: fixtureNamespace,
            },
          );
        }
      } catch (error) {
        cleanupErrors.push(
          new Error(`Reset generated integration namespace: ${error.message}`, {
            cause: error,
          }),
        );
      }
      for (const userId of [...userIds].reverse()) {
        try {
          const { error } = await admin.auth.admin.deleteUser(userId);
          if (error) {
            cleanupErrors.push(
              new Error(
                `Delete generated integration Auth user ${userId}: ${error.message}`,
                { cause: error },
              ),
            );
          }
        } catch (error) {
          cleanupErrors.push(
            new Error(
              `Delete generated integration Auth user ${userId}: ${error.message}`,
              { cause: error },
            ),
          );
        }
      }
      throwIntegrationFailures(testFailure, cleanupErrors);
    }
  },
);
