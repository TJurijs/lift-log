-- Exercise icons must remain available in completed logs without loading the
-- whole exercise library. Store only the visual category alongside immutable
-- session snapshots; results and prescriptions remain untouched.

alter table public.session_item_logs
  add column snapshot_category text not null default 'General';

create or replace function private.resolve_exercise_category(
  target_workout_item_id uuid,
  target_name text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select exercise.category
      from public.workout_items item
      join public.exercises exercise on exercise.id = item.source_exercise_id
      where item.id = target_workout_item_id
      limit 1
    ),
    (
      select exercise.category
      from public.exercises exercise
      where exercise.scope = 'global'
        and exercise.archived_at is null
        and lower(trim(exercise.name)) = lower(trim(target_name))
      order by exercise.created_at, exercise.id
      limit 1
    ),
    'General'
  );
$$;

create or replace function private.set_session_item_category_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.snapshot_category := private.resolve_exercise_category(
    new.source_workout_item_id,
    new.snapshot_name
  );
  return new;
end;
$$;

create trigger set_session_item_category_snapshot
before insert or update of source_workout_item_id, snapshot_name
on public.session_item_logs
for each row execute function private.set_session_item_category_snapshot();

-- Completed session rows are intentionally immutable. Temporarily suspend only
-- that guard while this migration fills the new presentation-only snapshot;
-- logged results and their existing snapshots are not changed.
alter table public.session_item_logs
  disable trigger guard_session_item_history;

update public.session_item_logs item
set snapshot_category = private.resolve_exercise_category(
  item.source_workout_item_id,
  item.snapshot_name
);

alter table public.session_item_logs
  enable trigger guard_session_item_history;

create or replace function public.get_authored_coach_session_detail(
  target_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_payload jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'id', session.id,
    'programVersionId', session.program_version_id,
    'workoutId', session.workout_id,
    'scheduledWorkoutId', session.scheduled_workout_id,
    'workoutTitle', session.workout_title,
    'startedAt', session.started_at,
    'completedAt', session.completed_at,
    'completedForDate', session.completed_for_date,
    'sessionRpe', session.session_rpe,
    'items', coalesce((
      select jsonb_agg(item_payload.payload order by item_payload.position, item_payload.id)
      from (
        select
          item.id,
          item.position,
          jsonb_build_object(
            'id', item.id,
            'title', item.snapshot_name,
            'cue', item.snapshot_cue,
            'exerciseCategory', item.snapshot_category,
            'mode', item.entry_mode,
            'fields', item.tracking_fields,
            'position', item.position,
            'entries', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', entry.id,
                  'position', entry.position,
                  'reps', entry.reps,
                  'loadKg', entry.load_kg,
                  'durationSeconds', entry.duration_seconds,
                  'distanceMetres', entry.distance_metres,
                  'rounds', entry.rounds,
                  'heartRate', entry.heart_rate,
                  'rpe', entry.rpe
                )
                order by entry.position, entry.id
              )
              from public.session_entries entry
              where entry.session_item_log_id = item.id
            ), '[]'::jsonb)
          ) as payload
        from public.session_item_logs item
        where item.workout_session_id = session.id
      ) item_payload
    ), '[]'::jsonb)
  )
  into result_payload
  from public.workout_sessions session
  join public.program_versions version
    on version.id = session.program_version_id
  join public.programs program
    on program.id = version.program_id
  join public.coach_relationships relationship
    on relationship.athlete_id = session.athlete_id
   and relationship.coach_id = (select auth.uid())
   and relationship.ended_at is null
  where session.id = target_session_id
    and session.status = 'completed'
    and program.athlete_id = session.athlete_id
    and program.created_by_id = (select auth.uid())
    and program.source_type = 'coach';

  return result_payload;
end;
$$;

revoke all on function private.resolve_exercise_category(uuid, text)
  from public, anon, authenticated;
revoke all on function private.set_session_item_category_snapshot()
  from public, anon, authenticated;
revoke all on function public.get_authored_coach_session_detail(uuid)
  from public, anon, authenticated;
grant execute on function public.get_authored_coach_session_detail(uuid)
  to authenticated;
