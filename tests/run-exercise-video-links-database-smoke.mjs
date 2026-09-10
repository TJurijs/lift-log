import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';
import { migrationStatements } from '../scripts/lib/portable-migrations.mjs';

const databaseUrl = process.env.LIFTLOG_VIDEO_SMOKE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(databaseUrl);
const db = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { statement_timeout: 15000, lock_timeout: 10000, application_name: 'liftlog-video-links-smoke' } });
const source = await readFile(new URL('../supabase/migrations/202609100004_multiple_exercise_video_links.sql', import.meta.url), 'utf8');
const owner = randomUUID();
const outsider = randomUUID();
const links = [{ url: 'https://www.youtube.com/watch?v=one', label: 'Front view' }, { url: 'https://example.test/demo.mp4', label: 'Side view' }];
const legacyUrl = 'https://www.youtube.com/watch?v=legacy';
let transactionOpen = false;

async function rejects(query, pattern) {
  await db.unsafe('savepoint rejected_video_write');
  try { await assert.rejects(query, pattern); }
  finally {
    await db.unsafe('rollback to savepoint rejected_video_write');
    await db.unsafe('release savepoint rejected_video_write');
  }
}
async function unchangedData() {
  const result = {};
  for (const table of ['exercises', 'workout_items', 'prescribed_entries', 'workout_sessions', 'session_item_logs', 'session_entries']) {
    const [row] = await db.unsafe(`select count(*)::integer as count,
      md5(coalesce(string_agg((to_jsonb(row) - 'video_links' - 'snapshot_video_links')::text, '' order by row.id), '')) as hash
      from public.${table} row`);
    result[table] = row;
  }
  return result;
}
function findItem(value, id) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.id === id && Object.hasOwn(value, 'videoLinks')) return value;
  for (const child of Object.values(value)) {
    const match = findItem(child, id);
    if (match) return match;
  }
  return undefined;
}
const mediaByName = (items) => Object.fromEntries(items.map((item) => [item.snapshot_name, {
  url: item.snapshot_video_url, links: item.snapshot_video_links,
}]));

