-- Athletes can defer an in-progress workout back to planned, or skip a dated
-- occurrence while retaining the calendar/history record of that decision.

create or replace function public.set_scheduled_workout_status(
  target_scheduled_workout_id uuid,
  target_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_status text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_status not in ('planned', 'skipped') then
    raise exception 'Workout status must be planned or skipped';
  end if;

  select status into current_status
  from public.scheduled_workouts
  where id = target_scheduled_workout_id
    and athlete_id = current_user_id
  for update;
  if current_status is null then raise exception 'Scheduled workout not found'; end if;
  if current_status = 'completed' then
    raise exception 'Completed workouts cannot be changed';
  end if;

  -- Resetting or skipping an active session preserves its draft as abandoned,
  -- allowing the same scheduled workout to be started afresh if restored.
  update public.workout_sessions
  set status = 'abandoned'
  where scheduled_workout_id = target_scheduled_workout_id
    and athlete_id = current_user_id
    and status = 'in_progress';

  update public.scheduled_workouts
  set status = target_status
  where id = target_scheduled_workout_id
    and athlete_id = current_user_id;
end;
$$;

revoke all on function public.set_scheduled_workout_status(uuid, text) from public;
grant execute on function public.set_scheduled_workout_status(uuid, text) to authenticated;
