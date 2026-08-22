-- Separate a program's catalog/source identity from whether the athlete wants it
-- offered in the calendar, and provide transactional builder operations.

alter table public.programs add constraint programs_id_athlete_unique unique (id, athlete_id);

create table public.program_availability (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  program_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (athlete_id, program_id),
  constraint program_availability_program_owner_fk foreign key (program_id, athlete_id)
    references public.programs(id, athlete_id) on delete cascade
);

alter table public.program_availability enable row level security;
create policy program_availability_read_authorized on public.program_availability for select to authenticated
using (athlete_id = (select auth.uid()) or public.is_active_coach(athlete_id));
revoke insert, update, delete on public.program_availability from authenticated;

insert into public.program_availability (athlete_id, program_id)
select program.athlete_id, program.id from public.programs program
where program.is_current and program.archived_at is null
  and exists (select 1 from public.program_versions version where version.program_id = program.id and version.status = 'published')
on conflict do nothing;

create or replace function public.can_edit_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.programs program
    where program.id = target_program_id
      and program.archived_at is null
      and program.created_by_id = (select auth.uid())
      and (
        (program.source_type = 'self' and program.athlete_id = (select auth.uid()))
        or (program.source_type = 'coach' and public.is_active_coach(program.athlete_id))
      )
  );
$$;

drop policy if exists programs_update_authorized on public.programs;
create policy programs_update_authorized on public.programs for update to authenticated
using (public.can_edit_program(id)) with check (public.can_edit_program(id));

create or replace function public.set_program_availability(target_program_id uuid, make_available boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  published_version_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.programs program
    where program.id = target_program_id and program.athlete_id = current_user_id and program.archived_at is null
  ) then raise exception 'Program not found'; end if;

  if make_available then
    select version.id into published_version_id from public.program_versions version
    where version.program_id = target_program_id and version.status = 'published'
    order by version.version_number desc limit 1;
    if published_version_id is null then raise exception 'Finish editing this program before making it available'; end if;
    insert into public.program_availability (athlete_id, program_id)
    values (current_user_id, target_program_id) on conflict do nothing;
    delete from public.scheduled_workouts scheduled
    using public.program_versions version
    where version.id = scheduled.program_version_id and version.program_id = target_program_id
      and scheduled.program_version_id <> published_version_id
      and scheduled.status = 'planned' and scheduled.planned_date is null
      and not exists (select 1 from public.workout_sessions session where session.scheduled_workout_id = scheduled.id);
    perform public.prepare_program_schedule(published_version_id);
  else
    delete from public.program_availability where athlete_id = current_user_id and program_id = target_program_id;
    delete from public.scheduled_workouts scheduled
    using public.program_versions version
    where version.id = scheduled.program_version_id and version.program_id = target_program_id
      and scheduled.status = 'planned' and scheduled.planned_date is null
      and not exists (select 1 from public.workout_sessions session where session.scheduled_workout_id = scheduled.id);
  end if;
  return make_available;
end;
$$;

