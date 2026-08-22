-- Removing an Own program is an archive operation. Its immutable program tree
-- and any workout history remain available to historical records, while
-- future, unstarted calendar occurrences are removed.

drop policy if exists programs_delete_owner on public.programs;
revoke delete on public.programs from authenticated;

create or replace function public.delete_own_program(target_program_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  deletable_program_id uuid;
  removed_planned_count integer := 0;
  retained_schedule_count integer := 0;
  retained_session_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Requiring both ownership columns and self provenance prevents an athlete
  -- from removing a coach-authored or library program through this operation.
  select program.id
  into deletable_program_id
  from public.programs program
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and program.created_by_id = current_user_id
    and program.source_type = 'self'
    and program.archived_at is null
  for update;

  if deletable_program_id is null then
    raise exception 'Own program not found or cannot be deleted';
  end if;

  if exists (
    select 1
    from public.scheduled_workouts scheduled
    join public.program_versions version on version.id = scheduled.program_version_id
    where version.program_id = target_program_id
      and scheduled.status = 'in_progress'
  ) or exists (
    select 1
    from public.workout_sessions session
    join public.program_versions version on version.id = session.program_version_id
    where version.program_id = target_program_id
      and session.status = 'in_progress'
  ) then
    raise exception 'Finish or abandon the active workout before deleting this program';
  end if;

  -- Archive instead of cascading through published content. This preserves
  -- completed/skipped history and version provenance used by copied programs.
  update public.programs
  set archived_at = now(), is_current = false
  where id = target_program_id;

  delete from public.program_availability
  where athlete_id = current_user_id
    and program_id = target_program_id;

  delete from public.scheduled_workouts scheduled
  using public.program_versions version
  where version.id = scheduled.program_version_id
    and version.program_id = target_program_id
    and scheduled.status = 'planned'
    and not exists (
      select 1
      from public.workout_sessions session
      where session.scheduled_workout_id = scheduled.id
    );
  get diagnostics removed_planned_count = row_count;

  select count(*)::integer
  into retained_schedule_count
  from public.scheduled_workouts scheduled
  join public.program_versions version on version.id = scheduled.program_version_id
  where version.program_id = target_program_id;

  select count(*)::integer
  into retained_session_count
  from public.workout_sessions session
  join public.program_versions version on version.id = session.program_version_id
  where version.program_id = target_program_id;

  return jsonb_build_object(
    'programId', target_program_id,
    'removedPlannedWorkouts', removed_planned_count,
    'retainedScheduledHistory', retained_schedule_count,
    'retainedSessions', retained_session_count
  );
end;
$$;

revoke all on function public.delete_own_program(uuid) from public;
grant execute on function public.delete_own_program(uuid) to authenticated;
