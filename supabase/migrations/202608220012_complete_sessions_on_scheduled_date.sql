-- Training may be logged ahead of time. Calendar/history placement follows the
-- date the athlete selected for that occurrence, not the wall-clock finish.

alter table public.workout_sessions
  add column if not exists completed_for_date date;

-- Completed rows are immutable. Older history continues to fall back to its
-- recorded start date; only newly completed sessions need this explicit date.

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
  scheduled_date date;
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

  if scheduled_id is not null then
    select planned_date into scheduled_date
    from public.scheduled_workouts
    where id = scheduled_id and athlete_id = current_user_id;
  end if;

  update public.workout_sessions
  set
    status = 'completed',
    completed_at = now(),
    completed_for_date = coalesce(scheduled_date, current_date),
    session_rpe = final_rpe,
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

revoke all on function public.complete_workout_session(uuid, numeric, text) from public;
grant execute on function public.complete_workout_session(uuid, numeric, text) to authenticated;
