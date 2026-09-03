-- Removing the only untouched occurrence of a self-created quick workout
-- should restore the reusable template to its original Ready to use state.
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
  updated_id uuid;
  linked_run_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  update public.scheduled_workouts
  set planned_date = target_planned_date
  where id = target_scheduled_workout_id
    and athlete_id = current_user_id
    and status = 'planned'
  returning id, program_run_id into updated_id, linked_run_id;

  if updated_id is null then raise exception 'This workout cannot be scheduled'; end if;

  if target_planned_date is null and linked_run_id is not null and exists (
    select 1
    from public.program_runs run
    where run.id = linked_run_id
      and run.athlete_id = current_user_id
      and run.created_by_id = current_user_id
      and run.status = 'not_started'
      and (select count(*) from public.program_run_workouts slot
           where slot.program_run_id = run.id) = 1
      and not exists (
        select 1 from public.workout_sessions session
        where session.program_run_id = run.id
      )
  ) then
    update public.program_run_workouts
    set status = 'cancelled'
    where program_run_id = linked_run_id
      and status = 'unscheduled';

    update public.program_runs
    set status = 'ended', ended_at = now(), ended_by_id = current_user_id,
        completed_at = null
    where id = linked_run_id and status = 'not_started';
  end if;

  return updated_id;
end;
$$;

revoke all on function public.schedule_workout(uuid, date) from public, anon;
grant execute on function public.schedule_workout(uuid, date) to authenticated;

-- Reconcile empty single-workout runs left behind by the previous behavior.
with empty_runs as (
  select run.id
  from public.program_runs run
  join public.program_run_workouts slot on slot.program_run_id = run.id
  where run.status = 'not_started'
    and run.athlete_id = run.created_by_id
    and slot.status = 'unscheduled'
    and slot.planned_date is null
    and not exists (
      select 1 from public.workout_sessions session
      where session.program_run_id = run.id
    )
  group by run.id
  having count(*) = 1
)
update public.program_run_workouts slot
set status = 'cancelled'
from empty_runs
where slot.program_run_id = empty_runs.id;

update public.program_runs run
set status = 'ended', ended_at = now(), ended_by_id = run.athlete_id,
    completed_at = null
where run.status = 'not_started'
  and run.athlete_id = run.created_by_id
  and exists (
    select 1
    from public.program_run_workouts slot
    where slot.program_run_id = run.id
    group by slot.program_run_id
    having count(*) = 1 and bool_and(slot.status = 'cancelled')
  )
  and not exists (
    select 1 from public.workout_sessions session
    where session.program_run_id = run.id
  );
