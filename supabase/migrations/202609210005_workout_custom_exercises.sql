-- A custom movement belongs to its workout snapshot. It must never create an
-- exercise-library entry; copying the workout carries its existing snapshot.
create or replace function public.append_custom_workout_exercise(
  target_section_id uuid,
  target_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  exercise_name text := trim(coalesce(target_name, ''));
  new_item_id uuid;
  next_position integer;
  item_count integer;
  prescribed_payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if exercise_name = '' or char_length(exercise_name) > 160 then
    raise exception 'Exercise name must be between 1 and 160 characters';
  end if;

  -- Use the same locks as library append/reordering/publication so simultaneous
  -- edits cannot reuse a position or modify an already-published prescription.
  select week.program_version_id into target_version_id
  from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  join public.program_versions version on version.id = week.program_version_id
  where section.id = target_section_id
  for update of section
  for share of version;
  if not coalesce(public.can_edit_version(target_version_id), false) then
    raise exception 'Program version is not editable';
  end if;

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
    target_section_id, null, exercise_name, '', 'sets', array['reps', 'load'], next_position
  ) returning id into new_item_id;
  insert into public.prescribed_entries (workout_item_id, position)
  select new_item_id, position from generate_series(0, 2) position;

  select jsonb_agg(jsonb_build_object('id', entry.id, 'position', entry.position)
    order by entry.position)
  into prescribed_payload
  from public.prescribed_entries entry where entry.workout_item_id = new_item_id;
  return jsonb_build_object(
    'id', new_item_id, 'sourceExerciseId', null, 'name', exercise_name, 'cue', '',
    'entryMode', 'sets', 'trackingFields', array['reps', 'load'],
    'position', next_position, 'prescribedEntries', prescribed_payload
  );
end;
$$;

revoke all on function public.append_custom_workout_exercise(uuid, text) from public, anon;
grant execute on function public.append_custom_workout_exercise(uuid, text) to authenticated;
