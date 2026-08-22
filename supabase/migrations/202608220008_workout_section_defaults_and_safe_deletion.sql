-- New workouts always start with a complete, familiar section structure.
-- Main work is the required destination when a section is removed but its work is kept.

create or replace function public.add_workout_section(target_workout_id uuid, target_title text, target_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_version_id uuid; next_position integer; new_section_id uuid;
begin
  select week.program_version_id into target_version_id from public.workouts workout
  join public.program_weeks week on week.id = workout.program_week_id where workout.id = target_workout_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  if target_kind not in ('warmup','main','conditioning','cooldown','custom') then raise exception 'Invalid section type'; end if;
  if target_kind = 'main' and exists (
    select 1 from public.workout_sections section
    where section.workout_id = target_workout_id and section.section_kind = 'main'
  ) then
    raise exception 'A workout already has Main work';
  end if;
  select coalesce(max(section.position), -1) + 1 into next_position from public.workout_sections section where section.workout_id = target_workout_id;
  insert into public.workout_sections (workout_id, title, section_kind, position)
  values (target_workout_id, trim(target_title), target_kind, next_position) returning id into new_section_id;
  return new_section_id;
end;
$$;

create or replace function public.update_workout_section(
  target_section_id uuid,
  target_title text,
  target_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_version_id uuid; current_kind text; target_workout_id uuid;
begin
  select week.program_version_id, section.section_kind, section.workout_id
  into target_version_id, current_kind, target_workout_id
  from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where section.id = target_section_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  if trim(coalesce(target_title, '')) = '' then raise exception 'Section name is required'; end if;
  if target_kind not in ('warmup','main','conditioning','cooldown','custom') then raise exception 'Invalid section type'; end if;
  if current_kind = 'main' and target_kind <> 'main' then
    raise exception 'Main work must remain in every workout';
  end if;
  if current_kind <> 'main' and target_kind = 'main' and exists (
    select 1 from public.workout_sections section
    where section.workout_id = target_workout_id and section.section_kind = 'main'
  ) then
    raise exception 'A workout already has Main work';
  end if;
  update public.workout_sections
  set title = trim(target_title), section_kind = target_kind
  where id = target_section_id;
  return target_section_id;
end;
$$;

drop function public.delete_workout_section(uuid);

create function public.delete_workout_section(target_section_id uuid, delete_items boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workout_id uuid;
  removed_position integer;
  target_version_id uuid;
  target_kind text;
  main_section_id uuid;
  next_position integer := 0;
  item_row record;
begin
  select section.workout_id, section.position, week.program_version_id, section.section_kind
  into target_workout_id, removed_position, target_version_id, target_kind
  from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where section.id = target_section_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  if target_kind = 'main' then raise exception 'Main work must remain in every workout'; end if;

  select section.id into main_section_id
  from public.workout_sections section
  where section.workout_id = target_workout_id and section.section_kind = 'main'
  limit 1;
  if main_section_id is null then raise exception 'This workout needs Main work'; end if;

  if not delete_items then
    update public.workout_items
    set position = position + 1000
    where section_id = main_section_id;

    for item_row in
      select item.id from public.workout_items item
      where item.section_id = target_section_id
      order by item.position, item.id
    loop
      update public.workout_items
      set section_id = main_section_id, position = next_position
      where id = item_row.id;
      next_position := next_position + 1;
    end loop;

    for item_row in
      select item.id from public.workout_items item
      where item.section_id = main_section_id and item.position >= 1000
      order by item.position, item.id
    loop
      update public.workout_items set position = next_position where id = item_row.id;
      next_position := next_position + 1;
    end loop;
  end if;

  delete from public.workout_sections where id = target_section_id;
  update public.workout_sections set position = position + 1000 where workout_id = target_workout_id and position > removed_position;
  update public.workout_sections set position = position - 1001 where workout_id = target_workout_id and position > 1000 + removed_position;
  return target_workout_id;
end;
$$;

revoke all on function public.add_workout_section(uuid, text, text) from public;
revoke all on function public.update_workout_section(uuid, text, text) from public;
revoke all on function public.delete_workout_section(uuid, boolean) from public;
grant execute on function public.add_workout_section(uuid, text, text) to authenticated;
grant execute on function public.update_workout_section(uuid, text, text) to authenticated;
grant execute on function public.delete_workout_section(uuid, boolean) to authenticated;
