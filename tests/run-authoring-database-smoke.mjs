import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const databaseUrl = process.env.LIFTLOG_AUTHORING_SMOKE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const target = new URL(databaseUrl);
if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(target.hostname) ||
    !/^postgres(?:ql)?:$/.test(target.protocol)) {
  throw new Error("Authoring database smoke requires a loopback PostgreSQL URL.");
}
const db = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
const owner = randomUUID();
const outsider = randomUUID();
let transactionOpen = false;

async function rejectMutation(query, message) {
  await db.unsafe("savepoint rejected_mutation");
  try {
    await assert.rejects(query, message);
  } finally {
    await db.unsafe("rollback to savepoint rejected_mutation");
    await db.unsafe("release savepoint rejected_mutation");
  }
}

try {
  await db.unsafe("begin");
  transactionOpen = true;
  await db`
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    values
      (${owner}::uuid, ${`authoring-${owner}@example.test`}, '{}'::jsonb,
        '{"given_name":"Authoring","family_name":"Owner"}'::jsonb),
      (${outsider}::uuid, ${`authoring-${outsider}@example.test`}, '{}'::jsonb,
        '{"given_name":"Authoring","family_name":"Other"}'::jsonb)
  `;
  const [privateExercise] = await db`
    insert into public.exercises (
      scope, owner_id, name, category, default_entry_mode, default_tracking_fields
    ) values ('personal', ${outsider}::uuid, 'Private exercise', 'Custom', 'sets', array['reps'])
    returning id
  `;
  await db`select set_config('request.jwt.claim.sub', ${owner}, true)`;
  await db.unsafe("set local role authenticated");
  const [program] = await db`
    select public.create_blank_program(${owner}::uuid, 'Atomic authoring smoke') as id
  `;
  const [week] = await db`
    select week.id, week.program_version_id
    from public.program_weeks week
    join public.program_versions version on version.id = week.program_version_id
    where version.program_id = ${program.id}::uuid and version.status = 'draft'
  `;
  const [workoutResult] = await db`
    select public.append_program_workout(${week.id}::uuid, ' First workout ') as payload
  `;
  const workout = workoutResult.payload;
  assert.equal(workout.title, "First workout");
  assert.equal(workout.position, 0);
  assert.equal(workout.sections.length, 1);
  const section = workout.sections[0];
  assert.equal(section.title, "Exercises");
  assert.equal(section.kind, "main");
  assert.deepEqual(section.items, []);
  const [nextWorkout] = await db`
    select public.append_program_workout(${week.id}::uuid, 'Second workout') as payload
  `;
  assert.equal(nextWorkout.payload.position, 1);
  assert.equal(nextWorkout.payload.scheduleLabel, "Workout 2");

  const fixtures = [
    { mode: "sets", fields: ["reps", "load", "rpe"], entries: 3 },
    { mode: "intervals", fields: ["rounds", "duration"], entries: 1 },
    { mode: "result", fields: ["duration"], entries: 1 },
    { mode: "result", fields: ["distance"], entries: 0 },
    { mode: "none", fields: [], entries: 0 },
  ];
  let setExerciseId;
  for (const [position, fixture] of fixtures.entries()) {
    const [exercise] = await db`
      insert into public.exercises (
        scope, owner_id, name, category, default_entry_mode, default_tracking_fields
      ) values (
        'personal', ${owner}::uuid, ${`Exercise ${position}`}, 'Custom',
        ${fixture.mode}, ${fixture.fields}::text[]
      ) returning id
    `;
    if (position === 0) setExerciseId = exercise.id;
    const [result] = await db`
      select public.append_workout_exercise(${section.id}::uuid, ${exercise.id}::uuid) as payload
    `;
    assert.equal(result.payload.position, position);
    assert.equal(result.payload.sourceExerciseId, exercise.id);
    assert.equal(result.payload.entryMode, fixture.mode);
    assert.deepEqual(result.payload.trackingFields, fixture.fields);
    assert.equal(result.payload.prescribedEntries.length, fixture.entries);
    if (fixture.mode === "sets") {
      assert.equal(result.payload.prescribedEntries[2].repsMin, 8);
      assert.equal(result.payload.prescribedEntries[2].targetRpeMax, 8);
    }
    if (fixture.mode === "intervals") assert.equal(result.payload.prescribedEntries[0].rounds, 5);
    if (fixture.mode === "result" && fixture.entries) {
      assert.equal(result.payload.prescribedEntries[0].durationSeconds, 1200);
    }
  }

  await rejectMutation(
    () => db`select public.append_workout_exercise(${section.id}::uuid, ${privateExercise.id}::uuid)`,
    /Exercise is unavailable/,
  );
  await rejectMutation(
    () => db`select public.append_program_workout(${week.id}::uuid, ' ')`,
    /Workout name is required/,
  );

  await db.unsafe("savepoint direct_item_policy");
  await rejectMutation(
    () => db`
      insert into public.workout_items (
        section_id, source_exercise_id, snapshot_name, entry_mode, position
      ) values (${section.id}::uuid, ${privateExercise.id}::uuid, 'Unauthorized source', 'none', 99)
    `,
    /row-level security/,
  );
  const [directItem] = await db`
    insert into public.workout_items (section_id, snapshot_name, entry_mode, position)
    values (${section.id}::uuid, 'No source', 'none', 99) returning id
  `;
  await rejectMutation(
    () => db`
      update public.workout_items set source_exercise_id = ${privateExercise.id}::uuid
      where id = ${directItem.id}::uuid
    `,
    /Exercise is unavailable/,
  );
  await db`
    update public.workout_items set source_exercise_id = ${setExerciseId}::uuid
    where id = ${directItem.id}::uuid
  `;
  // Simulate the reference preserved by authorized definer coach-copy RPCs.
  await db.unsafe("reset role");
  const [copiedItem] = await db`
    insert into public.workout_items (
      section_id, source_exercise_id, snapshot_name, entry_mode, position
    ) values (${section.id}::uuid, ${privateExercise.id}::uuid, 'Shared snapshot', 'none', 98)
    returning id
  `;
  await db.unsafe("set local role authenticated");
  await db`
    update public.workout_items set snapshot_cue = 'Edited copied cue',
      source_exercise_id = ${privateExercise.id}::uuid
    where id = ${copiedItem.id}::uuid
  `;
  assert.equal((await db`
    select snapshot_cue from public.workout_items where id = ${copiedItem.id}::uuid
  `)[0].snapshot_cue, "Edited copied cue");
  assert.equal((await db`select id from public.exercises where id = ${privateExercise.id}::uuid`).length, 0);
  await db.unsafe("rollback to savepoint direct_item_policy");
  await db.unsafe("release savepoint direct_item_policy");

  await db`select set_config('request.jwt.claim.sub', ${outsider}, true)`;
  await rejectMutation(
    () => db`select public.append_program_workout(${week.id}::uuid, 'Forbidden')`,
    /not editable/,
  );
  await rejectMutation(
    () => db`select public.append_workout_exercise(${section.id}::uuid, ${setExerciseId}::uuid)`,
    /not editable/,
  );
  await db`select set_config('request.jwt.claim.sub', ${owner}, true)`;

  // Inject failures at the second insert, then prove neither parent survives.
  // Trigger DDL and every fixture are transaction-local and rolled back below.
  await db.unsafe("reset role");
  await db.unsafe(`
    create function pg_temp.reject_authoring_child() returns trigger
    language plpgsql as $$ begin raise exception 'Injected child insert failure'; end; $$;
    create trigger authoring_smoke_reject_section before insert on public.workout_sections
      for each row execute function pg_temp.reject_authoring_child();
    create trigger authoring_smoke_reject_entry before insert on public.prescribed_entries
      for each row execute function pg_temp.reject_authoring_child();
  `);
  await db.unsafe("set local role authenticated");
  await rejectMutation(
    () => db`select public.append_program_workout(${week.id}::uuid, 'Must roll back')`,
    /Injected child insert failure/,
  );
  await rejectMutation(
    () => db`select public.append_workout_exercise(${section.id}::uuid, ${setExerciseId}::uuid)`,
    /Injected child insert failure/,
  );
  const [counts] = await db`
    select
      (select count(*) from public.workouts where program_week_id = ${week.id}::uuid)::integer as workouts,
      (select count(*) from public.workout_items where section_id = ${section.id}::uuid)::integer as items
  `;
  assert.deepEqual({ ...counts }, { workouts: 2, items: fixtures.length });

  await db.unsafe("reset role");
  await db.unsafe("drop trigger authoring_smoke_reject_section on public.workout_sections");
  await db.unsafe("drop trigger authoring_smoke_reject_entry on public.prescribed_entries");
  await db.unsafe("set local role authenticated");
  await db`select public.publish_program_version(${week.program_version_id}::uuid, current_date)`;
  await rejectMutation(
    () => db`select public.append_workout_exercise(${section.id}::uuid, ${setExerciseId}::uuid)`,
    /not editable/,
  );
  const [permissions] = await db`
    select
      has_function_privilege('anon', 'public.append_program_workout(uuid,text)', 'execute') as anonymous_workout,
      has_function_privilege('anon', 'public.append_workout_exercise(uuid,uuid)', 'execute') as anonymous_exercise
  `;
  assert.equal(permissions.anonymous_workout, false);
  assert.equal(permissions.anonymous_exercise, false);

  // Calendar keysets must retain every completion, including equal-date rows.
  await db.unsafe("reset role");
  await db`
    insert into public.workout_sessions (
      athlete_id, program_version_id, workout_id, workout_title, status,
      started_at, completed_at, completed_for_date
    )
    select ${owner}::uuid, ${week.program_version_id}::uuid, ${workout.id}::uuid,
      'Dense calendar', 'completed', now() - interval '1 hour', now(), current_date
    from generate_series(1, 205)
  `;
  await db.unsafe("set local role authenticated");
  // Match the scale runner: read-only mode is enabled after rollback-only
  // fixture writes. This rejects real DML even if a future read RPC adds it.
  await db.unsafe("set local transaction_read_only = on");
  await rejectMutation(
    () => db`update public.profiles set display_name = display_name where id = ${owner}::uuid`,
    /read-only transaction/,
  );
  const firstCalendarPage = await db`
    select * from public.list_calendar_session_summaries(current_date, current_date, 100)
  `;
  const secondCalendarPage = await db`
    select * from public.list_calendar_session_summaries(
      current_date, current_date, 100, current_date, ${firstCalendarPage.at(-1).id}::uuid
    )
  `;
  const finalCalendarPage = await db`
    select * from public.list_calendar_session_summaries(
      current_date, current_date, 100, current_date, ${secondCalendarPage.at(-1).id}::uuid
    )
  `;
  assert.equal(firstCalendarPage.length, 100);
  assert.equal(secondCalendarPage.length, 100);
  assert.equal(finalCalendarPage.length, 5);
  assert.equal(new Set([...firstCalendarPage, ...secondCalendarPage, ...finalCalendarPage]
    .map((session) => session.id)).size, 205);
  await rejectMutation(
    () => db`select * from public.list_calendar_session_summaries(current_date, current_date, 100, current_date, null)`,
    /cursor is incomplete/,
  );
  await db`select set_config('request.jwt.claim.sub', ${outsider}, true)`;
  assert.equal((await db`
    select * from public.list_calendar_session_summaries(current_date, current_date, 100)
  `).length, 0);

  console.log("Atomic authoring smoke passed: complete defaults, append order, authorization, child-failure rollback, immutable versions, dense calendar keysets, enforced read-only queries.");
} finally {
  if (transactionOpen) await db.unsafe("rollback");
  await db.end({ timeout: 2 });
}
