-- Replace unfamiliar mobility drills with simple, video-backed movements.

do $$
declare
  replacement record;
begin
  for replacement in
    select *
    from (values
      ('Half-Kneeling Adductor Rock', 'Bird Dog'),
      ('Butterfly Adduction', 'Clamshell'),
      ('Snow Angel', 'Band External Rotation')
    ) as replacements(old_name, new_name)
  loop
    with target_exercise as (
      select exercise.*
      from public.exercises exercise
      where exercise.scope = 'global'
        and exercise.archived_at is null
        and exercise.video_url is not null
        and lower(trim(exercise.name)) = lower(trim(replacement.new_name))
      order by
        (exercise.source_provider = 'catalyst-athletics') desc,
        exercise.created_at,
        exercise.id
      limit 1
    ), target_item as (
      select item.id
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
        and lower(trim(item.snapshot_name)) = lower(trim(replacement.old_name))
      limit 1
    )
    update public.workout_items item
    set source_exercise_id = exercise.id,
        snapshot_name = exercise.name,
        snapshot_cue = exercise.cue,
        entry_mode = exercise.default_entry_mode,
        tracking_fields = exercise.default_tracking_fields
    from target_exercise exercise, target_item target
    where item.id = target.id;
  end loop;
end;
$$;
