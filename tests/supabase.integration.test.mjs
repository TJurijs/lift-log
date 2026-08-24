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

      const templates = expectData(
        await athleteB
          .from("program_templates")
          .select("id,title,week_count,workouts")
          .eq("is_active", true)
          .order("title"),
        "load program library",
      );
      assert.equal(templates.length, 3);
      assert.ok(Array.isArray(templates[0].workouts));
      const expectedLibraryWorkouts =
        templates[0].week_count * templates[0].workouts.length;
      assert.ok(expectedLibraryWorkouts > 0);
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
      assert.deepEqual(
        expectData(
          await athleteB
            .from("scheduled_workouts")
            .select("id")
            .eq("program_version_id", libraryPublished.id),
          "library calendar before availability",
        ),
        [],
      );
      assert.equal(
        expectData(
          await athleteB.rpc("set_program_availability", {
            target_program_id: libraryProgramId,
            make_available: true,
          }),
          "make library program available",
        ),
        true,
      );
      const libraryOccurrences = expectData(
        await athleteB
          .from("scheduled_workouts")
          .select("id,planned_date,scheduled_by_id")
          .eq("program_version_id", libraryPublished.id),
        "load undated library workouts",
      );
      assert.equal(libraryOccurrences.length, expectedLibraryWorkouts);
      assert.ok(
        libraryOccurrences.every(
          (occurrence) =>
            occurrence.planned_date === null &&
            occurrence.scheduled_by_id === athleteBId,
        ),
      );
      assert.equal(
        expectData(
          await athleteB.rpc("prepare_program_schedule", {
            target_program_version_id: libraryPublished.id,
          }),
          "repeat library calendar preparation",
        ),
        0,
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
            .eq("athlete_id", athleteAId),
          "calendar after publish",
        ).length,
        0,
      );

      assert.match(
        (
          await coach.rpc("prepare_program_schedule", {
            target_program_version_id: coachDraftVersion.id,
          })
        ).error?.message ?? "",
        /Only the athlete/i,
      );
      assert.match(
        (
          await athleteA.rpc("prepare_program_schedule", {
            target_program_version_id: coachDraftVersion.id,
          })
        ).error?.message ?? "",
        /not available/i,
      );
      assert.equal(
        expectData(
          await athleteA.rpc("set_program_availability", {
            target_program_id: coachProgramId,
            make_available: true,
          }),
          "athlete makes program available",
        ),
        true,
      );
      assert.equal(
        expectData(
          await athleteA.rpc("prepare_program_schedule", {
            target_program_version_id: coachDraftVersion.id,
          }),
          "repeat calendar preparation",
        ),
        0,
      );
      const occurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select("*")
          .eq("program_version_id", coachDraftVersion.id)
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
            program_version_id: coachDraftVersion.id,
            workout_id: coachWorkout.id,
            planned_date: null,
            sequence_number: 1,
            status: "planned",
          },
          {
            athlete_id: athleteAId,
            scheduled_by_id: athleteAId,
            program_version_id: coachDraftVersion.id,
            workout_id: coachMobilityWorkout.id,
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

      expectData(
        await athleteA.rpc("publish_program_version", {
          target_version_id: draftVersion.id,
          effective_on: effectiveOn,
        }),
        "athlete publishes own content",
      );
      assert.equal(
        expectData(
          await athleteA.rpc("set_program_availability", {
            target_program_id: programId,
            make_available: true,
          }),
          "athlete makes own program available",
        ),
        true,
      );
      const athleteAuthoredOccurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select("id,program_version_id,workout_id")
          .eq("program_version_id", draftVersion.id),
        "load athlete-authored occurrence",
      );
      assert.equal(athleteAuthoredOccurrences.length, 1);

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
      expectData(
        await otherCoach.rpc("publish_program_version", {
          target_version_id: otherCoachDraftVersion.id,
          effective_on: effectiveOn,
        }),
        "second coach publishes content",
      );
      assert.equal(
        expectData(
          await athleteA.rpc("set_program_availability", {
            target_program_id: otherCoachProgramId,
            make_available: true,
          }),
          "athlete makes second coach program available",
        ),
        true,
      );
      const otherCoachOccurrences = expectData(
        await athleteA
          .from("scheduled_workouts")
          .select("id,program_version_id,workout_id")
          .eq("program_version_id", otherCoachDraftVersion.id),
        "load second coach occurrence",
      );
      assert.equal(otherCoachOccurrences.length, 1);
      assert.deepEqual(
        expectData(
          await otherCoach
            .from("scheduled_workouts")
            .select("id,program_version_id,workout_id")
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
          .eq("program_version_id", coachDraftVersion.id)
          .order("sequence_number"),
        "coach reads calendar",
      );
      assert.equal(coachCalendar[0].planned_date, datePlus(effectiveOn, 2));

      const freshDraft = expectData(
        await coach
          .from("program_versions")
          .select("id,title,description")
          .eq("program_id", coachProgramId)
          .eq("status", "draft")
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
          program_version_id: coachDraftVersion.id,
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
      assert.equal(coachSessionSummary.program_version_id, coachDraftVersion.id);
      assert.equal(coachSessionSummary.workout_title, coachWorkout.title);
      assert.deepEqual(Object.keys(coachSessionSummary).sort(), [
        "athlete_id",
        "completed_at",
        "completed_for_date",
        "id",
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
      assert.equal(coachSessionDetail.programVersionId, coachDraftVersion.id);
      assert.equal(coachSessionDetail.workoutTitle, coachWorkout.title);
      assert.equal(coachSessionDetail.items[0].entries[0].reps, 9);
      assert.deepEqual(Object.keys(coachSessionDetail).sort(), [
        "completedAt",
        "completedForDate",
        "id",
        "items",
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
        "fields",
        "id",
        "mode",
        "position",
        "title",
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
          await coach.from("programs").select("id").eq("id", libraryProgramId),
          "connected athlete-authored library remains private",
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
