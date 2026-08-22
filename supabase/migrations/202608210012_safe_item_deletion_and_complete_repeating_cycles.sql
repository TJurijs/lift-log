-- Delete prescription rows while their parent item still resolves to an
-- editable draft, avoiding cascade-order false positives in the guard trigger.
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

  delete from public.prescribed_entries where workout_item_id = target_item_id;
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

-- Restore a structurally incomplete repeating cycle even if its one retained
-- dated workout has since been completed. Advance only after every expected
-- sequence slot in the current cycle exists and none remains outstanding.
create or replace function public.prepare_program_schedule(target_program_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_athlete_id uuid;
  target_program_id uuid;
  target_planning_mode text;
  workout_row record;
  workout_count integer := 0;
  present_count integer := 0;
  maximum_sequence integer := 0;
  cycle_start integer := 0;
  sequence_value integer := 0;
  inserted_count integer := 0;
  affected_count integer := 0;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select program.athlete_id, program.id, program.planning_mode
  into target_athlete_id, target_program_id, target_planning_mode
  from public.program_versions version
  join public.programs program on program.id = version.program_id
  where version.id = target_program_version_id and version.status = 'published'
  for update of version;
  if target_athlete_id is null then raise exception 'Published program not found'; end if;
  if target_athlete_id <> current_user_id then
    raise exception 'Only the athlete can prepare calendar workouts';
  end if;
  if not exists (
    select 1 from public.program_availability availability
    where availability.athlete_id = current_user_id
      and availability.program_id = target_program_id
  ) then raise exception 'Program is not available for scheduling'; end if;

  select count(*)::integer into workout_count
  from public.program_weeks week
  join public.workouts workout on workout.program_week_id = week.id
  where week.program_version_id = target_program_version_id;
  if workout_count = 0 then return 0; end if;

  if target_planning_mode = 'repeating_week' then
    select coalesce(max(scheduled.sequence_number), 0)
    into maximum_sequence
    from public.scheduled_workouts scheduled
    where scheduled.program_version_id = target_program_version_id;
    if maximum_sequence > 0 then
      cycle_start := ((maximum_sequence - 1) / workout_count) * workout_count;
      select count(distinct scheduled.sequence_number)::integer into present_count
      from public.scheduled_workouts scheduled
      where scheduled.program_version_id = target_program_version_id
        and scheduled.sequence_number > cycle_start
        and scheduled.sequence_number <= cycle_start + workout_count;
    end if;
    if maximum_sequence > 0 and present_count = workout_count and not exists (
      select 1 from public.scheduled_workouts scheduled
      where scheduled.program_version_id = target_program_version_id
        and scheduled.sequence_number > cycle_start
        and scheduled.sequence_number <= cycle_start + workout_count
        and scheduled.status in ('planned', 'in_progress')
    ) then
      cycle_start := cycle_start + workout_count;
    end if;
    sequence_value := cycle_start;
  end if;

  for workout_row in
    select workout.id
    from public.program_weeks week
    join public.workouts workout on workout.program_week_id = week.id
    where week.program_version_id = target_program_version_id
    order by week.week_index, workout.position
  loop
    sequence_value := sequence_value + 1;
    insert into public.scheduled_workouts (
      athlete_id, scheduled_by_id, program_version_id, workout_id,
      planned_date, sequence_number, status
    ) values (
      current_user_id, current_user_id, target_program_version_id, workout_row.id,
      null, sequence_value, 'planned'
    ) on conflict do nothing;
    get diagnostics affected_count = row_count;
    inserted_count := inserted_count + affected_count;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.delete_workout_item(uuid) from public;
revoke all on function public.prepare_program_schedule(uuid) from public;
grant execute on function public.delete_workout_item(uuid) to authenticated;
grant execute on function public.prepare_program_schedule(uuid) to authenticated;
