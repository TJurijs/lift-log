-- Replace the RDL with a conventional deadlift and an appropriate prescription.

do $$
declare
  target_item_id uuid;
  replacement public.exercises%rowtype;
begin
  select exercise.*
  into replacement
  from public.exercises exercise
  where exercise.scope = 'global'
    and exercise.archived_at is null
    and exercise.video_url is not null
    and lower(trim(exercise.name)) = 'deadlift'
  order by
    (exercise.source_provider = 'catalyst-athletics') desc,
    exercise.created_at,
    exercise.id
  limit 1;

  select item.id
  into target_item_id
  from public.workout_items item
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  join public.program_versions version on version.id = week.program_version_id
  join public.programs program on program.id = version.program_id
  where program.athlete_id = program.created_by_id
    and program.content_type = 'quick_workout'
    and program.title = 'Elina — General Fitness'
    and program.archived_at is null
    and lower(trim(item.snapshot_name)) = 'romanian deadlift (rdl)'
  limit 1;

  if target_item_id is null then return; end if;
  if replacement.id is null then raise exception 'Video-backed Deadlift exercise is missing'; end if;

  update public.workout_items
  set source_exercise_id = replacement.id,
      snapshot_name = replacement.name,
      snapshot_cue = replacement.cue,
      entry_mode = replacement.default_entry_mode,
      tracking_fields = replacement.default_tracking_fields
  where id = target_item_id;

  delete from public.prescribed_entries where workout_item_id = target_item_id;

  insert into public.prescribed_entries (
    workout_item_id, position, reps_min, reps_max,
    target_rpe_min, target_rpe_max
  )
  select target_item_id, position - 1, 5, 5, 6, 6
  from generate_series(1, 3) as series(position);
end;
$$;
