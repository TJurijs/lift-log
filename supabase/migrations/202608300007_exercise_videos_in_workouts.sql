-- Workout payloads and immutable completed logs retain the exercise demo URL,
-- so rendering a video action never requires loading the 600+ item catalogue.

alter table public.session_item_logs
  add column snapshot_video_url text;

create or replace function private.resolve_exercise_video_url(
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
      select exercise.video_url
      from public.workout_items item
      join public.exercises exercise on exercise.id = item.source_exercise_id
      where item.id = target_workout_item_id
      limit 1
    ),
    (
      select exercise.video_url
      from public.exercises exercise
      where exercise.scope = 'global'
        and exercise.archived_at is null
        and lower(trim(exercise.name)) = lower(trim(target_name))
        and exercise.video_url is not null
      order by exercise.created_at, exercise.id
      limit 1
    )
  );
$$;

create or replace function private.set_session_item_video_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.snapshot_video_url := private.resolve_exercise_video_url(
    new.source_workout_item_id,
    new.snapshot_name
  );
  return new;
end;
$$;

create trigger set_session_item_video_snapshot
before insert or update of source_workout_item_id, snapshot_name
on public.session_item_logs
for each row execute function private.set_session_item_video_snapshot();

alter table public.session_item_logs disable trigger guard_session_item_history;

update public.session_item_logs item
set snapshot_video_url = private.resolve_exercise_video_url(
  item.source_workout_item_id,
  item.snapshot_name
);

alter table public.session_item_logs enable trigger guard_session_item_history;

