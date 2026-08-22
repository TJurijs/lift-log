-- Remove a draft exercise and compact the remaining display positions atomically.
create or replace function public.delete_workout_item(target_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_section_id uuid;
  target_version_id uuid;
  removed_position integer;
begin
  select item.section_id, item.position, week.program_version_id
  into target_section_id, removed_position, target_version_id
  from public.workout_items item
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where item.id = target_item_id;

  if target_section_id is null then raise exception 'Exercise item not found'; end if;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;

  delete from public.workout_items where id = target_item_id;
  update public.workout_items
  set position = position + 1000
  where section_id = target_section_id and position > removed_position;
  update public.workout_items
  set position = position - 1001
  where section_id = target_section_id and position > 1000 + removed_position;

  return target_section_id;
end;
$$;

revoke all on function public.delete_workout_item(uuid) from public;
grant execute on function public.delete_workout_item(uuid) to authenticated;
