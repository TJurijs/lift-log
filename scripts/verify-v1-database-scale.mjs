import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import postgres from "postgres";
import {
  SCALE_SCENARIOS,
  deterministicUuid,
} from "./lib/scale-fixture.mjs";
import {
  DEFAULT_LOCAL_DATABASE_URL,
  assertLoopbackPostgresUrl,
  describeLocalDatabase,
  parseScaleVerificationArgs,
  runRollbackOnlyTransaction,
} from "./lib/local-database-verification.mjs";

const usage = `Usage: node scripts/verify-v1-database-scale.mjs [--output=artifacts/path/report.json]

Runs the V1 database scale contract against LOCAL Supabase only. The fixture is
created inside one transaction and the successful path deliberately throws a
private rollback signal, so no fixture row can be committed.`;

const args = parseScaleVerificationArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage);
  process.exit(0);
}

const databaseUrl =
  process.env.LIFTLOG_LOCAL_SCALE_DB_URL ?? DEFAULT_LOCAL_DATABASE_URL;
const parsedDatabaseUrl = assertLoopbackPostgresUrl(databaseUrl);
const databaseDescription = describeLocalDatabase(parsedDatabaseUrl);

const programShape = SCALE_SCENARIOS["program-40"];
const rosterShape = SCALE_SCENARIOS["coach-50x150"];
const exerciseShape = SCALE_SCENARIOS["exercise-5000"];
const anchorDate = rosterShape.anchorDate;
const calendarRangeStart = (() => {
  const date = new Date(`${anchorDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 92);
  return date.toISOString().slice(0, 10);
})();

const ids = {
  coach: deterministicUuid("database-scale:coach"),
  program: deterministicUuid("database-scale:program"),
  version: deterministicUuid("database-scale:version"),
  phase: deterministicUuid("database-scale:phase"),
  assignmentRequest: deterministicUuid("database-scale:assignment-request"),
  occurrenceRequest: deterministicUuid("database-scale:occurrence-request"),
};
const athleteIds = Array.from({ length: rosterShape.athletes }, (_, index) =>
  deterministicUuid(`database-scale:athlete:${index + 1}`),
);
const exerciseIds = Array.from({ length: exerciseShape.exercises }, (_, index) =>
  deterministicUuid(`database-scale:exercise:${index + 1}`),
);

const database = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 5,
  idle_timeout: 2,
  onnotice: () => {},
});

function numeric(value) {
  return Number(value ?? 0);
}

function equalCounts(before, after, message) {
  assert.deepEqual(after, before, message);
}

function buildProgramContent() {
  const weeks = [];
  const workouts = [];
  const sections = [];
  const items = [];
  const prescriptions = [];
  const sectionKinds = ["warmup", "main", "conditioning", "cooldown"];

  for (let weekIndex = 1; weekIndex <= programShape.weeks; weekIndex += 1) {
    const weekId = deterministicUuid(`database-scale:week:${weekIndex}`);
    weeks.push({
      id: weekId,
      program_version_id: ids.version,
      phase_id: ids.phase,
      week_index: weekIndex,
      label: `Week ${weekIndex}`,
    });
    for (
      let workoutPosition = 0;
      workoutPosition < programShape.workoutsPerWeek;
      workoutPosition += 1
    ) {
      const workoutKey = `${weekIndex}:${workoutPosition}`;
      const workoutId = deterministicUuid(`database-scale:workout:${workoutKey}`);
      const sequencePosition = workouts.length;
      workouts.push({
        id: workoutId,
        program_week_id: weekId,
        title: `Scale session ${sequencePosition + 1}`,
        day_of_week: null,
        position: workoutPosition,
        estimated_minutes: 75,
        schedule_label: `Workout ${sequencePosition + 1}`,
      });

      const workoutSections = Array.from(
        { length: programShape.sectionsPerWorkout },
        (_, sectionPosition) => {
          const sectionId = deterministicUuid(
            `database-scale:section:${workoutKey}:${sectionPosition}`,
          );
          sections.push({
            id: sectionId,
            workout_id: workoutId,
            title: ["Warm up", "Main work", "Functional", "Cooldown"][sectionPosition],
            section_kind: sectionKinds[sectionPosition] ?? "custom",
            notes: "Scale verification content",
            position: sectionPosition,
          });
          return sectionId;
        },
      );

      for (let itemIndex = 0; itemIndex < programShape.itemsPerWorkout; itemIndex += 1) {
        const sectionPosition = itemIndex % workoutSections.length;
        const itemId = deterministicUuid(
          `database-scale:item:${workoutKey}:${itemIndex}`,
        );
        const sourceExerciseId = exerciseIds[
          (workouts.length * programShape.itemsPerWorkout + itemIndex) % exerciseIds.length
        ];
        items.push({
          id: itemId,
          section_id: workoutSections[sectionPosition],
          source_exercise_id: sourceExerciseId,
          snapshot_name: `Scale movement ${sequencePosition + 1}-${itemIndex + 1}`,
          snapshot_cue: "Move with repeatable technique",
          entry_mode: "sets",
          tracking_fields: ["reps", "load", "rpe"],
          position: Math.floor(itemIndex / workoutSections.length),
        });
        for (
          let entryIndex = 0;
          entryIndex < programShape.prescriptionsPerItem;
          entryIndex += 1
        ) {
          prescriptions.push({
            id: deterministicUuid(
              `database-scale:prescription:${workoutKey}:${itemIndex}:${entryIndex}`,
            ),
            workout_item_id: itemId,
            position: entryIndex,
            reps_min: 3,
            reps_max: 5,
            load_kg: 40 + entryIndex * 5,
            target_rpe_min: 8,
            target_rpe_max: 8,
            target_text: "Scale target",
          });
        }
      }
    }
  }
  return { weeks, workouts, sections, items, prescriptions };
}

const content = buildProgramContent();

async function fixtureSentinels(connection) {
  const [row] = await connection`
    select
      exists(select 1 from auth.users where id = ${ids.coach}::uuid) as coach,
      exists(select 1 from public.programs where id = ${ids.program}::uuid) as program,
      exists(select 1 from public.exercises where id = ${exerciseIds[0]}::uuid) as exercise
  `;
  return row;
}

async function requireV1Contract(connection) {
  const [contract] = await connection`
    select
      to_regprocedure(
        'public.assign_published_program_version(uuid,uuid,uuid[],uuid)'
      ) is not null as assignment,
      to_regprocedure(
        'public.create_scheduled_occurrence(uuid,date,uuid,uuid,uuid)'
      ) is not null as occurrence,
      to_regprocedure(
        'public.list_schedulable_workouts(integer,text,integer,integer,uuid)'
      ) is not null as schedulable,
      to_regprocedure(
        'public.get_coach_athlete_detail(uuid,integer,integer,integer)'
      ) is not null as coach_detail
  `;
  assert.ok(
    Object.values(contract).every(Boolean),
    "Apply the V1 performance data architecture migration to local Supabase first.",
  );
}

async function setAuthenticatedUser(transaction, userId) {
  await transaction.unsafe("set local role authenticated");
  await transaction`
    select
      set_config('request.jwt.claim.sub', ${userId}, true),
      set_config('request.jwt.claim.role', 'authenticated', true),
      set_config(
        'request.jwt.claims',
        ${JSON.stringify({ sub: userId, role: "authenticated" })},
        true
      )
  `;
}

async function setDatabaseOwner(transaction) {
  await transaction.unsafe("reset role");
  await transaction`
    select
      set_config('request.jwt.claim.sub', '', true),
      set_config('request.jwt.claim.role', '', true),
      set_config('request.jwt.claims', '{}', true)
  `;
}

async function insertChunked(transaction, tableName, columns, rows, chunkSize = 750) {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    if (tableName === "program_weeks") {
      await transaction`insert into public.program_weeks ${transaction(chunk, ...columns)}`;
    } else if (tableName === "workouts") {
      await transaction`insert into public.workouts ${transaction(chunk, ...columns)}`;
    } else if (tableName === "workout_sections") {
      await transaction`insert into public.workout_sections ${transaction(chunk, ...columns)}`;
    } else if (tableName === "workout_items") {
      await transaction`insert into public.workout_items ${transaction(chunk, ...columns)}`;
    } else if (tableName === "prescribed_entries") {
      await transaction`insert into public.prescribed_entries ${transaction(chunk, ...columns)}`;
    } else {
      throw new Error(`Unsupported scale insert table: ${tableName}`);
    }
  }
}

async function seedAccountsAndContent(transaction) {
  const userIds = [ids.coach, ...athleteIds];
  const emails = userIds.map(
    (id, index) => `database-scale-${index === 0 ? "coach" : `athlete-${index}`}-${id}@example.test`,
  );
  const firstNames = userIds.map((_, index) => (index === 0 ? "Scale" : "Athlete"));
  const lastNames = userIds.map((_, index) =>
    index === 0 ? "Coach" : String(index).padStart(2, "0"),
  );
  await transaction`
    insert into auth.users (
      id, email, aud, role, raw_app_meta_data, raw_user_meta_data,
      email_confirmed_at, created_at, updated_at
    )
    select
      source.id,
      source.email,
      'authenticated',
      'authenticated',
      '{}'::jsonb,
      jsonb_build_object(
        'given_name', source.first_name,
        'family_name', source.last_name
      ),
      now(),
      now(),
      now()
    from unnest(
      ${userIds}::uuid[],
      ${emails}::text[],
      ${firstNames}::text[],
      ${lastNames}::text[]
    ) as source(id, email, first_name, last_name)
  `;

  const relationshipIds = athleteIds.map((_, index) =>
    deterministicUuid(`database-scale:relationship:${index + 1}`),
  );
  await transaction`
    insert into public.coach_relationships (id, athlete_id, coach_id)
    select relationship_id, athlete_id, ${ids.coach}::uuid
    from unnest(
      ${relationshipIds}::uuid[],
      ${athleteIds}::uuid[]
    ) as source(relationship_id, athlete_id)
  `;

  const exerciseNames = exerciseIds.map((_, index) => {
    const number = String(index + 1).padStart(4, "0");
    return index < exerciseIds.length / 2
      ? `ZZ scale squat ${number}`
      : `ZZ scale functional ${number}`;
  });
  const disciplines = exerciseIds.map((_, index) =>
    index < exerciseIds.length / 2 ? "weightlifting" : "functional",
  );
  await transaction`
    insert into public.exercises (
      id, scope, owner_id, name, category, cue, default_entry_mode,
      default_tracking_fields, discipline, tags
    )
    select
      source.id,
      'global',
      null,
      source.name,
      case when source.discipline = 'weightlifting' then 'Strength' else 'Conditioning' end,
      'Scale verification exercise',
      'sets',
      array['reps', 'load', 'rpe'],
      source.discipline,
      array['scale-verification']
    from unnest(
      ${exerciseIds}::uuid[],
      ${exerciseNames}::text[],
      ${disciplines}::text[]
    ) as source(id, name, discipline)
  `;

  await transaction`
    insert into public.programs (
      id, athlete_id, created_by_id, title, description, planning_mode,
      is_current, source_type, source_label, content_type
    ) values (
      ${ids.program}::uuid,
      ${ids.coach}::uuid,
      ${ids.coach}::uuid,
      'ZZ scale 40-workout sequence',
      'Forty-workout ordered database scale verification program',
      'fixed_weeks',
      true,
      'self',
      'Created by scale verification',
      'program'
    )
  `;
  await transaction`
    insert into public.program_versions (
      id, program_id, authored_by_id, version_number, status, title, description
    ) values (
      ${ids.version}::uuid,
      ${ids.program}::uuid,
      ${ids.coach}::uuid,
      1,
      'draft',
      'ZZ scale 40-workout sequence',
      'Forty-workout ordered database scale verification program'
    )
  `;
  await transaction`
    insert into public.program_phases (id, program_version_id, name, position)
    values (${ids.phase}::uuid, ${ids.version}::uuid, 'Scale phase', 0)
  `;

  await insertChunked(transaction, "program_weeks", [
    "id", "program_version_id", "phase_id", "week_index", "label",
  ], content.weeks);
  await insertChunked(transaction, "workouts", [
    "id", "program_week_id", "title", "day_of_week", "position",
    "estimated_minutes", "schedule_label",
  ], content.workouts);
  await insertChunked(transaction, "workout_sections", [
    "id", "workout_id", "title", "section_kind", "notes", "position",
  ], content.sections);
  await insertChunked(transaction, "workout_items", [
    "id", "section_id", "source_exercise_id", "snapshot_name", "snapshot_cue",
    "entry_mode", "tracking_fields", "position",
  ], content.items);
  await insertChunked(transaction, "prescribed_entries", [
    "id", "workout_item_id", "position", "reps_min", "reps_max", "load_kg",
    "target_rpe_min", "target_rpe_max", "target_text",
  ], content.prescriptions);

  await transaction`
    update public.program_versions
    set
      status = 'published',
      effective_from = ${anchorDate}::date,
      published_at = ${`${anchorDate}T06:00:00.000Z`}::timestamptz
    where id = ${ids.version}::uuid
  `;
}

async function contentCounts(transaction) {
  const [row] = await transaction`
    select
      (select count(*) from public.programs)::bigint as programs,
      (select count(*) from public.program_versions)::bigint as versions,
      (select count(*) from public.program_phases)::bigint as phases,
      (select count(*) from public.program_weeks)::bigint as weeks,
      (select count(*) from public.workouts)::bigint as workouts,
      (select count(*) from public.workout_sections)::bigint as sections,
      (select count(*) from public.workout_items)::bigint as items,
      (select count(*) from public.prescribed_entries)::bigint as prescriptions
  `;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numeric(value)]));
}

function explainDocument(rows) {
  const value = rows[0]?.["QUERY PLAN"];
  const document = typeof value === "string" ? JSON.parse(value) : value;
  assert.ok(Array.isArray(document) && document[0]?.Plan, "EXPLAIN JSON was not returned");
  return document[0];
}

function planMetrics(document) {
  const plan = document.Plan;
  return {
    planningMs: numeric(document["Planning Time"]),
    executionMs: numeric(document["Execution Time"]),
    actualRows: numeric(plan["Actual Rows"]),
    loops: numeric(plan["Actual Loops"]),
    sharedHitBlocks: numeric(plan["Shared Hit Blocks"]),
    sharedReadBlocks: numeric(plan["Shared Read Blocks"]),
    sharedDirtiedBlocks: numeric(plan["Shared Dirtied Blocks"]),
    sharedWrittenBlocks: numeric(plan["Shared Written Blocks"]),
    tempReadBlocks: numeric(plan["Temp Read Blocks"]),
    tempWrittenBlocks: numeric(plan["Temp Written Blocks"]),
    walRecords: numeric(plan["WAL Records"]),
    walFpi: numeric(plan["WAL FPI"]),
    walBytes: numeric(plan["WAL Bytes"]),
  };
}

async function explain(transaction, sqlText, parameters = []) {
  const rows = await transaction.unsafe(
    `explain (analyze, buffers, wal, format json) ${sqlText}`,
    parameters,
  );
  const document = explainDocument(rows);
  return { document, metrics: planMetrics(document) };
}

async function benchmarkRead(
  transaction,
  reports,
  name,
  sqlText,
  parameters,
  rowLimit,
) {
  const measured = await explain(transaction, sqlText, parameters);
  const rows = await transaction.unsafe(sqlText, parameters);
  assert.ok(rows.length <= rowLimit, `${name} exceeded its ${rowLimit}-row contract`);
  assert.equal(
    measured.metrics.actualRows,
    rows.length,
    `${name} EXPLAIN row count differs from execution`,
  );
  assert.equal(measured.metrics.walRecords, 0, `${name} unexpectedly wrote WAL`);
  reports.plans[name] = measured.document;
  reports.queries[name] = { ...measured.metrics, returnedRows: rows.length, rowLimit };
  return rows;
}

async function seedCompletedHistory(transaction) {
  await transaction`
    with athlete_map as (
      select athlete_id, athlete_number::integer
      from unnest(${athleteIds}::uuid[]) with ordinality
        as athlete(athlete_id, athlete_number)
    ),
    workout_map as (
      select workout_id, workout_number::integer
      from unnest(${content.workouts.map((workout) => workout.id)}::uuid[])
        with ordinality as workout(workout_id, workout_number)
    ),
    history as (
      select
        athlete.athlete_id,
        athlete.athlete_number,
        session_number,
        workout.workout_id,
        md5(
          'liftlog-db-scale-schedule:' || athlete.athlete_number || ':' || session_number
        )::uuid as schedule_id,
        (${anchorDate}::date - (session_number - 1))::date as completed_date
      from athlete_map athlete
      cross join generate_series(1, ${rosterShape.trainingsPerAthlete}) session_number
      join workout_map workout
        on workout.workout_number = ((session_number - 1) % ${content.workouts.length}) + 1
    )
    insert into public.scheduled_workouts (
      id, athlete_id, scheduled_by_id, assignment_id, program_version_id,
      workout_id, planned_date, sequence_number, status
    )
    select
      history.schedule_id,
      history.athlete_id,
      history.athlete_id,
      assignment.id,
      ${ids.version}::uuid,
      history.workout_id,
      history.completed_date,
      1000 + history.session_number,
      'completed'
    from history
    join public.program_assignments assignment
      on assignment.athlete_id = history.athlete_id
     and assignment.source_version_id = ${ids.version}::uuid
     and assignment.status = 'active'
  `;

  await transaction`
    insert into public.workout_sessions (
      id, athlete_id, scheduled_workout_id, assignment_id,
      program_version_id, workout_id, workout_title, status,
      started_at, completed_at, completed_for_date, session_rpe, athlete_note
    )
    select
      md5('liftlog-db-scale-session:' || scheduled.id::text)::uuid,
      scheduled.athlete_id,
      scheduled.id,
      scheduled.assignment_id,
      scheduled.program_version_id,
      scheduled.workout_id,
      workout.title,
      'completed',
      (scheduled.planned_date + time '08:00') at time zone 'UTC',
      (scheduled.planned_date + time '09:15') at time zone 'UTC',
      scheduled.planned_date,
      5 + (scheduled.sequence_number % 6),
      'Scale verification completed session'
    from public.scheduled_workouts scheduled
    join public.workouts workout on workout.id = scheduled.workout_id
    where scheduled.sequence_number between 1001 and 1150
      and scheduled.program_version_id = ${ids.version}::uuid
      and scheduled.assignment_id is not null
  `;

  // Completed results are intentionally immutable through the app-facing
  // triggers. The fixture loader is the database owner, keeps foreign keys and
  // lineage triggers enabled, and suspends only these two history guards while
  // constructing already-completed representative logs. Both ALTER statements
  // are themselves covered by the rollback-only transaction.
  await transaction.unsafe(
    "alter table public.session_item_logs disable trigger guard_session_item_history",
  );
  await transaction.unsafe(
    "alter table public.session_entries disable trigger guard_session_entry_history",
  );
  await transaction`
    insert into public.session_item_logs (
      id, workout_session_id, source_workout_item_id, snapshot_name,
      snapshot_cue, entry_mode, tracking_fields, position, athlete_note
    )
    select
      md5('liftlog-db-scale-log:' || session.id::text)::uuid,
      session.id,
      item.id,
      item.snapshot_name,
      item.snapshot_cue,
      item.entry_mode,
      item.tracking_fields,
      0,
      ''
    from public.workout_sessions session
    join lateral (
      select candidate.*
      from public.workout_sections section
      join public.workout_items candidate on candidate.section_id = section.id
      where section.workout_id = session.workout_id
      order by section.position, candidate.position, candidate.id
      limit 1
    ) item on true
    where session.assignment_id is not null
      and session.program_version_id = ${ids.version}::uuid
      and session.status = 'completed'
  `;

  await transaction`
    insert into public.session_entries (
      id, session_item_log_id, position, reps, load_kg, rpe, note
    )
    select
      md5('liftlog-db-scale-entry:' || log.id::text)::uuid,
      log.id,
      0,
      5,
      80,
      8,
      ''
    from public.session_item_logs log
    join public.workout_sessions session on session.id = log.workout_session_id
    where session.assignment_id is not null
      and session.program_version_id = ${ids.version}::uuid
      and session.status = 'completed'
  `;

  await transaction.unsafe(
    "alter table public.session_entries enable trigger guard_session_entry_history",
  );
  await transaction.unsafe(
    "alter table public.session_item_logs enable trigger guard_session_item_history",
  );
}

async function analyzeFixtureTables(transaction) {
  await transaction.unsafe(`analyze
    public.profiles,
    public.coach_relationships,
    public.exercises,
    public.programs,
    public.program_versions,
    public.program_phases,
    public.program_weeks,
    public.workouts,
    public.workout_sections,
    public.workout_items,
    public.prescribed_entries,
    public.program_assignments,
    public.scheduled_workouts,
    public.workout_sessions,
    public.session_item_logs,
    public.session_entries`);
}

async function runVerification(transaction) {
  await transaction.unsafe("set transaction isolation level repeatable read");
  await transaction.unsafe("set local statement_timeout = '120s'");
  await transaction.unsafe("set local lock_timeout = '5s'");
  await seedAccountsAndContent(transaction);
  await analyzeFixtureTables(transaction);

  const reports = { queries: {}, plans: {}, assertions: [] };
  const contentBeforeAssignment = await contentCounts(transaction);
  const [assignmentCountBefore] = await transaction`
    select count(*)::bigint as count from public.program_assignments
  `;

  await setAuthenticatedUser(transaction, ids.coach);
  const assignmentSql = `select * from public.assign_published_program_version(
    $1::uuid, $2::uuid, $3::uuid[], $4::uuid
  )`;
  const assignmentPlan = await explain(transaction, assignmentSql, [
    ids.program,
    ids.version,
    athleteIds,
    ids.assignmentRequest,
  ]);
  reports.plans.assignment = assignmentPlan.document;
  reports.queries.assignment = {
    ...assignmentPlan.metrics,
    requestedAthletes: athleteIds.length,
  };
  assert.equal(assignmentPlan.metrics.actualRows, athleteIds.length);

  await setDatabaseOwner(transaction);
  const contentAfterAssignment = await contentCounts(transaction);
  equalCounts(
    contentBeforeAssignment,
    contentAfterAssignment,
    "Shared assignment cloned program content",
  );
  const [assignmentCountAfter] = await transaction`
    select count(*)::bigint as count from public.program_assignments
  `;
  const assignmentsCreated =
    numeric(assignmentCountAfter.count) - numeric(assignmentCountBefore.count);
  assert.equal(assignmentsCreated, athleteIds.length);
  assert.ok(
    assignmentPlan.metrics.walRecords <= athleteIds.length * 100,
    "Shared assignment WAL amplification exceeded 100 records per athlete",
  );

  await setAuthenticatedUser(transaction, ids.coach);
  const assignmentReplay = await transaction.unsafe(assignmentSql, [
    ids.program,
    ids.version,
    athleteIds,
    ids.assignmentRequest,
  ]);
  assert.equal(assignmentReplay.length, athleteIds.length);
  assert.ok(assignmentReplay.every((row) => row.created === false));
  reports.assertions.push({
    contract: "shared-assignment",
    requested: athleteIds.length,
    assignmentRowsCreated: assignmentsCreated,
    contentRowsCloned: 0,
    idempotentReplayCreated: 0,
    maxWalRecordsPerAthlete: 100,
    walRecords: assignmentPlan.metrics.walRecords,
    passed: true,
  });

  const [firstAssignment] = await transaction`
    select id
    from public.program_assignments
    where athlete_id = ${athleteIds[0]}::uuid
      and source_version_id = ${ids.version}::uuid
      and status = 'active'
  `;
  assert.ok(firstAssignment?.id);
  await setDatabaseOwner(transaction);
  const [scheduleCountBefore] = await transaction`
    select count(*)::bigint as count from public.scheduled_workouts
  `;
  const [sessionCountBeforeOccurrence] = await transaction`
    select count(*)::bigint as count from public.workout_sessions
  `;
  const contentBeforeOccurrence = await contentCounts(transaction);

  await setAuthenticatedUser(transaction, athleteIds[0]);
  const occurrenceSql = `select public.create_scheduled_occurrence(
    $1::uuid, $2::date, $3::uuid, $4::uuid, $5::uuid
  ) as payload`;
  const occurrencePlan = await explain(transaction, occurrenceSql, [
    content.workouts[0].id,
    anchorDate,
    ids.occurrenceRequest,
    null,
    firstAssignment.id,
  ]);
  reports.plans.occurrence = occurrencePlan.document;
  reports.queries.occurrence = occurrencePlan.metrics;
  assert.equal(occurrencePlan.metrics.actualRows, 1);
  assert.ok(
    occurrencePlan.metrics.walRecords <= 200,
    "One occurrence exceeded the 200-WAL-record amplification contract",
  );

  const [occurrenceReplay] = await transaction.unsafe(occurrenceSql, [
    content.workouts[0].id,
    anchorDate,
    ids.occurrenceRequest,
    null,
    firstAssignment.id,
  ]);
  assert.equal(occurrenceReplay.payload.created, false);

  await setDatabaseOwner(transaction);
  const [scheduleCountAfter] = await transaction`
    select count(*)::bigint as count from public.scheduled_workouts
  `;
  const schedulesCreated = numeric(scheduleCountAfter.count) - numeric(scheduleCountBefore.count);
  assert.equal(schedulesCreated, 1);
  equalCounts(
    contentBeforeOccurrence,
    await contentCounts(transaction),
    "Creating one occurrence changed program content",
  );
  const [sessionCountAfterOccurrence] = await transaction`
    select count(*)::bigint as count from public.workout_sessions
  `;
  const sessionsCreated =
    numeric(sessionCountAfterOccurrence.count) - numeric(sessionCountBeforeOccurrence.count);
  assert.equal(sessionsCreated, 0);
  reports.assertions.push({
    contract: "single-occurrence",
    requested: 1,
    scheduleRowsCreated: schedulesCreated,
    sessionRowsCreated: sessionsCreated,
    contentRowsCreated: 0,
    idempotentReplayCreated: occurrenceReplay.payload.created ? 1 : 0,
    maxWalRecords: 200,
    walRecords: occurrencePlan.metrics.walRecords,
    passed: true,
  });

  await seedCompletedHistory(transaction);
  await analyzeFixtureTables(transaction);

  const [historyCounts] = await transaction`
    select
      (select count(*) from public.program_assignments
        where source_version_id = ${ids.version}::uuid and status = 'active')::bigint
        as assignments,
      (select count(*) from public.scheduled_workouts
        where assignment_id is not null and program_version_id = ${ids.version}::uuid
          and status = 'completed')::bigint as completed_occurrences,
      (select count(*) from public.workout_sessions
        where assignment_id is not null and program_version_id = ${ids.version}::uuid
          and status = 'completed')::bigint as completed_sessions,
      (select count(*) from public.session_item_logs log
        join public.workout_sessions session on session.id = log.workout_session_id
        where session.assignment_id is not null
          and session.program_version_id = ${ids.version}::uuid)::bigint as item_logs,
      (select count(*) from public.session_entries entry
        join public.session_item_logs log on log.id = entry.session_item_log_id
        join public.workout_sessions session on session.id = log.workout_session_id
        where session.assignment_id is not null
          and session.program_version_id = ${ids.version}::uuid)::bigint as entries
  `;
  const completedSessionTarget = athleteIds.length * rosterShape.trainingsPerAthlete;
  assert.equal(numeric(historyCounts.assignments), athleteIds.length);
  assert.equal(numeric(historyCounts.completed_occurrences), completedSessionTarget);
  assert.equal(numeric(historyCounts.completed_sessions), completedSessionTarget);
  assert.equal(numeric(historyCounts.item_logs), completedSessionTarget);
  assert.equal(numeric(historyCounts.entries), completedSessionTarget);

  await setAuthenticatedUser(transaction, athleteIds[0]);
  const assignmentId = firstAssignment.id;
  const programRows = await benchmarkRead(
    transaction,
    reports,
    "program-list",
    "select * from public.list_program_summaries($1::integer, $2::timestamptz, $3::uuid)",
    [25, null, null],
    25,
  );
  assert.equal(programRows.length, 1);
  const detailRows = await benchmarkRead(
    transaction,
    reports,
    "program-detail",
    "select public.get_program_version_detail($1::uuid, $2::uuid, $3::uuid) as payload",
    [null, assignmentId, null],
    1,
  );
  const detailPayload = detailRows[0].payload;
  assert.equal(detailPayload.weeks.length, programShape.weeks);
  assert.equal(
    detailPayload.weeks.reduce((sum, week) => sum + week.workouts.length, 0),
    programShape.weeks * programShape.workoutsPerWeek,
  );
  await benchmarkRead(
    transaction,
    reports,
    "schedulable-candidates",
    "select * from public.list_schedulable_workouts($1::integer, $2::text, $3::integer, $4::integer, $5::uuid)",
    [25, null, null, null, null],
    25,
  );
  await benchmarkRead(
    transaction,
    reports,
    "calendar",
    "select * from public.list_calendar_occurrences($1::date, $2::date, $3::integer, $4::date, $5::uuid)",
    [calendarRangeStart, anchorDate, 100, null, null],
    100,
  );
  await benchmarkRead(
    transaction,
    reports,
    "history",
    "select * from public.list_completed_session_summaries($1::integer, $2::timestamptz, $3::uuid)",
    [50, null, null],
    50,
  );
  const exerciseRows = await benchmarkRead(
    transaction,
    reports,
    "exercise-prefix-search",
    "select * from public.search_exercises($1::text, $2::text, $3::text[], $4::text[], $5::text[], $6::text[], $7::integer, $8::text, $9::uuid)",
    [
      "ZZ scale squat 04",
      "all",
      ["weightlifting"],
      ["Strength"],
      ["sets"],
      ["reps", "load"],
      50,
      null,
      null,
    ],
    50,
  );
  assert.equal(exerciseRows.length, 50);

  await setAuthenticatedUser(transaction, ids.coach);
  const coachRows = await benchmarkRead(
    transaction,
    reports,
    "coach-list",
    "select * from public.list_coach_athletes($1::integer, $2::text, $3::uuid)",
    [25, null, null],
    25,
  );
  assert.equal(coachRows.length, 25);
  const coachDetailRows = await benchmarkRead(
    transaction,
    reports,
    "coach-detail",
    "select public.get_coach_athlete_detail($1::uuid, $2::integer, $3::integer, $4::integer) as payload",
    [athleteIds[0], 25, 6, 6],
    1,
  );
  const coachPayload = coachDetailRows[0].payload;
  assert.ok(coachPayload.programs.length <= 25);
  assert.ok(coachPayload.upcoming.length <= 6);
  assert.ok(coachPayload.completed.length <= 6);

  reports.assertions.push(
    {
      contract: "fixture-shape",
      athletes: athleteIds.length,
      sharedAssignments: numeric(historyCounts.assignments),
      sourcePrograms: 1,
      weeks: content.weeks.length,
      workouts: content.workouts.length,
      exercises: exerciseIds.length,
      completedSessions: numeric(historyCounts.completed_sessions),
      completedSessionsPerAthlete: rosterShape.trainingsPerAthlete,
      passed: true,
    },
    {
      contract: "bounded-reads",
      programList: reports.queries["program-list"].returnedRows,
      schedulable: reports.queries["schedulable-candidates"].returnedRows,
      calendar: reports.queries.calendar.returnedRows,
      history: reports.queries.history.returnedRows,
      exerciseSearch: reports.queries["exercise-prefix-search"].returnedRows,
      coachList: reports.queries["coach-list"].returnedRows,
      coachProgramLimit: coachPayload.programs.length,
      coachUpcomingLimit: coachPayload.upcoming.length,
      coachCompletedLimit: coachPayload.completed.length,
      passed: true,
    },
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    database: databaseDescription,
    rolledBack: true,
    fixture: {
      coachCount: 1,
      athleteCount: athleteIds.length,
      programCount: 1,
      programVersionCount: 1,
      weekCount: content.weeks.length,
      workoutCount: content.workouts.length,
      sectionCount: content.sections.length,
      itemCount: content.items.length,
      prescriptionCount: content.prescriptions.length,
      exerciseCount: exerciseIds.length,
      sharedAssignmentCount: numeric(historyCounts.assignments),
      completedSessionCount: numeric(historyCounts.completed_sessions),
      completedSessionsPerAthlete: rosterShape.trainingsPerAthlete,
      loggedItemCount: numeric(historyCounts.item_logs),
      loggedEntryCount: numeric(historyCounts.entries),
    },
    ...reports,
  };
}

let report;
try {
  await requireV1Contract(database);
  assert.deepEqual(
    await fixtureSentinels(database),
    { coach: false, program: false, exercise: false },
    "A previous scale fixture is present; refusing to overlap it.",
  );
  report = await runRollbackOnlyTransaction(database, runVerification);
  assert.deepEqual(
    await fixtureSentinels(database),
    { coach: false, program: false, exercise: false },
    "Scale fixture rollback was not complete.",
  );
} finally {
  await database.end({ timeout: 2 });
}

if (args.output) {
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log("V1 local database scale verification passed; all fixture rows were rolled back.");
console.table(
  Object.entries(report.queries).map(([query, metrics]) => ({
    query,
    rows: metrics.returnedRows ?? metrics.actualRows,
    planning_ms: metrics.planningMs.toFixed(3),
    execution_ms: metrics.executionMs.toFixed(3),
    shared_hits: metrics.sharedHitBlocks,
    shared_reads: metrics.sharedReadBlocks,
    temp_writes: metrics.tempWrittenBlocks,
    wal_records: metrics.walRecords,
    wal_bytes: metrics.walBytes,
  })),
);
console.table(
  report.assertions.map((result) => ({
    contract: result.contract,
    passed: result.passed,
  })),
);
if (args.output) console.log(`Full EXPLAIN JSON report: ${args.output}`);
