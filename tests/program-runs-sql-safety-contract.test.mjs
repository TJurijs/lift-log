import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202609020003_program_runs.sql",
  import.meta.url,
);
const previousLifecycleUrl = new URL(
  "../supabase/migrations/202608290001_v1_performance_data_architecture.sql",
  import.meta.url,
);
const readGrantMigrationUrl = new URL(
  "../supabase/migrations/202609030011_grant_program_run_read_access.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);

function sqlFunction(source, name, schema = "public") {
  const matches = [
    ...source.matchAll(
      new RegExp(
        `create(?: or replace)? function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        "gi",
      ),
    ),
  ];
  assert.ok(matches.length, `expected SQL function: ${schema}.${name}`);
  return matches.at(-1)[0];
}

test("schedule changes have durable payload-checked idempotency", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const schedule = sqlFunction(sql, "schedule_program_run_workouts");

  assert.match(sql, /create table public\.program_run_schedule_requests/i);
  assert.match(
    sql,
    /primary key \(requested_by_id, request_key\)/i,
    "a request key must be unique for its authenticated caller",
  );
  assert.match(schedule, /insert into public\.program_run_schedule_requests/i);
  assert.match(schedule, /canonical_schedule is distinct from normalized_dates/i);
  assert.match(schedule, /Idempotency key was already used for another schedule change/i);
});

test("initial and partial run schedules preserve immutable workout order", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const canonical = sqlFunction(sql, "canonical_program_run_dates", "private");
  const mergedOrder = sqlFunction(
    sql,
    "validate_program_run_date_order",
    "private",
  );
  const schedule = sqlFunction(sql, "schedule_program_run_workouts");

  assert.match(
    canonical,
    /order by dated\.week_index, dated\.workout_position, dated\.workout_id[\s\S]*planned_date < ordered_dates\.previous_planned_date[\s\S]*Workout dates must follow program order/i,
  );
  assert.match(
    mergedOrder,
    /when coalesce\(requested\.supplied, false\) then requested\.planned_date[\s\S]*else slot\.planned_date/i,
    "partial changes must be checked against dates retained on omitted slots",
  );
  assert.match(
    mergedOrder,
    /order by effective\.position[\s\S]*Workout dates must follow program order/i,
  );
  assert.match(
    schedule,
    /private\.validate_program_run_date_order\([\s\S]*target_run\.id, normalized_dates/i,
  );
});

test("legacy assignment backfill retains actual immutable content lineage without duplicate active cards", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const backfill = sql.slice(
    sql.indexOf("insert into public.program_runs"),
    sql.indexOf("-- Self scheduling pre-dated runs"),
  );

  assert.match(backfill, /content_version\.program_id/i);
  assert.doesNotMatch(
    backfill,
    /coalesce\(assignment\.source_program_id, content_version\.program_id\)/i,
  );
  assert.match(
    sql,
    /update public\.program_assignments assignment[\s\S]*status = 'archived'[\s\S]*run\.legacy_assignment_id = assignment\.id/i,
  );
  const summaries = sqlFunction(sql, "list_program_summaries");
  assert.doesNotMatch(
    summaries,
    /'assignment'::text/i,
    "legacy assignment provenance must not reappear as reusable Programs content",
  );
});

test("repeat only clones a terminal run and used reusable content can still be archived", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const repeat = sqlFunction(sql, "repeat_program_run");
  const remove = sqlFunction(sql, "delete_own_program");
  const sync = sqlFunction(sql, "sync_program_run_from_schedule", "private");

  assert.match(repeat, /run\.status in \('completed', 'ended'\)/i);
  assert.doesNotMatch(remove, /locked_at\s+is\s+null/i);
  assert.match(remove, /set archived_at = now\(\), is_current = false/i);
  assert.doesNotMatch(remove, /delete from public\.program_runs/i);
  assert.match(
    sync,
    /status = 'ended'[\s\S]*old\.status is distinct from 'planned'[\s\S]*new\.status is distinct from 'skipped'[\s\S]*Ended program workouts cannot be restored/i,
  );
  assert.match(sync, /status = 'completed'[\s\S]*Completed program workouts cannot be changed/i);
});

test("a skip-completed run can be reopened without making completed history mutable", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const sync = sqlFunction(sql, "sync_program_run_from_schedule", "private");

  assert.match(
    sync,
    /linked_run_status = 'completed' and not \([\s\S]*old\.status = 'skipped'[\s\S]*new\.status = 'planned'[\s\S]*linked_slot_status = 'skipped'/i,
  );
  assert.match(
    sync,
    /program_run_workout_id = new\.program_run_workout_id[\s\S]*session\.status = 'completed'/i,
    "a completed session must keep its slot immutable",
  );
  assert.match(sync, /linked_run_status = 'ended'[\s\S]*Ended program workouts cannot be restored/i);
});

test("calendar, detail and Next derive source from the run creator", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const calendar = sqlFunction(sql, "list_calendar_occurrences");
  const detail = sqlFunction(sql, "get_scheduled_workout_detail");

  assert.match(calendar, /scheduled_by_id uuid, source_type text/i);
  for (const body of [calendar, detail]) {
    assert.match(
      body,
      /run\.created_by_id <> run\.athlete_id then 'coach' else 'self'/i,
    );
    assert.match(body, /occurrence\.assignment_id is not null then 'coach'/i);
  }
  assert.match(
    sql,
    /'programRunId', occurrence\.program_run_id,[\s\S]*'programRunWorkoutId', occurrence\.program_run_workout_id,[\s\S]*'scheduledById', occurrence\.scheduled_by_id,[\s\S]*'sourceType', case[\s\S]*run\.created_by_id <> run\.athlete_id then 'coach'/i,
    "the bounded Next bootstrap must retain run identity and canonical provenance",
  );
});

test("ended run occurrences keep lineage but leave every planning read", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const endRun = sqlFunction(sql, "end_program_run");
  const calendar = sqlFunction(sql, "list_calendar_occurrences");
  const upcoming = sqlFunction(sql, "list_upcoming_scheduled_workouts");

  assert.match(
    endRun,
    /update public\.program_run_workouts[\s\S]*set status = 'cancelled'[\s\S]*update public\.scheduled_workouts[\s\S]*set status = 'skipped'/i,
  );
  assert.doesNotMatch(endRun, /delete from public\.(program_run_workouts|scheduled_workouts)/i);
  for (const planningRead of [calendar, upcoming]) {
    assert.match(
      planningRead,
      /left join public\.program_runs run on run\.id = occurrence\.program_run_id[\s\S]*run\.id is null or run\.status <> 'ended'/i,
      "ended run occurrences must not remain actionable planning rows",
    );
  }
});

test("shared program content never shares one athlete's schedule metadata", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const policy = sql.slice(
    sql.lastIndexOf("create policy scheduled_workouts_read_authorized"),
    sql.indexOf(
      "create or replace function private.snapshot_program_for_run",
    ),
  );

  assert.match(policy, /athlete_id = \(select auth\.uid\(\)\)/i);
  assert.match(
    policy,
    /run\.id = scheduled_workouts\.program_run_id[\s\S]*run\.athlete_id = scheduled_workouts\.athlete_id[\s\S]*run\.created_by_id = \(select auth\.uid\(\)\)/i,
    "a coach may read only the exact athlete run they authored",
  );
  assert.match(
    policy,
    /assignment\.id = scheduled_workouts\.assignment_id[\s\S]*assignment\.athlete_id = scheduled_workouts\.athlete_id/i,
    "legacy assignment reads must remain tied to the occurrence athlete",
  );
  assert.doesNotMatch(
    policy,
    /public\.can_read_version\(program_version_id\)/i,
    "version visibility is intentionally broader than private schedule visibility",
  );
});

test("coach-authored working drafts stay private until an immutable run exists", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const canReadVersion = sqlFunction(sql, "can_read_version");
  const detail = sqlFunction(sql, "get_program_version_detail");
  const versionPolicy = sql.slice(
    sql.lastIndexOf("create policy program_versions_read_authorized"),
    sql.indexOf("create or replace function public.get_program_version_detail"),
  );

  assert.match(
    canReadVersion,
    /version\.status in \('published', 'superseded'\)[\s\S]*public\.can_read_program[\s\S]*public\.can_edit_program/i,
  );
  assert.match(canReadVersion, /public\.program_runs[\s\S]*private\.can_read_program_run/i);
  assert.match(versionPolicy, /using \(public\.can_read_version\(id\)\)/i);
  assert.match(
    detail,
    /may_read_draft := selected_program\.created_by_id = current_user_id[\s\S]*version\.status <> 'draft' or may_read_draft/i,
    "the SECURITY DEFINER detail RPC must duplicate the table policy's draft guard",
  );
  assert.match(
    detail,
    /version\.status in \('published', 'superseded'\)/i,
    "a non-author's implicit version selection must never prefer a working draft",
  );
});

test("opaque prescription overrides cannot silently diverge from what sessions log", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const overrides = sqlFunction(sql, "update_program_run_workout_overrides");

  assert.match(overrides, /target_overrides <> '\{\}'::jsonb/i);
  assert.match(overrides, /Per-run prescription overrides are not supported yet/i);
});

test("service-only fixture reset explicitly removes the run aggregate in safe order", async () => {
  const [sql, previous] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(previousLifecycleUrl, "utf8"),
  ]);
  const reset = sqlFunction(sql, "reset_test_population");
  const validateSlot = sqlFunction(sql, "validate_program_run_workout", "private");

  assert.match(reset, /auth\.role\(\)[\s\S]*service_role/i);
  assert.match(reset, /Fixture program runs cross namespace boundaries/i);
  const unlink = reset.indexOf("set scheduled_workout_id = null");
  const schedules = reset.indexOf("delete from public.scheduled_workouts");
  const slots = reset.indexOf("delete from public.program_run_workouts");
  const runs = reset.indexOf("delete from public.program_runs");
  assert.ok(unlink >= 0 && unlink < schedules && schedules < slots && slots < runs);
  assert.match(validateSlot, /liftlog\.test_reset[\s\S]*service_role/i);
  assert.match(previous, /rename to reset_test_population_pre_v1/i);
});

test("coach directory counts active runs rather than retired assignment rows", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const directory = sqlFunction(sql, "list_coach_athletes");

  assert.match(directory, /from public\.program_runs run/i);
  assert.match(directory, /run\.created_by_id = current_user_id/i);
  assert.match(directory, /run\.status in \('not_started', 'in_progress'\)/i);
  assert.doesNotMatch(directory, /from public\.program_assignments assignment/i);
});

test("bulk scheduling refreshes denormalized run status once after the loop", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const materialize = sqlFunction(sql, "materialize_program_run", "private");
  const schedule = sqlFunction(sql, "schedule_program_run_workouts");
  const sync = sqlFunction(sql, "sync_program_run_from_schedule", "private");

  for (const body of [materialize, schedule]) {
    assert.match(body, /set_config\('liftlog\.program_run_bulk_sync', 'on', true\)/i);
    assert.match(body, /set_config\('liftlog\.program_run_bulk_sync', 'off', true\)/i);
    assert.match(body, /private\.refresh_program_run_status/i);
  }
  assert.match(sync, /liftlog\.program_run_bulk_sync/i);
  assert.match(sql, /idx_program_runs_creator_request/i);
});

test("Calendar discovery is quick-workout-only and uses the exact editable revision", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const schedulable = sqlFunction(sql, "list_schedulable_workouts");
  const frequent = sqlFunction(sql, "list_frequent_schedulable_workouts");
  const legacyCreate = sqlFunction(sql, "create_scheduled_occurrence_for_use");

  for (const body of [schedulable, frequent]) {
    assert.match(body, /candidate\.status in \('draft', 'published'\)/i);
    assert.match(body, /when candidate\.status = 'draft' then 0/i);
    assert.match(body, /program\.content_type = 'quick_workout'/i);
  }
  assert.match(legacyCreate, /Only (?:your )?quick workout/i);
  assert.match(legacyCreate, /lock_program_for_use\(target_program_id\)/i);
});

test("every legacy assignment and occurrence writer is unavailable to app roles", async () => {
  const [sql, repository] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);
  const signatures = [
    "assign_published_program_version\\(uuid, uuid, uuid\\[\\], uuid\\)",
    "fork_program_assignment\\(uuid, uuid\\)",
    "assign_program_for_use\\(uuid, uuid\\[\\], uuid\\)",
    "assign_quick_workout_to_athletes\\(uuid, uuid\\[\\], date, uuid\\)",
    "assign_quick_workout_for_use\\(uuid, uuid\\[\\], date, uuid\\)",
    "create_scheduled_occurrence\\(uuid, date, uuid, uuid, uuid\\)",
    "create_scheduled_occurrence_for_use\\(uuid, date, uuid, uuid, uuid\\)",
    "create_coach_scheduled_occurrence\\(uuid, uuid, date, uuid\\)",
  ];

  for (const signature of signatures) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated;`,
        "i",
      ),
    );
  }
  const finalPrivileges = sql.slice(
    sql.lastIndexOf("-- These V0 writers and compatibility wrappers"),
  );
  assert.doesNotMatch(
    finalPrivileges,
    /grant execute on function public\.(?:assign_published_program_version|fork_program_assignment|assign_program_for_use|assign_quick_workout|create_scheduled_occurrence|create_coach_scheduled_occurrence)/i,
  );
  assert.doesNotMatch(
    repository,
    /forkProgramAssignment|assignQuickWorkoutToAthletes|createScheduledOccurrence|createCoachScheduledOccurrence|rpc\("(?:fork_program_assignment|assign_quick_workout_for_use|create_scheduled_occurrence_for_use|create_coach_scheduled_occurrence)"/,
    "the typed app repository must not advertise revoked compatibility writers",
  );
});

test("run materialization caps authored content and has supporting lineage indexes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const limits = sqlFunction(
    sql,
    "assert_program_run_content_within_limits",
    "private",
  );
  const materialize = sqlFunction(sql, "materialize_program_run", "private");

  assert.match(limits, /week_count > 52/i);
  assert.match(limits, /workout_count > 200/i);
  assert.match(limits, /section_count > 2000/i);
  assert.match(limits, /item_count > 5000/i);
  assert.match(limits, /entry_count > 20000/i);
  assert.match(limits, /having count\(\*\) > 20/i);
  assert.match(limits, /having count\(\*\) > 100/i);
  assert.match(
    materialize,
    /private\.assert_program_run_content_within_limits\([\s\S]*target_program_version_id[\s\S]*private\.canonical_program_run_dates/i,
    "the content tree must be rejected before the run row and slots are inserted",
  );
  assert.match(
    sql,
    /create index idx_program_runs_version\s+on public\.program_runs \(program_version_id\)/i,
  );
  assert.match(
    sql,
    /create index idx_scheduled_workouts_program_run_status\s+on public\.scheduled_workouts \(program_run_id, status\)\s+where program_run_id is not null/i,
  );
});

