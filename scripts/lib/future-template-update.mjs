import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const templatePlanHash = (plan) => createHash('sha256').update(canonicalJson(plan)).digest('hex');

export async function readTemplateRows(db, versionId) {
  return db`select workout.id as workout_id, workout.title as workout_title, workout.position as workout_position,
    section.id as section_id, item.id as item_id, item.source_exercise_id, item.snapshot_name, item.snapshot_cue,
    item.entry_mode, item.tracking_fields, item.position,
    coalesce(jsonb_agg(to_jsonb(entry) order by entry.position) filter(where entry.id is not null), '[]'::jsonb) as entries
    from public.workouts workout join public.program_weeks week on week.id = workout.program_week_id
    join public.workout_sections section on section.workout_id = workout.id
    join public.workout_items item on item.section_id = section.id
    left join public.prescribed_entries entry on entry.workout_item_id = item.id
    where week.program_version_id = ${versionId}::uuid
    group by workout.id, section.id, item.id order by workout.position, item.position`;
}

function same(actual, expected, message) {
  assert.equal(canonicalJson(actual), canonicalJson(expected), message);
}

export function validateTemplatePlan(plan) {
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.operation, 'combine-explicit-complexes-and-time-holds');
  assert.equal(plan.projectRef, 'ofyeejyfroblunbspgve');
  assert.ok(plan.programId && plan.versionId && plan.ownerId && plan.programTitle);
  assert.ok(Array.isArray(plan.beforeRows) && Array.isArray(plan.afterRows) && Array.isArray(plan.exercises));
  assert.ok(plan.exercises.length > 0 && plan.exercises.length <= 2);
  assert.equal(new Set(plan.beforeRows.map((row) => row.item_id)).size, plan.beforeRows.length);
  assert.equal(new Set(plan.afterRows.map((row) => row.item_id)).size, plan.afterRows.length);
  const beforeIds = new Set(plan.beforeRows.map((row) => row.item_id));
  assert.ok(plan.afterRows.every((row) => beforeIds.has(row.item_id)), 'Keep original item identities; remove only the paired second component');
  assert.equal(plan.beforeRows.length - plan.afterRows.length, plan.exercises.length);
  for (const exercise of plan.exercises) {
    assert.equal(exercise.scope, 'personal');
    assert.equal(exercise.owner_id, plan.ownerId);
    assert.equal(exercise.default_entry_mode, 'sets');
    same(exercise.default_tracking_fields, ['reps', 'load', 'rpe'], 'Complex metrics must remain reps, weight and effort');
    assert.equal(exercise.video_links.length, 2);
    assert.ok(exercise.video_links.every((link) => typeof link.label === 'string' && link.label && /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]+$/.test(link.url)));
    assert.ok(plan.afterRows.some((row) => row.source_exercise_id === exercise.id));
  }
}

async function verifyIdentity(db, plan, lock = false) {
  const rows = lock
    ? await db`select program.id, program.title, program.created_by_id, program.athlete_id, program.archived_at,
        version.id as version_id, version.version_number, version.status
      from public.programs program join public.program_versions version on version.program_id = program.id
      where program.id = ${plan.programId}::uuid and version.id = ${plan.versionId}::uuid for update of program, version`
    : await db`select program.id, program.title, program.created_by_id, program.athlete_id, program.archived_at,
        version.id as version_id, version.version_number, version.status
      from public.programs program join public.program_versions version on version.program_id = program.id
      where program.id = ${plan.programId}::uuid and version.id = ${plan.versionId}::uuid`;
  assert.equal(rows.length, 1, 'The reviewed program and draft version must exist exactly once');
  const row = rows[0];
  assert.equal(row.title, plan.programTitle, 'Program title changed since review');
  assert.equal(row.created_by_id, plan.ownerId, 'Program owner differs from the reviewed owner');
  assert.equal(row.athlete_id, plan.ownerId, 'Only the reviewed self-authored template is eligible');
  assert.equal(row.archived_at, null, 'Archived programs are not eligible');
  assert.equal(row.version_number, plan.versionNumber);
  assert.equal(row.status, 'draft', 'Only the reviewed unpublished draft may change');
  const [usage] = await db`select
    (select count(*)::integer from public.scheduled_workouts where program_version_id = ${plan.versionId}::uuid) as schedules,
    (select count(*)::integer from public.workout_sessions where program_version_id = ${plan.versionId}::uuid) as sessions`;
  same(usage, { schedules: 0, sessions: 0 }, 'A template already used for schedules or sessions must not change');
  const [schema] = await db`select exists(select 1 from supabase_migrations.schema_migrations where version = '202609100005') as ready`;
  assert.equal(schema.ready, true, 'Recording compatibility migration 202609100005 must be promoted before updating templates');
}

