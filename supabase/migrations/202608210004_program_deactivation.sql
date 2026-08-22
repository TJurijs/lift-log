-- Athletes can stop using a current program without deleting its history.
-- Future, not-yet-started occurrences are removed so they cannot leak into the
-- calendar or scheduling picker after another program is selected.

create or replace function public.deactivate_current_program(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_athlete_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select program.athlete_id into target_athlete_id
  from public.programs program
  where program.id = target_program_id
    and program.is_current
    and program.archived_at is null
  for update;

  if target_athlete_id is null then raise exception 'Current program not found'; end if;
  if target_athlete_id <> current_user_id then
    raise exception 'Only the athlete can deactivate their current program';
  end if;
  if exists (
    select 1
    from public.workout_sessions session
    join public.program_versions version on version.id = session.program_version_id
    where version.program_id = target_program_id and session.status = 'in_progress'
  ) then raise exception 'Finish or abandon the active workout before changing programs'; end if;

  delete from public.scheduled_workouts scheduled
  using public.program_versions version
  where version.id = scheduled.program_version_id
    and version.program_id = target_program_id
    and scheduled.status = 'planned'
    and not exists (
      select 1 from public.workout_sessions session
      where session.scheduled_workout_id = scheduled.id
    );

  update public.programs
  set is_current = false, archived_at = now()
  where id = target_program_id;

  return target_program_id;
end;
$$;

revoke all on function public.deactivate_current_program(uuid) from public;
grant execute on function public.deactivate_current_program(uuid) to authenticated;