create or replace function public.copy_program_to_own(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_program public.programs%rowtype;
  source_version_id uuid;
  new_program_id uuid;
  new_version_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into source_program from public.programs program
  where program.id = target_program_id and public.can_read_program(program.id) and program.archived_at is null;
  if source_program.id is null then raise exception 'Program not found'; end if;
  select version.id into source_version_id from public.program_versions version
  where version.program_id = target_program_id
  order by case version.status when 'published' then 0 when 'superseded' then 1 else 2 end, version.version_number desc limit 1;
  if source_version_id is null then raise exception 'Program content not found'; end if;

  insert into public.programs (athlete_id, created_by_id, title, description, planning_mode, is_current, source_type, source_label)
  values (current_user_id, current_user_id, source_program.title, source_program.description,
    source_program.planning_mode, true, 'self', 'Copied by you') returning id into new_program_id;
  insert into public.program_versions (program_id, authored_by_id, based_on_version_id, version_number, status)
  values (new_program_id, current_user_id, source_version_id, 1, 'draft') returning id into new_version_id;
  perform private.clone_program_version_tree(source_version_id, new_version_id);
  return new_program_id;
end;
$$;

create or replace function public.add_program_week(target_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  program_mode text;
  phase_id uuid;
  next_index integer;
  new_week_id uuid;
begin
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  select program.planning_mode into program_mode from public.program_versions version
  join public.programs program on program.id = version.program_id where version.id = target_version_id;
  if program_mode <> 'fixed_weeks' then raise exception 'Repeating programs use one repeating week'; end if;
  select coalesce(max(week.week_index), 0) + 1 into next_index from public.program_weeks week where week.program_version_id = target_version_id;
  select phase.id into phase_id from public.program_phases phase where phase.program_version_id = target_version_id order by phase.position limit 1;
  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (target_version_id, phase_id, next_index, 'Week ' || next_index) returning id into new_week_id;
  return new_week_id;
end;
$$;

create or replace function public.delete_program_week(target_week_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_version_id uuid; removed_index integer;
begin
  select week.program_version_id, week.week_index into target_version_id, removed_index
  from public.program_weeks week where week.id = target_week_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  if (select count(*) from public.program_weeks week where week.program_version_id = target_version_id) <= 1 then
    raise exception 'A program needs at least one week';
  end if;
  delete from public.program_weeks where id = target_week_id;
  update public.program_weeks set week_index = week_index + 1000
  where program_version_id = target_version_id and week_index > removed_index;
  update public.program_weeks set week_index = week_index - 1001,
    label = 'Week ' || (week_index - 1001)
  where program_version_id = target_version_id and week_index > 1000 + removed_index;
  return target_version_id;
end;
$$;

create or replace function public.delete_program_workout(target_workout_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_week_id uuid; removed_position integer; target_version_id uuid;
begin
  select workout.program_week_id, workout.position, week.program_version_id
  into target_week_id, removed_position, target_version_id
  from public.workouts workout join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = target_workout_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  delete from public.workouts where id = target_workout_id;
  update public.workouts set position = position + 1000 where program_week_id = target_week_id and position > removed_position;
  update public.workouts set position = position - 1001 where program_week_id = target_week_id and position > 1000 + removed_position;
  return target_week_id;
end;
$$;

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
  select coalesce(max(section.position), -1) + 1 into next_position from public.workout_sections section where section.workout_id = target_workout_id;
  insert into public.workout_sections (workout_id, title, section_kind, position)
  values (target_workout_id, trim(target_title), target_kind, next_position) returning id into new_section_id;
  return new_section_id;
end;
$$;

create or replace function public.delete_workout_section(target_section_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_workout_id uuid; removed_position integer; target_version_id uuid;
begin
  select section.workout_id, section.position, week.program_version_id
  into target_workout_id, removed_position, target_version_id
  from public.workout_sections section join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id where section.id = target_section_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  if (select count(*) from public.workout_sections section where section.workout_id = target_workout_id) <= 1 then
    raise exception 'A workout needs at least one section';
  end if;
  delete from public.workout_sections where id = target_section_id;
  update public.workout_sections set position = position + 1000 where workout_id = target_workout_id and position > removed_position;
  update public.workout_sections set position = position - 1001 where workout_id = target_workout_id and position > 1000 + removed_position;
  return target_workout_id;
end;
$$;

create or replace function public.reorder_week_workouts(target_week_id uuid, ordered_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_version_id uuid; expected_ids uuid[]; supplied_ids uuid[]; item_id uuid; item_position integer := 0;
begin
  select week.program_version_id into target_version_id from public.program_weeks week where week.id = target_week_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  select array_agg(workout.id order by workout.id) into expected_ids from public.workouts workout where workout.program_week_id = target_week_id;
  select array_agg(value order by value) into supplied_ids from unnest(ordered_ids) value;
  if expected_ids is distinct from supplied_ids then raise exception 'Workout order must contain every workout exactly once'; end if;
  update public.workouts set position = position + 1000 where program_week_id = target_week_id;
  foreach item_id in array ordered_ids loop
    update public.workouts set position = item_position where id = item_id; item_position := item_position + 1;
  end loop;
  return target_week_id;
end;
$$;

create or replace function public.reorder_section_items(target_section_id uuid, ordered_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_version_id uuid; expected_ids uuid[]; supplied_ids uuid[]; item_id uuid; item_position integer := 0;
begin
  select week.program_version_id into target_version_id from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id join public.program_weeks week on week.id = workout.program_week_id
  where section.id = target_section_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  select array_agg(item.id order by item.id) into expected_ids from public.workout_items item where item.section_id = target_section_id;
  select array_agg(value order by value) into supplied_ids from unnest(ordered_ids) value;
  if expected_ids is distinct from supplied_ids then raise exception 'Exercise order must contain every item exactly once'; end if;
  update public.workout_items set position = position + 1000 where section_id = target_section_id;
  foreach item_id in array ordered_ids loop
    update public.workout_items set position = item_position where id = item_id; item_position := item_position + 1;
  end loop;
  return target_section_id;
end;
$$;

revoke all on function public.set_program_availability(uuid, boolean) from public;
revoke all on function public.copy_program_to_own(uuid) from public;
revoke all on function public.add_program_week(uuid) from public;
revoke all on function public.delete_program_week(uuid) from public;
revoke all on function public.delete_program_workout(uuid) from public;
revoke all on function public.add_workout_section(uuid, text, text) from public;
revoke all on function public.delete_workout_section(uuid) from public;
revoke all on function public.reorder_week_workouts(uuid, uuid[]) from public;
revoke all on function public.reorder_section_items(uuid, uuid[]) from public;
grant execute on function public.set_program_availability(uuid, boolean) to authenticated;
grant execute on function public.copy_program_to_own(uuid) to authenticated;
grant execute on function public.add_program_week(uuid) to authenticated;
grant execute on function public.delete_program_week(uuid) to authenticated;
grant execute on function public.delete_program_workout(uuid) to authenticated;
grant execute on function public.add_workout_section(uuid, text, text) to authenticated;
grant execute on function public.delete_workout_section(uuid) to authenticated;
grant execute on function public.reorder_week_workouts(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_section_items(uuid, uuid[]) to authenticated;