async function verifyVideos(db, plan) {
  for (const video of plan.catalogVideos) {
    const rows = await db`select id, name, scope, source_provider, source_external_id, source_url, video_url
      from public.exercises where source_provider = ${video.source_provider} and source_external_id = ${video.source_external_id}
        and scope = 'global' and archived_at is null`;
    assert.equal(rows.length, 1, 'The reviewed source video must resolve to one global catalog entry');
    for (const field of ['name', 'source_provider', 'source_external_id', 'source_url', 'video_url']) {
      assert.equal(rows[0][field], video[field], `Catalog video ${video.name} changed since review`);
    }
  }
}

async function readProtectedState(db, plan) {
  const [state] = await db`select jsonb_build_object(
    'versions', (select coalesce(jsonb_agg(to_jsonb(version) order by version.id), '[]') from public.program_versions version where version.program_id = ${plan.programId}::uuid),
    'schedules', (select coalesce(jsonb_agg(to_jsonb(schedule) order by schedule.id), '[]') from public.scheduled_workouts schedule join public.program_versions version on version.id = schedule.program_version_id where version.program_id = ${plan.programId}::uuid),
    'sessions', (select coalesce(jsonb_agg(to_jsonb(session) order by session.id), '[]') from public.workout_sessions session join public.program_versions version on version.id = session.program_version_id where version.program_id = ${plan.programId}::uuid),
    'logs', (select coalesce(jsonb_agg(to_jsonb(log) order by log.id), '[]') from public.session_item_logs log join public.workout_sessions session on session.id = log.workout_session_id join public.program_versions version on version.id = session.program_version_id where version.program_id = ${plan.programId}::uuid),
    'entries', (select coalesce(jsonb_agg(to_jsonb(entry) order by entry.id), '[]') from public.session_entries entry join public.session_item_logs log on log.id = entry.session_item_log_id join public.workout_sessions session on session.id = log.workout_session_id join public.program_versions version on version.id = session.program_version_id where version.program_id = ${plan.programId}::uuid),
    'otherPersonalExercises', (select coalesce(jsonb_agg(to_jsonb(exercise) order by exercise.id), '[]') from public.exercises exercise where exercise.owner_id = ${plan.ownerId}::uuid and not(exercise.id = any(${plan.exercises.map((exercise) => exercise.id)}::uuid[])))) as payload`;
  const versions = await db`select id from public.program_versions where program_id = ${plan.programId}::uuid and id <> ${plan.versionId}::uuid order by id`;
  const otherContent = [];
  for (const version of versions) otherContent.push({ versionId: version.id, rows: await readTemplateRows(db, version.id) });
  return { state: state.payload, otherContent };
}

async function verifyPersonalExercises(db, plan, allowCreate) {
  const result = [];
  for (const expected of plan.exercises) {
    const existing = await db`select id, owner_id, scope, name, category, discipline, cue, default_entry_mode,
      default_tracking_fields, video_url, video_links, archived_at
      from public.exercises where id = ${expected.id}::uuid or (owner_id = ${plan.ownerId}::uuid and name = ${expected.name})`;
    if (!existing.length) {
      assert.ok(allowCreate, `Expected personal exercise ${expected.name} is missing`);
      result.push({ exercise: expected, create: true });
    } else {
      assert.equal(existing.length, 1, `Ambiguous personal exercise ${expected.name}`);
      same(existing[0], { ...expected, video_url: expected.video_links[0].url, archived_at: null }, `Existing personal exercise ${expected.name} differs from the reviewed definition`);
      result.push({ exercise: expected, create: false });
    }
  }
  return result;
}