try {
  await db.unsafe('begin');
  transactionOpen = true;
  const before = await unchangedData();
  const [{ installed }] = await db`select exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'exercises' and column_name = 'video_links') as installed`;
  if (!installed) for (const statement of migrationStatements(source)) await db.unsafe(statement);
  assert.deepEqual(await unchangedData(), before, 'Adding video lists must not rewrite any existing data or historical URL');
  const [catalogLegacy] = await db`select video_url, video_links from public.exercises
    where scope = 'global' and video_url is not null and video_links is null limit 1`;
  assert.ok(catalogLegacy.video_url);
  assert.equal(catalogLegacy.video_links, null, 'Untouched catalog links retain legacy behavior');

  for (const id of [owner, outsider]) {
    await db`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
      values (${id}::uuid, ${`videos-${id}@example.test`}, '{}'::jsonb, '{"given_name":"Video","family_name":"Smoke"}'::jsonb)`;
  }
  await db`select set_config('request.jwt.claim.sub', ${owner}, true)`;
  await db`select set_config('request.jwt.claim.role', 'authenticated', true)`;
  await db.unsafe('set local role authenticated');
  const [exercise] = await db`insert into public.exercises
    (scope, owner_id, name, default_entry_mode, default_tracking_fields, video_links)
    values ('personal', ${owner}::uuid, 'Custom video smoke', 'sets', array['reps'], ${db.json(links)}::jsonb)
    returning id, video_url, video_links`;
  assert.equal(exercise.video_url, links[0].url);
  assert.deepEqual(exercise.video_links, links);
  const [legacy] = await db`insert into public.exercises
    (scope, owner_id, name, default_entry_mode, default_tracking_fields, video_url)
    values ('personal', ${owner}::uuid, 'Legacy video smoke', 'sets', array['reps'], ${legacyUrl})
    returning id, video_url, video_links`;
  assert.equal(legacy.video_links, null);
  assert.equal(legacy.video_url, legacyUrl);
  const [cleared] = await db`insert into public.exercises
    (scope, owner_id, name, default_entry_mode, default_tracking_fields, video_links)
    values ('personal', ${owner}::uuid, 'Cleared video smoke', 'sets', array['reps'], '[]'::jsonb)
    returning id, video_url, video_links`;
  assert.deepEqual(cleared.video_links, []);
  assert.equal(cleared.video_url, null);

  const setLinks = (value) => db`update public.exercises set video_links = ${db.json(value)}::jsonb where id = ${exercise.id}::uuid returning video_url, video_links`;
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///demo.mp4', '//example.test/demo', '/relative',
    'https:///missing-host', 'https://user:pass@example.test/a', 'https://example.test:99999/a',
    'https://[not-ipv6]/a', 'https://999.999.999.999/a', 'https://example.test/a\nb', 'https://example.test\\other/a',
    `https://example.test/${'a'.repeat(2048)}`]) {
    await rejects(() => setLinks([{ url }]), /absolute HTTP or HTTPS/);
  }
  await rejects(() => setLinks(Array.from({ length: 11 }, (_, index) => ({ url: `https://example.test/${index}` }))), /at most 10/);
  await rejects(() => setLinks([{ url: links[0].url, label: 'x'.repeat(81) }]), /at most 80/);
  await rejects(() => setLinks([{ url: links[0].url, label: null }]), /Video labels/);
  await rejects(() => setLinks({ url: links[0].url }), /JSON array/);
  await rejects(() => setLinks([{ url: links[0].url, unexpected: true }]), /optional label/);
  const [deduped] = await setLinks([{ ...links[0], label: '  Front view  ' }, links[0], { url: links[1].url, label: ' ' }]);
  assert.deepEqual(deduped.video_links, [links[0], { url: links[1].url }]);
  await setLinks(links);
  await db`update public.exercises set video_url = 'https://example.test/legacy-edit' where id = ${exercise.id}::uuid`;
  const [legacyEdit] = await db`select video_links from public.exercises where id = ${exercise.id}::uuid`;
  assert.equal(legacyEdit.video_links, null, 'Legacy single-URL writes deliberately return to legacy representation');
  await setLinks(links);
  const [empty] = await setLinks([]);
  assert.deepEqual(empty.video_links, []);
  assert.equal(empty.video_url, null);
  await setLinks(links);

  await db`select set_config('request.jwt.claim.sub', ${outsider}, true)`;
  assert.equal((await setLinks([{ url: 'https://example.test/outsider' }])).length, 0, 'Another account cannot edit these links');
  assert.equal((await db`select id from public.exercises where id = ${exercise.id}::uuid`).length, 0);
  await rejects(() => db`insert into public.exercises
    (scope, owner_id, name, default_entry_mode, default_tracking_fields, video_links)
    values ('personal', ${owner}::uuid, 'Unauthorized video', 'sets', array['reps'], ${db.json(links)}::jsonb)`, /row-level security/);
  await db`select set_config('request.jwt.claim.sub', ${owner}, true)`;
  const searched = await db`select * from public.search_exercises('custom video smoke', 'personal')`;
  assert.deepEqual(searched[0].video_links, links);

  const [program] = await db`select public.create_blank_program(${owner}::uuid, 'Video snapshots smoke') as id`;
  const [week] = await db`select week.id from public.program_weeks week join public.program_versions version on version.id = week.program_version_id
    where version.program_id = ${program.id}::uuid and version.status = 'draft'`;
  const [workout] = await db`select public.append_program_workout(${week.id}::uuid, 'Video snapshot workout') as payload`;
  const [item] = await db`select public.append_workout_exercise(${workout.payload.sections[0].id}::uuid, ${exercise.id}::uuid) as payload`;
  assert.deepEqual(item.payload.videoLinks, links);
  assert.equal(item.payload.videoUrl, links[0].url);
  await db`select public.append_workout_exercise(${workout.payload.sections[0].id}::uuid, ${legacy.id}::uuid)`;
  await db`select public.append_workout_exercise(${workout.payload.sections[0].id}::uuid, ${cleared.id}::uuid)`;
  const [detail] = await db`select public.get_program_version_detail(${program.id}::uuid) as payload`;
  assert.deepEqual(findItem(detail.payload, item.payload.id).videoLinks, links);
  const [{ today }] = await db`select current_date::text as today`;
  const [run] = await db`select * from public.create_program_runs(${program.id}::uuid, ${[owner]}::uuid[],
    ${db.json([{ workoutId: workout.payload.id, plannedDate: today }])}::jsonb, ${randomUUID()}::uuid)`;
  const [runDetail] = await db`select public.get_program_run_detail(${run.run_id}::uuid) as payload`;
  const [runContent] = await db`select public.get_program_version_detail(${program.id}::uuid, null, ${runDetail.payload.programVersionId}::uuid) as payload`;
  assert.deepEqual(findItem(runContent.payload, item.payload.id).videoLinks, links);
  const [occurrence] = await db`select id from public.scheduled_workouts where program_run_id = ${run.run_id}::uuid`;
  const [scheduled] = await db`select public.get_scheduled_workout_detail(${occurrence.id}::uuid) as payload`;
  assert.deepEqual(findItem(scheduled.payload, item.payload.id).videoLinks, links);
  const [session] = await db`select public.start_scheduled_workout(${occurrence.id}::uuid) as id`;
  const sessionItems = await db`select id, snapshot_name, snapshot_video_url, snapshot_video_links
    from public.session_item_logs where workout_session_id = ${session.id}::uuid order by position`;
  const expectedMedia = {
    'Custom video smoke': { url: links[0].url, links },
    'Legacy video smoke': { url: legacyUrl, links: null },
    'Cleared video smoke': { url: null, links: [] },
  };
  assert.deepEqual(mediaByName(sessionItems), expectedMedia);
  await rejects(() => db`update public.session_item_logs set snapshot_video_links = '[]'::jsonb where id = ${sessionItems[0].id}::uuid`, /permission denied/);
  await db.unsafe('reset role');
  await rejects(() => db`update public.session_item_logs set snapshot_video_links = '[]'::jsonb where id = ${sessionItems[0].id}::uuid`, /immutable snapshots/);
  await db.unsafe('set local role authenticated');

  await setLinks([{ url: 'https://example.test/replaced-after-start', label: 'New demonstration' }]);
  await db`update public.exercises set video_url = 'https://example.test/replaced-legacy' where id = ${legacy.id}::uuid`;
  const [resumed] = await db`select public.start_scheduled_workout(${occurrence.id}::uuid) as id`;
  assert.equal(resumed.id, session.id);
  const [bootstrap] = await db`select public.get_workspace_bootstrap() as payload`;
  assert.deepEqual(findItem(bootstrap.payload.activeWorkout, item.payload.id).videoLinks, links, 'Resuming renders immutable session media, not later library edits');
  assert.deepEqual(bootstrap.payload.activeSession.items[0].videoLinks, links);
  assert.equal(bootstrap.payload.activeSession.items[1].videoLinks, null);
  assert.deepEqual(bootstrap.payload.activeSession.items[2].videoLinks, []);
  const draft = { sessionRpe: null, sessionNote: '', items: sessionItems.map((entry) => ({ itemLogId: entry.id, entries: [] })) };
  await db`select public.save_workout_session_draft(${session.id}::uuid, 0, ${randomUUID()}::uuid, ${db.json(draft)}::jsonb)`;
  await db`select public.complete_workout_session_confirmed(${session.id}::uuid, 1, ${randomUUID()}::uuid, null, '')`;
  const completedItems = await db`select snapshot_name, snapshot_video_url, snapshot_video_links
    from public.session_item_logs where workout_session_id = ${session.id}::uuid order by position`;
  assert.deepEqual(mediaByName(completedItems), expectedMedia);
  console.log('Video links SQL smoke passed: nullable legacy/custom/clear semantics; URL and label bounds; duplicate normalization; authorized multi-link writes; cross-account denial; search/program/run/schedule projections; immutable start/resume/completed media after library edits; no existing-data rewrite. Entire transaction rolled back.');
} finally {
  if (transactionOpen) await db.unsafe('rollback');
  await db.end({ timeout: 2 });
}
