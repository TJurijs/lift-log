-- Stable occurrence identities connect the same workout and repeated movement
-- across immutable runs and copied template revisions. They carry no results.
alter table public.workouts add column history_lineage_id uuid not null default gen_random_uuid();
alter table public.workout_items add column history_lineage_id uuid not null default gen_random_uuid();

-- Older clones did not retain occurrence identity. Link only explicit based-on
-- revisions with an identical complete ordered movement structure. Dose changes
-- are safe; additions, replacements, renames and reorders remain unmatched.
create or replace function private.previous_values_structure(target_version_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'week', week.week_index, 'position', workout.position, 'title', workout.title,
    'scheduleLabel', workout.schedule_label,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'position', item.position, 'exerciseId', item.source_exercise_id,
      'name', item.snapshot_name, 'mode', item.entry_mode, 'fields', item.tracking_fields
    ) order by item.position, item.id)
    from public.workout_items item join public.workout_sections section on section.id = item.section_id
    where section.workout_id = workout.id), '[]'::jsonb)
  ) order by week.week_index, workout.position, workout.id), '[]'::jsonb)
  from public.workouts workout join public.program_weeks week on week.id = workout.program_week_id
  where week.program_version_id = target_version_id;
$$;

-- Only the new metadata is changed; frozen content and timestamps are retained.
alter table public.workouts disable trigger guard_workouts_draft;
alter table public.workouts disable trigger workouts_set_updated_at;
alter table public.workout_items disable trigger guard_workout_items_draft;
do $$
declare revision record;
begin
  for revision in
    with recursive version_depth as (
      select version.id, version.based_on_version_id, 0 as depth, array[version.id] as visited
      from public.program_versions version where version.based_on_version_id is null
      union all
      select child.id, child.based_on_version_id, parent.depth + 1, parent.visited || child.id
      from public.program_versions child join version_depth parent on parent.id = child.based_on_version_id
      where not child.id = any(parent.visited)
    ) select id, based_on_version_id from version_depth
      where based_on_version_id is not null order by depth, id
  loop
    if private.previous_values_structure(revision.id) <> '[]'::jsonb
      and private.previous_values_structure(revision.id) = private.previous_values_structure(revision.based_on_version_id) then
      update public.workouts target set history_lineage_id = source.history_lineage_id
      from public.program_weeks target_week, public.workouts source, public.program_weeks source_week
      where target.program_week_id = target_week.id and target_week.program_version_id = revision.id
        and source.program_week_id = source_week.id and source_week.program_version_id = revision.based_on_version_id
        and target_week.week_index = source_week.week_index and target.position = source.position;
      update public.workout_items target set history_lineage_id = source.history_lineage_id
      from public.workout_sections target_section, public.workouts target_workout, public.program_weeks target_week,
        public.workout_items source, public.workout_sections source_section, public.workouts source_workout, public.program_weeks source_week
      where target.section_id = target_section.id and target_section.workout_id = target_workout.id
        and target_workout.program_week_id = target_week.id and target_week.program_version_id = revision.id
        and source.section_id = source_section.id and source_section.workout_id = source_workout.id
        and source_workout.program_week_id = source_week.id and source_week.program_version_id = revision.based_on_version_id
        and target_workout.history_lineage_id = source_workout.history_lineage_id and target.position = source.position;
    end if;
  end loop;
end;
$$;
alter table public.workouts enable trigger guard_workouts_draft;
alter table public.workouts enable trigger workouts_set_updated_at;
alter table public.workout_items enable trigger guard_workout_items_draft;
drop function private.previous_values_structure(uuid);

create index idx_workouts_history_lineage on public.workouts(history_lineage_id, id);
create index idx_workout_items_history_lineage on public.workout_items(history_lineage_id, id);
create index idx_workout_sessions_previous_values on public.workout_sessions(athlete_id, workout_id, completed_at desc, id desc) where status = 'completed';

create or replace function private.guard_history_lineage()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.history_lineage_id is distinct from old.history_lineage_id then
    raise exception 'Workout history lineage is immutable';
  end if;
  return new;
end;
$$;
create trigger guard_history_lineage before update on public.workouts for each row execute function private.guard_history_lineage();
create trigger guard_history_lineage before update on public.workout_items for each row execute function private.guard_history_lineage();
revoke all on function private.guard_history_lineage() from public, anon, authenticated;

