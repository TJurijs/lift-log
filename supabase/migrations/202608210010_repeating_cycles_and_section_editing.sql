-- Repeating programs prepare one outstanding cycle at a time, while fixed
-- programs remain finite and idempotent.
create or replace function public.prepare_program_schedule(target_program_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_athlete_id uuid;
  target_planning_mode text;
  workout_row record;
  sequence_value integer := 0;
  inserted_count integer := 0;
  affected_count integer := 0;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select program.athlete_id, program.planning_mode
  into target_athlete_id, target_planning_mode
  from public.program_versions version
  join public.programs program on program.id = version.program_id
  where version.id = target_program_version_id and version.status = 'published'
  for update of version;
  if target_athlete_id is null then raise exception 'Published program not found'; end if;
  if target_athlete_id <> current_user_id then
    raise exception 'Only the athlete can prepare calendar workouts';
  end if;

  if target_planning_mode = 'repeating_week' then
    if exists (
      select 1 from public.scheduled_workouts scheduled
      where scheduled.program_version_id = target_program_version_id
        and scheduled.status in ('planned', 'in_progress')
    ) then return 0; end if;
    select coalesce(max(scheduled.sequence_number), 0)
    into sequence_value
    from public.scheduled_workouts scheduled
    where scheduled.program_version_id = target_program_version_id;
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
declare target_version_id uuid;
begin
  select week.program_version_id into target_version_id
  from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where section.id = target_section_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  if trim(coalesce(target_title, '')) = '' then raise exception 'Section name is required'; end if;
  if target_kind not in ('warmup','main','conditioning','cooldown','custom') then raise exception 'Invalid section type'; end if;
  update public.workout_sections
  set title = trim(target_title), section_kind = target_kind
  where id = target_section_id;
  return target_section_id;
end;
$$;

create or replace function public.reorder_workout_sections(
  target_workout_id uuid,
  ordered_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  expected_ids uuid[];
  supplied_ids uuid[];
  section_id uuid;
  section_position integer := 0;
begin
  select week.program_version_id into target_version_id
  from public.workouts workout
  join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = target_workout_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  select array_agg(section.id order by section.id) into expected_ids
  from public.workout_sections section where section.workout_id = target_workout_id;
  select array_agg(value order by value) into supplied_ids from unnest(ordered_ids) value;
  if expected_ids is distinct from supplied_ids then
    raise exception 'Section order must contain every section exactly once';
  end if;
  update public.workout_sections set position = position + 1000 where workout_id = target_workout_id;
  foreach section_id in array ordered_ids loop
    update public.workout_sections set position = section_position where id = section_id;
    section_position := section_position + 1;
  end loop;
  return target_workout_id;
end;
$$;

revoke all on function public.prepare_program_schedule(uuid) from public;
revoke all on function public.update_workout_section(uuid, text, text) from public;
revoke all on function public.reorder_workout_sections(uuid, uuid[]) from public;
grant execute on function public.prepare_program_schedule(uuid) to authenticated;
grant execute on function public.update_workout_section(uuid, text, text) to authenticated;
grant execute on function public.reorder_workout_sections(uuid, uuid[]) to authenticated;
