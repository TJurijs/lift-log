-- Move an exercise within a workout while preserving its prescription rows.
-- Source and destination positions are compacted atomically so drag-and-drop
-- never exposes duplicate positions or a half-completed cross-section move.
create or replace function public.move_workout_item(
  target_item_id uuid,
  destination_section_id uuid,
  destination_position integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_section_id uuid;
  source_workout_id uuid;
  destination_workout_id uuid;
  target_version_id uuid;
  safe_position integer;
  item_count integer;
  next_position integer := 0;
  item_row record;
  target_placed boolean := false;
begin
  select item.section_id, section.workout_id, week.program_version_id
  into source_section_id, source_workout_id, target_version_id
  from public.workout_items item
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where item.id = target_item_id
  for update of item;

  if source_section_id is null then raise exception 'Exercise item not found'; end if;

  select section.workout_id
  into destination_workout_id
  from public.workout_sections section
  where section.id = destination_section_id
  for update of section;

  if destination_workout_id is null then raise exception 'Destination section not found'; end if;
  if destination_workout_id <> source_workout_id then
    raise exception 'Exercises can only move between sections in the same workout';
  end if;
  if not public.can_edit_version(target_version_id) then
    raise exception 'Program version is not editable';
  end if;

  select count(*)::integer
  into item_count
  from public.workout_items item
  where item.section_id = destination_section_id and item.id <> target_item_id;
  safe_position := greatest(0, least(coalesce(destination_position, item_count), item_count));

  update public.workout_items
  set position = position + 1000000
  where section_id in (source_section_id, destination_section_id);

  update public.workout_items
  set section_id = destination_section_id, position = 3000000
  where id = target_item_id;

  for item_row in
    select item.id
    from public.workout_items item
    where item.section_id = destination_section_id and item.id <> target_item_id
    order by item.position, item.id
  loop
    if next_position = safe_position then
      update public.workout_items set position = next_position where id = target_item_id;
      next_position := next_position + 1;
      target_placed := true;
    end if;
    update public.workout_items set position = next_position where id = item_row.id;
    next_position := next_position + 1;
  end loop;

  if not target_placed then
    update public.workout_items set position = next_position where id = target_item_id;
  end if;

  if source_section_id <> destination_section_id then
    next_position := 0;
    for item_row in
      select item.id
      from public.workout_items item
      where item.section_id = source_section_id
      order by item.position, item.id
    loop
      update public.workout_items set position = next_position where id = item_row.id;
      next_position := next_position + 1;
    end loop;
  end if;

  return destination_section_id;
end;
$$;

revoke all on function public.move_workout_item(uuid, uuid, integer) from public;
grant execute on function public.move_workout_item(uuid, uuid, integer) to authenticated;
