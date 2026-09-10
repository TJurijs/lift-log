-- New sessions start with blank actual measurements. Existing sessions and
-- published workout prescriptions are deliberately left unchanged.
-- Completion continues to require a confirmed revision: the client explicitly
-- saves even a blank draft before finishing without measurements.

create or replace function public.start_scheduled_workout(
  target_scheduled_workout_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  scheduled_occurrence public.scheduled_workouts%rowtype;
  existing_session_id uuid;
  session_id uuid;
  workout_title_value text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select occurrence.*
  into scheduled_occurrence
  from public.scheduled_workouts occurrence
  where occurrence.id = target_scheduled_workout_id
    and occurrence.athlete_id = current_user_id
  for update;
  if not found then
    raise exception 'Scheduled workout is invalid';
  end if;

  perform profile.id
  from public.profiles profile
  where profile.id = current_user_id
  for update;

  if scheduled_occurrence.planned_date is null then
    raise exception 'Undated workout cannot be started';
  end if;
  if scheduled_occurrence.status = 'skipped' then
    raise exception 'Skipped workout must be restored before it can be started';
  end if;
  if scheduled_occurrence.status = 'completed' then
    raise exception 'Completed workout cannot be started again';
  end if;
  if scheduled_occurrence.status = 'in_progress' then
    select session.id
    into existing_session_id
    from public.workout_sessions session
    where session.scheduled_workout_id = scheduled_occurrence.id
      and session.athlete_id = current_user_id
      and session.status = 'in_progress';
    if existing_session_id is null then
      raise exception 'In-progress scheduled workout is missing its session';
    end if;
    return existing_session_id;
  end if;
  if scheduled_occurrence.status is distinct from 'planned' then
    raise exception 'Only a planned workout can be started';
  end if;

  select session.id
  into existing_session_id
  from public.workout_sessions session
  where session.athlete_id = current_user_id
    and session.status = 'in_progress'
  order by session.started_at desc, session.id
  limit 1
  for update;
  if existing_session_id is not null then
    raise exception 'Finish the in-progress workout before starting another';
  end if;

  select workout.title
  into workout_title_value
  from public.workouts workout
  join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = scheduled_occurrence.workout_id
    and week.program_version_id = scheduled_occurrence.program_version_id;
  if workout_title_value is null then
    raise exception 'Workout content is unavailable';
  end if;

  insert into public.workout_sessions (
    athlete_id,
    scheduled_workout_id,
    assignment_id,
    program_version_id,
    workout_id,
    workout_title,
    status
  ) values (
    current_user_id,
    scheduled_occurrence.id,
    scheduled_occurrence.assignment_id,
    scheduled_occurrence.program_version_id,
    scheduled_occurrence.workout_id,
    workout_title_value,
    'in_progress'
  ) returning id into session_id;

  with source_items as materialized (
    select
      item.id,
      item.snapshot_name,
      item.snapshot_cue,
      item.entry_mode,
      item.tracking_fields,
      row_number() over (
        order by section.position, item.position, item.id
      )::integer - 1 as session_position
    from public.workout_sections section
    join public.workout_items item on item.section_id = section.id
    where section.workout_id = scheduled_occurrence.workout_id
  ),
  inserted_items as (
    insert into public.session_item_logs (
      workout_session_id,
      source_workout_item_id,
      snapshot_name,
      snapshot_cue,
      entry_mode,
      tracking_fields,
      position
    )
    select
      session_id,
      item.id,
      item.snapshot_name,
      item.snapshot_cue,
      item.entry_mode,
      item.tracking_fields,
      item.session_position
    from source_items item
    order by item.session_position
    returning id, source_workout_item_id, entry_mode
  ),
  entry_seed as (
    -- Plans and actuals share metric definitions, never metric values. Sets
    -- preserve their planned row count; result/interval logs store one summary.
    select inserted.id as session_item_log_id, prescribed.position
    from inserted_items inserted
    join public.prescribed_entries prescribed
      on prescribed.workout_item_id = inserted.source_workout_item_id
    where inserted.entry_mode = 'sets'
    union all
    select inserted.id, 0
    from inserted_items inserted
    where inserted.entry_mode in ('result', 'intervals')
      or (inserted.entry_mode = 'sets' and not exists (
        select 1 from public.prescribed_entries prescribed
        where prescribed.workout_item_id = inserted.source_workout_item_id
      ))
  )
  insert into public.session_entries (session_item_log_id, position)
  select entry.session_item_log_id, entry.position from entry_seed entry;

  update public.scheduled_workouts
  set status = 'in_progress'
  where id = scheduled_occurrence.id
    and athlete_id = current_user_id
    and status = 'planned';
  if not found then
    raise exception 'Scheduled workout changed while it was being started';
  end if;

  return session_id;
end;
$$;

-- Validate new prescription writes using the same per-row metric vocabulary
-- as session drafts. This does not revalidate or rewrite historical snapshots.
create or replace function public.save_workout_item_prescription(
  target_item_id uuid,
  target_cue text,
  target_mode text,
  target_fields text[],
  target_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  entry jsonb;
  field_name text;
  field_value numeric;
  entry_position integer := 0;
  allowed_fields text[];
  entries jsonb := coalesce(target_entries, '[]'::jsonb);
begin
  select week.program_version_id into target_version_id
  from public.workout_items item
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  join public.program_versions version on version.id = week.program_version_id
  where item.id = target_item_id
  for update of item
  for share of version;
  if not public.can_edit_version(target_version_id) then
    raise exception 'Program version is not editable';
  end if;
  if target_mode is null or target_mode not in ('none', 'sets', 'result', 'intervals') then
    raise exception 'Invalid prescription type';
  end if;
  allowed_fields := case target_mode
    when 'none' then array[]::text[]
    when 'sets' then array['reps', 'load', 'duration', 'distance', 'heartRate', 'rpe']
    when 'result' then array['duration', 'distance', 'load', 'heartRate', 'rpe']
    when 'intervals' then array['rounds', 'duration', 'distance', 'heartRate', 'rpe']
  end;
  if target_fields is null
    or array_position(target_fields, null) is not null
    or not target_fields <@ allowed_fields
    or cardinality(target_fields) <> (select count(distinct value) from unnest(target_fields) value)
    or (target_mode <> 'none' and cardinality(target_fields) = 0) then
    raise exception 'Invalid tracking fields for prescription type';
  end if;
  if length(coalesce(target_cue, '')) > 4000 then
    raise exception 'Exercise instructions cannot exceed 4000 characters';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' then
    raise exception 'Prescribed entries must be a JSON array';
  end if;
  if octet_length(entries::text) > 1000000 or jsonb_array_length(entries) > 250 then
    raise exception 'Prescription cannot contain more than 250 entries or exceed 1 MB';
  end if;
  if (target_mode = 'none' and jsonb_array_length(entries) <> 0)
    or (target_mode = 'result' and jsonb_array_length(entries) > 1) then
    raise exception 'Prescribed entry count does not match its item mode';
  end if;

  for entry in select value from jsonb_array_elements(entries)
  loop
    if jsonb_typeof(entry) is distinct from 'object' then
      raise exception 'Every prescribed entry must be a JSON object';
    end if;
    if exists (select 1 from jsonb_object_keys(entry) key(name) where key.name not in (
      'reps_min', 'reps_max', 'load_kg', 'duration_seconds', 'distance_metres',
      'rounds', 'work_seconds', 'rest_seconds', 'target_rpe_min', 'target_rpe_max', 'target_text'
    )) then
      raise exception 'Prescribed entry contains unsupported properties';
    end if;
    foreach field_name in array array[
      'reps_min', 'reps_max', 'load_kg', 'duration_seconds', 'distance_metres',
      'rounds', 'work_seconds', 'rest_seconds', 'target_rpe_min', 'target_rpe_max'
    ] loop
      if not (entry ? field_name) or entry ->> field_name is null then continue; end if;
      if jsonb_typeof(entry -> field_name) <> 'number' then
        raise exception 'Prescribed measurements must be JSON numbers or null';
      end if;
      field_value := (entry ->> field_name)::numeric;
      if field_value < 0 or field_value > (case
        when field_name = 'distance_metres' then 10000000
        when field_name in ('duration_seconds', 'work_seconds', 'rest_seconds') then 604800
        when field_name in ('target_rpe_min', 'target_rpe_max') then 10
        else 100000 end) then
        raise exception 'Prescription contains an out-of-range value';
      end if;
      if field_name in ('duration_seconds', 'rounds', 'work_seconds', 'rest_seconds')
        and field_value <> trunc(field_value) then
        raise exception 'Duration, rounds, work and rest must be whole numbers';
      end if;
      if field_name in ('target_rpe_min', 'target_rpe_max')
        and (field_value < 1 or field_value <> trunc(field_value)) then
        raise exception 'Target RPE must be a whole number between 1 and 10';
      end if;
      if (field_name in ('reps_min', 'reps_max') and not ('reps' = any(target_fields)))
        or (field_name = 'load_kg' and not ('load' = any(target_fields)))
        or (field_name = 'duration_seconds' and not ('duration' = any(target_fields)))
        or (field_name = 'distance_metres' and not ('distance' = any(target_fields)))
        or (field_name = 'rounds' and not ('rounds' = any(target_fields)))
        or (field_name in ('target_rpe_min', 'target_rpe_max') and not ('rpe' = any(target_fields)))
        or (field_name = 'work_seconds' and target_mode <> 'intervals') then
        raise exception 'Prescription contains a value that this item does not track';
      end if;
    end loop;
    if (entry ->> 'reps_min')::numeric > (entry ->> 'reps_max')::numeric
      or (entry ->> 'target_rpe_min')::numeric > (entry ->> 'target_rpe_max')::numeric then
      raise exception 'Prescription range minimum cannot exceed its maximum';
    end if;
    if entry ->> 'target_text' is not null and (
      jsonb_typeof(entry -> 'target_text') <> 'string'
      or length(entry ->> 'target_text') > 4000
    ) then
      raise exception 'Prescription target text must be a string of at most 4000 characters';
    end if;
  end loop;

  update public.workout_items
  set snapshot_cue = trim(coalesce(target_cue, '')), entry_mode = target_mode, tracking_fields = target_fields
  where id = target_item_id;
  delete from public.prescribed_entries where workout_item_id = target_item_id;
  for entry in select value from jsonb_array_elements(entries)
  loop
    insert into public.prescribed_entries (
      workout_item_id, position, reps_min, reps_max, load_kg, duration_seconds,
      distance_metres, rounds, work_seconds, rest_seconds, target_rpe_min,
      target_rpe_max, target_text
    ) values (
      target_item_id, entry_position,
      (entry ->> 'reps_min')::numeric, (entry ->> 'reps_max')::numeric,
      (entry ->> 'load_kg')::numeric, (entry ->> 'duration_seconds')::integer,
      (entry ->> 'distance_metres')::numeric, (entry ->> 'rounds')::integer,
      (entry ->> 'work_seconds')::integer, (entry ->> 'rest_seconds')::integer,
      (entry ->> 'target_rpe_min')::numeric, (entry ->> 'target_rpe_max')::numeric,
      nullif(entry ->> 'target_text', '')
    );
    entry_position := entry_position + 1;
  end loop;
  return target_item_id;
end;
$$;

revoke all on function public.save_workout_item_prescription(uuid, text, text, text[], jsonb) from public, anon;
grant execute on function public.save_workout_item_prescription(uuid, text, text, text[], jsonb) to authenticated;

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
  for update of section
  for share of version;
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

  -- Choose useful empty structure without inventing a training dose. Timed
  -- and distance sets start with one row and may be repeated by the author.
  if source_exercise.default_entry_mode = 'sets'
    and 'reps' = any(source_exercise.default_tracking_fields) then
    insert into public.prescribed_entries (workout_item_id, position)
    select new_item_id, position from generate_series(0, 2) position;
  elsif source_exercise.default_entry_mode <> 'none' then
    insert into public.prescribed_entries (workout_item_id, position)
    values (new_item_id, 0);
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
