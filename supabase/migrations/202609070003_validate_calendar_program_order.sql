-- Calendar and the run wizard must enforce the same program order under the
-- same run lock. Keep the existing single-workout removal lifecycle intact.
create or replace function public.schedule_workout(
  target_scheduled_workout_id uuid,
  target_planned_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  occurrence public.scheduled_workouts%rowtype;
  updated_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  -- Read immutable lineage first; the shared run writer takes the run lock
  -- before the occurrence lock and rechecks that the occurrence is still future.
  select candidate.* into occurrence
  from public.scheduled_workouts candidate
  where candidate.id = target_scheduled_workout_id
    and candidate.athlete_id = current_user_id and candidate.status = 'planned';
  if not found then raise exception 'This workout cannot be scheduled'; end if;

  if occurrence.program_run_id is not null then
    perform run.id from public.program_runs run
    where run.id = occurrence.program_run_id for update;
    perform candidate.id from public.scheduled_workouts candidate
    where candidate.id = occurrence.id and candidate.status = 'planned'
    for update;
    if not found then raise exception 'This workout cannot be scheduled'; end if;
    perform public.schedule_program_run_workouts(
      occurrence.program_run_id,
      jsonb_build_array(jsonb_build_object(
        'workoutId', occurrence.workout_id, 'plannedDate', target_planned_date
      )), gen_random_uuid()
    );
    updated_id := occurrence.id;
  else
    update public.scheduled_workouts set planned_date = target_planned_date
    where id = occurrence.id and athlete_id = current_user_id and status = 'planned'
    returning id into updated_id;
    if updated_id is null then raise exception 'This workout cannot be scheduled'; end if;
  end if;

  if target_planned_date is null and occurrence.program_run_id is not null and exists (
    select 1 from public.program_runs run
    where run.id = occurrence.program_run_id
      and run.athlete_id = current_user_id and run.created_by_id = current_user_id
      and run.status = 'not_started'
      and (select count(*) from public.program_run_workouts slot
           where slot.program_run_id = run.id) = 1
      and not exists (select 1 from public.workout_sessions session where session.program_run_id = run.id)
  ) then
    update public.program_run_workouts set status = 'cancelled'
    where program_run_id = occurrence.program_run_id and status = 'unscheduled';
    update public.program_runs
    set status = 'ended', ended_at = now(), ended_by_id = current_user_id, completed_at = null
    where id = occurrence.program_run_id and status = 'not_started';
  end if;
  return updated_id;
end;
$$;

revoke all on function public.schedule_workout(uuid, date) from public, anon;
grant execute on function public.schedule_workout(uuid, date) to authenticated;
