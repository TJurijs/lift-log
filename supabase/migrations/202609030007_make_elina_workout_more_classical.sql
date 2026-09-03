-- Make Elina's workout use familiar, accessible general-fitness movements.

do $$
declare
  replacement record;
begin
  for replacement in
    select *
    from (values
      ('Muscle Clean From Power Position', 'Glute Bridge', 3, 12),
      ('Push Press', 'Dumbbell Incline Bench Press', 4, 8),
      ('Bent Row', 'Lat Pulldown', 4, 8)
    ) as replacements(old_name, new_name, set_count, rep_count)
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

    delete from public.prescribed_entries entry
    using public.workout_items item,
          public.workout_sections section,
          public.workouts workout,
          public.program_weeks week,
          public.program_versions version,
          public.programs program
    where entry.workout_item_id = item.id
      and section.id = item.section_id
      and workout.id = section.workout_id
      and week.id = workout.program_week_id
      and version.id = week.program_version_id
      and program.id = version.program_id
      and program.athlete_id = program.created_by_id
      and program.content_type = 'quick_workout'
      and program.title = 'Elina — General Fitness'
      and program.archived_at is null
      and lower(trim(item.snapshot_name)) = lower(trim(replacement.new_name));

    insert into public.prescribed_entries (
      workout_item_id, position, reps_min, reps_max,
      target_rpe_min, target_rpe_max
    )
    select
      item.id,
      series.position - 1,
      replacement.rep_count,
      replacement.rep_count,
      6,
      6
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    join public.program_versions version on version.id = week.program_version_id
    join public.programs program on program.id = version.program_id
    cross join lateral generate_series(1, replacement.set_count) series(position)
    where program.athlete_id = program.created_by_id
      and program.content_type = 'quick_workout'
      and program.title = 'Elina — General Fitness'
      and program.archived_at is null
      and lower(trim(item.snapshot_name)) = lower(trim(replacement.new_name));
  end loop;
end;
$$;
