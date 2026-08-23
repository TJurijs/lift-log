-- Quick workouts are deliberately stored in the proven program/workout tree so
-- their editor, snapshots, scheduling, and session history stay identical.
-- The content type only changes the product workflow: one standalone session
-- instead of a planned sequence of weeks.

alter table public.programs
  add column if not exists content_type text not null default 'program'
  check (content_type in ('program', 'quick_workout'));

create or replace function private.copy_assigned_program_content_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_from_program_id is not null then
    select source.content_type into new.content_type
    from public.programs source
    where source.id = new.assigned_from_program_id;
  end if;
  return new;
end;
$$;

drop trigger if exists copy_assigned_program_content_type on public.programs;
create trigger copy_assigned_program_content_type
before insert on public.programs
for each row execute function private.copy_assigned_program_content_type();

create or replace function public.create_blank_quick_workout(target_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  workout_program_id uuid;
  version_id uuid;
  phase_id uuid;
  week_id uuid;
  workout_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(target_title, ''))) not between 1 and 120 then
    raise exception 'Workout name must be between 1 and 120 characters';
  end if;

  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label, content_type
  ) values (
    current_user_id, current_user_id, trim(target_title), '', 'fixed_weeks', true,
    'self', 'Created by you', 'quick_workout'
  ) returning id into workout_program_id;

  insert into public.program_versions (program_id, authored_by_id, version_number, status)
  values (workout_program_id, current_user_id, 1, 'draft') returning id into version_id;
  insert into public.program_phases (program_version_id, name, position)
  values (version_id, 'Workout', 0) returning id into phase_id;
  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (version_id, phase_id, 1, 'Workout') returning id into week_id;
  insert into public.workouts (program_week_id, title, schedule_label, position, estimated_minutes)
  values (week_id, trim(target_title), 'Workout', 0, 45) returning id into workout_id;
  insert into public.workout_sections (workout_id, title, section_kind, position)
  values
    (workout_id, 'Warm up', 'warmup', 0),
    (workout_id, 'Main work', 'main', 1),
    (workout_id, 'Cooldown', 'cooldown', 2);

  return workout_program_id;
end;
$$;

revoke all on function public.create_blank_quick_workout(text) from public;
grant execute on function public.create_blank_quick_workout(text) to authenticated;

-- Coaches can place a one-off workout straight onto an athlete's calendar.
-- All writes remain in a security-definer RPC; direct table writes stay revoked.
alter table public.scheduled_workouts
  drop constraint if exists scheduled_workouts_athlete_schedules_self;

create or replace function public.assign_quick_workout_to_athletes(
  target_program_id uuid,
  target_athlete_ids uuid[],
  target_planned_date date
)
returns table (
  athlete_id uuid,
  assigned_program_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  assignment_row record;
  assigned_version_id uuid;
  assigned_workout_id uuid;
  next_sequence integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_planned_date is null then raise exception 'Choose a calendar date'; end if;
  if not exists (
    select 1 from public.programs program
    where program.id = target_program_id
      and program.athlete_id = current_user_id
      and program.created_by_id = current_user_id
      and program.source_type = 'self'
      and program.content_type = 'quick_workout'
      and program.is_current
      and program.archived_at is null
  ) then
    raise exception 'Only one of your published quick workouts can be assigned';
  end if;

  for assignment_row in
    select * from public.assign_own_program_to_athletes(
      target_program_id,
      target_athlete_ids
    )
  loop
    select version.id into assigned_version_id
    from public.program_versions version
    where version.program_id = assignment_row.assigned_program_id
      and version.status = 'published'
    order by version.version_number desc
    limit 1;

    select workout.id into assigned_workout_id
    from public.program_weeks week
    join public.workouts workout on workout.program_week_id = week.id
    where week.program_version_id = assigned_version_id
    order by week.week_index, workout.position
    limit 1;
    if assigned_workout_id is null then
      raise exception 'The assigned workout is missing its session';
    end if;

    select coalesce(max(scheduled.sequence_number), 0) + 1 into next_sequence
    from public.scheduled_workouts scheduled
    where scheduled.program_version_id = assigned_version_id
      and scheduled.workout_id = assigned_workout_id;

    insert into public.scheduled_workouts (
      athlete_id, scheduled_by_id, program_version_id, workout_id,
      planned_date, sequence_number, status
    ) values (
      assignment_row.athlete_id, current_user_id, assigned_version_id,
      assigned_workout_id, target_planned_date, next_sequence, 'planned'
    );

    athlete_id := assignment_row.athlete_id;
    assigned_program_id := assignment_row.assigned_program_id;
    created := assignment_row.created;
    return next;
  end loop;
end;
$$;

revoke all on function public.assign_quick_workout_to_athletes(uuid, uuid[], date) from public;
grant execute on function public.assign_quick_workout_to_athletes(uuid, uuid[], date) to authenticated;
