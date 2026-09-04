-- Create complete authoring units in one transaction. Client-computed append
-- positions and separate child inserts could leave incomplete content after a
-- network failure, or collide when two editors appended at the same time.
create or replace function public.append_program_workout(
  target_week_id uuid,
  target_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  target_content_type text;
  next_position integer;
  workout_count integer;
  new_workout_id uuid;
begin
  select week.program_version_id, program.content_type
  into target_version_id, target_content_type
  from public.program_weeks week
  join public.program_versions version on version.id = week.program_version_id
  join public.programs program on program.id = version.program_id
  where week.id = target_week_id
  for update of week, version;
  if not public.can_edit_version(target_version_id) then
    raise exception 'Program version is not editable';
  end if;
  if trim(coalesce(target_title, '')) = '' then
    raise exception 'Workout name is required';
  end if;

  select coalesce(max(workout.position), -1) + 1, count(*)
  into next_position, workout_count
  from public.workouts workout
  where workout.program_week_id = target_week_id;
  if workout_count >= 200 then
    raise exception 'A program can contain at most 200 workouts';
  end if;
  if target_content_type = 'quick_workout' and workout_count > 0 then
    raise exception 'A single workout can contain only one workout';
  end if;

  insert into public.workouts (
    program_week_id, title, day_of_week, schedule_label, position, estimated_minutes
  ) values (
    target_week_id, trim(target_title), null,
    'Workout ' || (next_position + 1), next_position, 45
  ) returning id into new_workout_id;

  insert into public.workout_sections (workout_id, title, section_kind, position)
  values (new_workout_id, 'Exercises', 'main', 0);

  return private.workout_content_payload(new_workout_id);
end;
$$;

create or replace function public.append_workout_exercise(
  target_section_id uuid,
  target_exercise_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  source_exercise public.exercises%rowtype;
  new_item_id uuid;
  next_position integer;
  item_count integer;
  prescribed_payload jsonb;
begin
  -- Match the section lock used by workout-wide reorder, and serialize with
  -- publication before checking edit access to the selected draft revision.
  select week.program_version_id into target_version_id
  from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  join public.program_versions version on version.id = week.program_version_id
  where section.id = target_section_id
  for update of section, version;
  if not public.can_edit_version(target_version_id) then
    raise exception 'Program version is not editable';
  end if;

  -- A security-definer endpoint must explicitly enforce exercise visibility.
  -- Resolve defaults on the server so stale catalogue data cannot determine
  -- either the saved snapshot or its initial prescription.
  select exercise.* into source_exercise
  from public.exercises exercise
  where exercise.id = target_exercise_id
    and exercise.archived_at is null
    and (exercise.scope = 'global' or exercise.owner_id = (select auth.uid()));
  if not found then raise exception 'Exercise is unavailable'; end if;

  select coalesce(max(item.position), -1) + 1, count(*)
  into next_position, item_count
  from public.workout_items item
  where item.section_id = target_section_id;
  if item_count >= 100 then
    raise exception 'A workout can contain at most 100 exercises';
  end if;

  insert into public.workout_items (
    section_id, source_exercise_id, snapshot_name, snapshot_cue,
    entry_mode, tracking_fields, position
  ) values (
    target_section_id, source_exercise.id, source_exercise.name, source_exercise.cue,
    source_exercise.default_entry_mode, source_exercise.default_tracking_fields,
    next_position
  ) returning id into new_item_id;

  if source_exercise.default_entry_mode = 'sets' then
    insert into public.prescribed_entries (
      workout_item_id, position, reps_min, reps_max, target_rpe_min, target_rpe_max
    ) select new_item_id, position, 8, 8, 7, 8 from generate_series(0, 2) position;
  elsif source_exercise.default_entry_mode = 'intervals' then
    insert into public.prescribed_entries (
      workout_item_id, position, rounds, work_seconds, rest_seconds
    ) values (new_item_id, 0, 5, 60, 60);
  elsif source_exercise.default_entry_mode = 'result'
    and 'duration' = any(source_exercise.default_tracking_fields) then
    insert into public.prescribed_entries (workout_item_id, position, duration_seconds)
    values (new_item_id, 0, 1200);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.id, 'position', entry.position,
    'repsMin', entry.reps_min, 'repsMax', entry.reps_max,
    'targetRpeMin', entry.target_rpe_min, 'targetRpeMax', entry.target_rpe_max,
    'rounds', entry.rounds, 'workSeconds', entry.work_seconds,
    'restSeconds', entry.rest_seconds, 'durationSeconds', entry.duration_seconds
  ) order by entry.position), '[]'::jsonb)
  into prescribed_payload
  from public.prescribed_entries entry
  where entry.workout_item_id = new_item_id;

  return jsonb_build_object(
    'id', new_item_id, 'sourceExerciseId', source_exercise.id,
    'name', source_exercise.name, 'cue', source_exercise.cue,
    'exerciseCategory', source_exercise.category, 'videoUrl', source_exercise.video_url,
    'entryMode', source_exercise.default_entry_mode,
    'trackingFields', source_exercise.default_tracking_fields,
    'position', next_position, 'prescribedEntries', prescribed_payload
  );
end;
$$;

revoke all on function public.append_program_workout(uuid, text) from public, anon;
revoke all on function public.append_workout_exercise(uuid, uuid) from public, anon;
grant execute on function public.append_program_workout(uuid, text) to authenticated;
grant execute on function public.append_workout_exercise(uuid, uuid) to authenticated;
