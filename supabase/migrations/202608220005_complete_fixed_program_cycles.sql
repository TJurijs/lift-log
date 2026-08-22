-- A fixed program leaves the scheduling collection when its final outstanding
-- occurrence is finished. Adding it again explicitly starts a fresh cycle.

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

  select program.athlete_id, program.id
  into target_athlete_id, target_program_id
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

  -- Advance only when the current cycle is structurally complete and terminal.
  -- This preserves a partially scheduled cycle after a manual remove/re-add.
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

create or replace function public.complete_workout_session(
  target_session_id uuid,
  final_rpe numeric,
  final_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  scheduled_id uuid;
  completed_version_id uuid;
  completed_program_id uuid;
  completed_planning_mode text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if final_rpe is not null and (final_rpe < 1 or final_rpe > 10) then
    raise exception 'Session RPE must be between 1 and 10';
  end if;

  select session.scheduled_workout_id into scheduled_id
  from public.workout_sessions session
  where session.id = target_session_id
    and session.athlete_id = current_user_id
    and session.status = 'in_progress'
  for update;
  if not found then raise exception 'In-progress session not found'; end if;

  update public.workout_sessions
  set status = 'completed', completed_at = now(), session_rpe = final_rpe,
      athlete_note = coalesce(final_note, '')
  where id = target_session_id;

  if scheduled_id is not null then
    update public.scheduled_workouts
    set status = 'completed'
    where id = scheduled_id and athlete_id = current_user_id
    returning program_version_id into completed_version_id;

    select program.id, program.planning_mode
    into completed_program_id, completed_planning_mode
    from public.program_versions version
    join public.programs program on program.id = version.program_id
    where version.id = completed_version_id;

    if completed_planning_mode = 'fixed_weeks' and not exists (
      select 1 from public.scheduled_workouts scheduled
      where scheduled.program_version_id = completed_version_id
        and scheduled.athlete_id = current_user_id
        and scheduled.status in ('planned', 'in_progress')
    ) then
      delete from public.program_availability availability
      where availability.athlete_id = current_user_id
        and availability.program_id = completed_program_id;
    end if;
  end if;

  return target_session_id;
end;
$$;

revoke all on function public.prepare_program_schedule(uuid) from public;
revoke all on function public.complete_workout_session(uuid, numeric, text) from public;
grant execute on function public.prepare_program_schedule(uuid) to authenticated;
grant execute on function public.complete_workout_session(uuid, numeric, text) to authenticated;

-- Bring existing fixed programs into the same lifecycle immediately.
delete from public.program_availability availability
using public.programs program
where program.id = availability.program_id
  and program.athlete_id = availability.athlete_id
  and program.planning_mode = 'fixed_weeks'
  and exists (
    select 1
    from public.program_versions version
    where version.id = (
      select latest.id
      from public.program_versions latest
      where latest.program_id = program.id and latest.status = 'published'
      order by latest.version_number desc
      limit 1
    )
      and exists (
        select 1 from public.scheduled_workouts scheduled
        where scheduled.program_version_id = version.id
          and scheduled.athlete_id = availability.athlete_id
      )
      and not exists (
        select 1 from public.scheduled_workouts scheduled
        where scheduled.program_version_id = version.id
          and scheduled.athlete_id = availability.athlete_id
          and scheduled.status in ('planned', 'in_progress')
      )
  );