create or replace function private.workout_content_payload(target_workout_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with prescribed_payload as (
    select prescribed.workout_item_id,
      jsonb_agg(jsonb_build_object(
        'id', prescribed.id, 'position', prescribed.position,
        'repsMin', prescribed.reps_min, 'repsMax', prescribed.reps_max,
        'loadKg', prescribed.load_kg, 'durationSeconds', prescribed.duration_seconds,
        'distanceMetres', prescribed.distance_metres, 'rounds', prescribed.rounds,
        'workSeconds', prescribed.work_seconds, 'restSeconds', prescribed.rest_seconds,
        'targetRpeMin', prescribed.target_rpe_min,
        'targetRpeMax', prescribed.target_rpe_max, 'targetText', prescribed.target_text
      ) order by prescribed.position, prescribed.id) as entries
    from public.prescribed_entries prescribed
    join public.workout_items item on item.id = prescribed.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    where section.workout_id = target_workout_id
    group by prescribed.workout_item_id
  ), item_payload as (
    select item.section_id,
      jsonb_agg(jsonb_build_object(
        'id', item.id, 'sourceExerciseId', item.source_exercise_id,
        'exerciseCategory', exercise.category, 'videoUrl', exercise.video_url,
        'name', item.snapshot_name, 'cue', item.snapshot_cue,
        'entryMode', item.entry_mode, 'trackingFields', item.tracking_fields,
        'position', item.position,
        'prescribedEntries', coalesce(prescribed.entries, '[]'::jsonb)
      ) order by item.position, item.id) as items
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    left join public.exercises exercise on exercise.id = item.source_exercise_id
    left join prescribed_payload prescribed on prescribed.workout_item_id = item.id
    where section.workout_id = target_workout_id
    group by item.section_id
  ), section_payload as (
    select section.workout_id,
      jsonb_agg(jsonb_build_object(
        'id', section.id, 'title', section.title, 'kind', section.section_kind,
        'notes', section.notes, 'position', section.position,
        'items', coalesce(item.items, '[]'::jsonb)
      ) order by section.position, section.id) as sections
    from public.workout_sections section
    left join item_payload item on item.section_id = section.id
    where section.workout_id = target_workout_id
    group by section.workout_id
  )
  select jsonb_build_object(
    'id', workout.id, 'title', workout.title,
    'scheduleLabel', workout.schedule_label, 'dayOfWeek', workout.day_of_week,
    'position', workout.position, 'estimatedMinutes', workout.estimated_minutes,
    'sections', coalesce(section.sections, '[]'::jsonb)
  )
  from public.workouts workout
  left join section_payload section on section.workout_id = workout.id
  where workout.id = target_workout_id;
$$;

create or replace function private.program_version_content_payload(
  target_program_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with prescribed_payload as (
    select prescribed.workout_item_id,
      jsonb_agg(jsonb_build_object(
        'id', prescribed.id, 'position', prescribed.position,
        'repsMin', prescribed.reps_min, 'repsMax', prescribed.reps_max,
        'loadKg', prescribed.load_kg, 'durationSeconds', prescribed.duration_seconds,
        'distanceMetres', prescribed.distance_metres, 'rounds', prescribed.rounds,
        'workSeconds', prescribed.work_seconds, 'restSeconds', prescribed.rest_seconds,
        'targetRpeMin', prescribed.target_rpe_min,
        'targetRpeMax', prescribed.target_rpe_max, 'targetText', prescribed.target_text
      ) order by prescribed.position, prescribed.id) as entries
    from public.prescribed_entries prescribed
    join public.workout_items item on item.id = prescribed.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_program_version_id
    group by prescribed.workout_item_id
  ), item_payload as (
    select item.section_id,
      jsonb_agg(jsonb_build_object(
        'id', item.id, 'sourceExerciseId', item.source_exercise_id,
        'exerciseCategory', exercise.category, 'videoUrl', exercise.video_url,
        'name', item.snapshot_name, 'cue', item.snapshot_cue,
        'entryMode', item.entry_mode, 'trackingFields', item.tracking_fields,
        'position', item.position,
        'prescribedEntries', coalesce(prescribed.entries, '[]'::jsonb)
      ) order by item.position, item.id) as items
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join public.exercises exercise on exercise.id = item.source_exercise_id
    left join prescribed_payload prescribed on prescribed.workout_item_id = item.id
    where week.program_version_id = target_program_version_id
    group by item.section_id
  ), section_payload as (
    select section.workout_id,
      jsonb_agg(jsonb_build_object(
        'id', section.id, 'title', section.title, 'kind', section.section_kind,
        'notes', section.notes, 'position', section.position,
        'items', coalesce(item.items, '[]'::jsonb)
      ) order by section.position, section.id) as sections
    from public.workout_sections section
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join item_payload item on item.section_id = section.id
    where week.program_version_id = target_program_version_id
    group by section.workout_id
  ), workout_payload as (
    select workout.program_week_id,
      jsonb_agg(jsonb_build_object(
        'id', workout.id, 'title', workout.title,
        'scheduleLabel', workout.schedule_label, 'dayOfWeek', workout.day_of_week,
        'position', workout.position, 'estimatedMinutes', workout.estimated_minutes,
        'sections', coalesce(section.sections, '[]'::jsonb)
      ) order by workout.position, workout.id) as workouts
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    left join section_payload section on section.workout_id = workout.id
    where week.program_version_id = target_program_version_id
    group by workout.program_week_id
  ), week_payload as (
    select jsonb_agg(jsonb_build_object(
      'id', week.id, 'phaseId', week.phase_id, 'weekIndex', week.week_index,
      'label', week.label, 'workouts', coalesce(workout.workouts, '[]'::jsonb)
    ) order by week.week_index, week.id) as weeks
    from public.program_weeks week
    left join workout_payload workout on workout.program_week_id = week.id
    where week.program_version_id = target_program_version_id
  ), phase_payload as (
    select jsonb_agg(jsonb_build_object(
      'id', phase.id, 'name', phase.name, 'position', phase.position
    ) order by phase.position, phase.id) as phases
    from public.program_phases phase
    where phase.program_version_id = target_program_version_id
  )
  select jsonb_build_object(
    'phases', coalesce(phase.phases, '[]'::jsonb),
    'weeks', coalesce(week.weeks, '[]'::jsonb)
  )
  from phase_payload phase cross join week_payload week;
$$;

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
            'videoUrl', item.snapshot_video_url,
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

revoke all on function private.resolve_exercise_video_url(uuid, text)
  from public, anon, authenticated;
revoke all on function private.set_session_item_video_snapshot()
  from public, anon, authenticated;
revoke all on function public.get_authored_coach_session_detail(uuid)
  from public, anon, authenticated;
grant execute on function public.get_authored_coach_session_detail(uuid)
  to authenticated;