test("Next has a bounded athlete-only keyset read independent of bootstrap", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const upcoming = sqlFunction(sql, "list_upcoming_scheduled_workouts");

  assert.match(upcoming, /occurrence\.athlete_id = current_user_id/i);
  assert.match(
    upcoming,
    /pg_timezone_names[\s\S]*current_timestamp at time zone profile\.timezone[\s\S]*occurrence\.planned_date >= current_user_today/i,
    "Next uses the athlete's saved local date rather than the database server date",
  );
  assert.match(upcoming, /occurrence\.status in \('planned', 'in_progress', 'skipped'\)/i);
  assert.match(upcoming, /\(after_planned_date is null\) <> \(after_id is null\)/i);
  assert.match(
    upcoming,
    /\(occurrence\.planned_date, occurrence\.id\) > \(after_planned_date, after_id\)/i,
  );
  assert.match(upcoming, /order by occurrence\.planned_date, occurrence\.id/i);
  assert.match(upcoming, /least\(greatest\(coalesce\(page_limit, 20\), 1\), 100\)/i);
  assert.match(upcoming, /program_run_id uuid[\s\S]*program_run_workout_id uuid/i);
  assert.match(upcoming, /workout_title text,[\s\S]*estimated_minutes integer/i);
  assert.match(upcoming, /workout\.title, workout\.estimated_minutes/i);
  assert.match(upcoming, /scheduled_by_id uuid, source_type text/i);
  assert.match(
    sql,
    /grant execute on function public\.list_upcoming_scheduled_workouts\(integer, date, uuid\)[\s\S]*?to authenticated;/i,
  );
});