export async function inspectTemplateUpdate(db, plan) {
  validateTemplatePlan(plan);
  await verifyIdentity(db, plan);
  await verifyVideos(db, plan);
  const rows = await readTemplateRows(db, plan.versionId);
  const alreadyApplied = canonicalJson(rows) === canonicalJson(plan.afterRows);
  if (!alreadyApplied) same(rows, plan.beforeRows, 'Draft contents changed since the reviewed plan was prepared');
  await verifyPersonalExercises(db, plan, !alreadyApplied);
  return { state: alreadyApplied ? 'already-applied' : 'ready', programId: plan.programId,
    programTitle: plan.programTitle, versionId: plan.versionId, ownerId: plan.ownerId,
    beforeItemCount: plan.beforeRows.length, afterItemCount: plan.afterRows.length, changes: plan.summary };
}

// The caller must provide a single transaction; all guards and verification
// share its snapshot. No triggers, RLS policies or history protections are disabled.
export async function applyTemplateUpdate(tx, plan) {
  validateTemplatePlan(plan);
  await verifyIdentity(tx, plan, true);
  await tx`select section.id from public.workout_sections section join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id where week.program_version_id = ${plan.versionId}::uuid order by section.id for update of section`;
  const inspection = await inspectTemplateUpdate(tx, plan);
  if (inspection.state === 'already-applied') return inspection;
  const preserved = await readProtectedState(tx, plan);
  const personal = await verifyPersonalExercises(tx, plan, true);
  for (const { exercise, create } of personal) if (create) {
    await tx`insert into public.exercises (id, owner_id, scope, name, category, discipline, cue, default_entry_mode, default_tracking_fields, video_links)
      values (${exercise.id}::uuid, ${exercise.owner_id}::uuid, 'personal', ${exercise.name}, ${exercise.category}, ${exercise.discipline},
        ${exercise.cue}, ${exercise.default_entry_mode}, ${exercise.default_tracking_fields}::text[], ${tx.json(exercise.video_links)}::jsonb)`;
  }
  const afterIds = new Set(plan.afterRows.map((row) => row.item_id));
  const removed = plan.beforeRows.filter((row) => !afterIds.has(row.item_id));
  for (const row of removed) {
    // Delete children while their parent still exists so the normal draft-tree
    // trigger can verify ownership of the version without disabling guards.
    await tx`delete from public.prescribed_entries where workout_item_id = ${row.item_id}::uuid`;
    await tx`delete from public.workout_items where id = ${row.item_id}::uuid`;
  }
  // Deleted second-component rows leave gaps. Move later rows toward the gap
  // in ascending order to preserve the unique section/position constraint.
  for (const row of plan.afterRows) {
    const before = plan.beforeRows.find((item) => item.item_id === row.item_id);
    if (canonicalJson(row) === canonicalJson(before)) continue;
    await tx`update public.workout_items set source_exercise_id = ${row.source_exercise_id}::uuid,
      snapshot_name = ${row.snapshot_name}, snapshot_cue = ${row.snapshot_cue}, entry_mode = ${row.entry_mode},
      tracking_fields = ${row.tracking_fields}::text[], position = ${row.position} where id = ${row.item_id}::uuid`;
    same(row.entries.map((entry) => entry.id), before.entries.map((entry) => entry.id), 'Preserve surviving prescribed-entry identities');
    for (const entry of row.entries) {
      const oldEntry = before.entries.find((candidate) => candidate.id === entry.id);
      if (canonicalJson(entry) === canonicalJson(oldEntry)) continue;
      await tx`update public.prescribed_entries set reps_min = ${entry.reps_min}, reps_max = ${entry.reps_max},
        load_kg = ${entry.load_kg}, duration_seconds = ${entry.duration_seconds}, distance_metres = ${entry.distance_metres},
        rounds = ${entry.rounds}, work_seconds = ${entry.work_seconds}, rest_seconds = ${entry.rest_seconds},
        target_rpe_min = ${entry.target_rpe_min}, target_rpe_max = ${entry.target_rpe_max}, target_text = ${entry.target_text}
        where id = ${entry.id}::uuid and workout_item_id = ${row.item_id}::uuid`;
    }
  }
  same(await readTemplateRows(tx, plan.versionId), plan.afterRows, 'Updated draft does not exactly match the reviewed result');
  same(await readProtectedState(tx, plan), preserved, 'Published content, existing schedules/sessions, or unrelated personal exercises changed');
  await verifyPersonalExercises(tx, plan, false);
  return { ...inspection, state: 'applied', removedItemIds: removed.map((row) => row.item_id),
    preserved: ['published versions', 'existing schedules', 'active/completed sessions', 'standalone jerk work', 'unrelated exercises'] };
}