create or replace function public.get_previous_workout_values(target_workout_id uuid, exclude_session_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare viewer uuid := (select auth.uid()); workout_lineage uuid; previous_session uuid; previous_completed_at timestamptz; previous_workout uuid;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  select workout.history_lineage_id into workout_lineage
  from public.workouts workout join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = target_workout_id and public.can_read_version(week.program_version_id);
  if workout_lineage is null then return null; end if;

  select session.id, session.completed_at, session.workout_id
  into previous_session, previous_completed_at, previous_workout
  from public.workouts related
  join public.workout_sessions session on session.workout_id = related.id
  where related.history_lineage_id = workout_lineage and session.athlete_id = viewer
    and session.status = 'completed' and session.completed_at is not null
    and session.id is distinct from exclude_session_id
  order by session.completed_at desc, session.draft_saved_at desc nulls last, session.id desc limit 1;
  if previous_session is null then return null; end if;

  return jsonb_build_object('sessionId', previous_session, 'completedAt', previous_completed_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workoutItemId', current_item.id, 'mode', current_item.entry_mode,
        'fields', array(select field from unnest(current_item.tracking_fields) field where field = any(log.tracking_fields)),
        'entries', coalesce((select jsonb_agg(jsonb_build_object(
          'position', entry.position, 'reps', entry.reps, 'loadKg', entry.load_kg,
          'durationSeconds', entry.duration_seconds, 'distanceMetres', entry.distance_metres,
          'rounds', entry.rounds, 'heartRate', entry.heart_rate, 'rpe', entry.rpe
        ) order by entry.position) from public.session_entries entry where entry.session_item_log_id = log.id), '[]'::jsonb)
      ) order by current_item.position, current_item.id)
      from public.workout_items current_item
      join public.workout_sections current_section on current_section.id = current_item.section_id
      join public.workout_items previous_item on previous_item.history_lineage_id = current_item.history_lineage_id
      join public.workout_sections previous_section on previous_section.id = previous_item.section_id
      join public.session_item_logs log on log.workout_session_id = previous_session and log.source_workout_item_id = previous_item.id
      where current_section.workout_id = target_workout_id and previous_section.workout_id = previous_workout
        and current_item.entry_mode = log.entry_mode
        and current_item.source_exercise_id is not distinct from previous_item.source_exercise_id
        and (current_item.source_exercise_id is not null or current_item.snapshot_name = log.snapshot_name)
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_previous_workout_values(uuid, uuid) from public, anon;
grant execute on function public.get_previous_workout_values(uuid, uuid) to authenticated;


-- Every clone path shares this helper, preserving occurrence identity even after later reordering.
CREATE OR REPLACE FUNCTION private.clone_week_contents(source_week_id uuid, target_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  source_workout record;
  source_item record;
  target_workout_id uuid;
  target_section_id uuid;
  target_item_id uuid;
begin
  for source_workout in
    select * from public.workouts where program_week_id = source_week_id order by position, id
  loop
    insert into public.workouts (
      program_week_id, title, day_of_week, schedule_label, position, estimated_minutes, history_lineage_id
    ) values (
      target_week_id, source_workout.title, source_workout.day_of_week,
      source_workout.schedule_label, source_workout.position, source_workout.estimated_minutes, source_workout.history_lineage_id
    ) returning id into target_workout_id;

    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (target_workout_id, 'Exercises', 'main', 0)
    returning id into target_section_id;

    for source_item in
      select item.*
      from public.workout_items item
      join public.workout_sections section on section.id = item.section_id
      where section.workout_id = source_workout.id
      order by item.position, item.id
    loop
      insert into public.workout_items (
        section_id, source_exercise_id, snapshot_name, snapshot_cue,
        entry_mode, tracking_fields, position, history_lineage_id
      ) values (
        target_section_id, source_item.source_exercise_id, source_item.snapshot_name,
        source_item.snapshot_cue, source_item.entry_mode, source_item.tracking_fields,
        source_item.position, source_item.history_lineage_id
      ) returning id into target_item_id;

      insert into public.prescribed_entries (
        workout_item_id, position, reps_min, reps_max, load_kg, duration_seconds,
        distance_metres, rounds, work_seconds, rest_seconds, target_rpe_min,
        target_rpe_max, target_text
      )
      select target_item_id, entry.position, entry.reps_min, entry.reps_max,
        entry.load_kg, entry.duration_seconds, entry.distance_metres, entry.rounds,
        entry.work_seconds, entry.rest_seconds, entry.target_rpe_min,
        entry.target_rpe_max, entry.target_text
      from public.prescribed_entries entry
      where entry.workout_item_id = source_item.id
      order by entry.position;
    end loop;
  end loop;
end;
$function$;