test("run summaries and details identify quick workouts without loading template trees", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const summaries = sqlFunction(sql, "list_program_run_summaries");
  const detail = sqlFunction(sql, "get_program_run_detail");

  assert.match(summaries, /title text, content_type text, status text/i);
  assert.match(summaries, /join public\.programs program[\s\S]*program\.content_type/i);
  assert.match(summaries, /finished_at timestamptz/i);
  assert.match(summaries, /coalesce\(run\.completed_at, run\.ended_at\)/i);
  assert.match(detail, /'contentType', program\.content_type/i);
  assert.match(detail, /'finishedAt', coalesce\(run\.completed_at, run\.ended_at\)/i);
});

test("run summaries use bounded keyset pages instead of a hidden 100-run ceiling", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const summaries = sqlFunction(sql, "list_program_run_summaries");

  assert.match(
    summaries,
    /page_limit integer default 26[\s\S]*after_created_at timestamptz default null[\s\S]*after_id uuid default null[\s\S]*creator_scope text default 'all'/i,
  );
  assert.match(
    summaries,
    /\(after_created_at is null\) <> \(after_id is null\)/i,
  );
  assert.equal(
    [...summaries.matchAll(/\(candidate\.created_at, candidate\.id\) < \(after_created_at, after_id\)/gi)].length,
    3,
    "every creator-scope branch must apply the immutable keyset",
  );
  assert.doesNotMatch(
    summaries,
    /after_status_rank|after_sort_at|summary_status_rank|summary_sort_at/i,
  );
  assert.match(
    summaries,
    /limit least\(greatest\(coalesce\(page_limit, 26\), 1\), 51\)/i,
  );
  assert.doesNotMatch(summaries, /limit 100/i);
  assert.match(
    summaries,
    /where creator_scope = 'self'[\s\S]*candidate\.created_by_id = candidate\.athlete_id[\s\S]*union all[\s\S]*where creator_scope = 'coach'[\s\S]*candidate\.created_by_id <> candidate\.athlete_id/i,
  );
  assert.doesNotMatch(
    summaries,
    /creator_scope = 'all'\s+or/i,
    "scope predicates must remain in plan-visible branches",
  );
  assert.match(
    summaries,
    /order by run\.created_at desc, run\.id desc/i,
  );
  assert.match(
    sql,
    /create index idx_program_runs_athlete_summary_page\s+on public\.program_runs \(\s*athlete_id,\s*created_at desc,\s*id desc\s*\)/i,
  );
  assert.match(
    sql,
    /create index idx_program_runs_athlete_coach_summary_page\s+on public\.program_runs \(\s*athlete_id,\s*created_at desc,\s*id desc\s*\)\s*where created_by_id <> athlete_id/i,
  );
});

test("run detail carries one bounded completed-session result per workout", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const detail = sqlFunction(sql, "get_program_run_detail");

  for (const field of ["sessionId", "completedAt", "completedForDate", "sessionRpe"]) {
    assert.match(detail, new RegExp(`'${field}'`, "i"));
  }
  assert.match(
    detail,
    /left join lateral \([\s\S]*session\.program_run_workout_id = slot\.id[\s\S]*session\.status = 'completed'[\s\S]*order by session\.completed_at desc, session\.id desc[\s\S]*limit 1/i,
  );
  assert.match(sql, /create index idx_workout_sessions_run_workout_completed/i);
});

test("the athlete or assigning coach can duplicate the exact immutable run revision", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const copy = sqlFunction(sql, "copy_program_run_to_own");

  assert.match(
    copy,
    /run\.id = target_run_id[\s\S]*run\.athlete_id = current_user_id[\s\S]*run\.created_by_id = current_user_id/i,
  );
  assert.match(
    copy,
    /version\.id = source_run\.program_version_id[\s\S]*version\.program_id = source_run\.source_program_id/i,
  );
  assert.match(copy, /private\.clone_program_version_tree\(source_version\.id, new_version_id\)/i);
  assert.doesNotMatch(copy, /order by[\s\S]*version_number/i);
  assert.match(copy, /source_program\.content_type/i);
  assert.match(
    sql,
    /grant execute on function public\.copy_program_run_to_own\(uuid\)[\s\S]*?to authenticated;/i,
  );
});

test("paged coach history includes run lineage and only the current coach's authored scope", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const history = sqlFunction(sql, "list_authored_coach_session_summaries");

  assert.match(history, /program_run_id uuid[\s\S]*program_run_workout_id uuid/i);
  assert.match(history, /program_id uuid[\s\S]*program_title text/i);
  assert.match(history, /run\.created_by_id = \(select auth\.uid\(\)\)/i);
  assert.match(history, /relationship\.ended_at is null/i);
  assert.match(history, /assignment\.assigned_by_id = \(select auth\.uid\(\)\)/i);
});

test("concurrent creation serializes snapshot selection before checking run receipts", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const create = sqlFunction(sql, "create_program_runs");
  const lockPosition = create.indexOf("for update;");
  const receiptPosition = create.indexOf("from public.program_runs run");

  assert.ok(lockPosition >= 0 && lockPosition < receiptPosition);
  assert.match(create, /where profile\.id = any\(normalized_athlete_ids\)[\s\S]*order by profile\.id[\s\S]*for update/i);
});

test("authenticated owners retain the explicit publish compatibility path", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const canEdit = sqlFunction(sql, "can_edit_program");
  const publish = sqlFunction(sql, "publish_program_version");

  assert.match(
    sql,
    /revoke all on function public\.publish_program_version\(uuid, date\)[\s\S]*?from public, anon;/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.publish_program_version\(uuid, date\)[\s\S]*?to authenticated;/i,
  );
  assert.match(
    canEdit,
    /program\.source_type = 'coach'[\s\S]*public\.is_active_coach\(program\.athlete_id\)/i,
    "the still-public athlete-specific legacy authoring API must not create content its active coach cannot finish",
  );
  assert.match(publish, /public\.can_edit_program\(target_program_id\)/i);
  assert.match(
    publish,
    /update public\.programs[\s\S]*locked_at = coalesce\(locked_at, now\(\)\)/i,
    "a compatibility publish must preserve the first-use lock invariant",
  );
});

test("run participant RLS can execute its guarded authorization predicate", async () => {
  const [sql, grants] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(readGrantMigrationUrl, "utf8"),
  ]);

  assert.match(
    sql,
    /create policy program_runs_read_participant[\s\S]*private\.can_read_program_run\(id\)/i,
  );
  assert.match(
    sql,
    /create policy program_run_workouts_read_participant[\s\S]*private\.can_read_program_run\(program_run_id\)/i,
  );
  assert.match(
    sql,
    /grant execute on function private\.can_read_program_run\(uuid\)[\s\S]*?to authenticated;/i,
  );
  assert.match(grants, /grant select on public\.program_runs to authenticated;/i);
  assert.match(grants, /grant select on public\.program_run_workouts to authenticated;/i);
  assert.match(grants, /grant select, insert, update, delete on public\.program_runs to service_role;/i);
  assert.match(grants, /grant select, insert, update, delete on public\.program_run_workouts to service_role;/i);
});
