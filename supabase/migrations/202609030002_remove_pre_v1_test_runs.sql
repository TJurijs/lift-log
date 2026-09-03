-- One-time cleanup of the twelve legacy test runs confirmed by the sole
-- pre-launch user. Keep the current Balanced Weightlifting run and reusable
-- library content; remove only the ended run aggregates and their history.
create temporary table cleanup_pre_v1_run_ids (
  id uuid primary key
) on commit drop;

create temporary table cleanup_pre_v1_schedule_ids (
  id uuid primary key
) on commit drop;

do $$
declare
  target_athlete_id uuid;
  target_count integer;
  keep_run_id constant uuid := '8accbc47-02c4-42f6-b407-b56249057c8b';
begin
  select user_row.id
  into target_athlete_id
  from auth.users user_row
  where lower(user_row.email) = 'toyurit@gmail.com';

  -- Fresh/local installations do not contain this hosted-development user.
  if target_athlete_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.program_runs run
    where run.id = keep_run_id
      and run.athlete_id = target_athlete_id
      and run.status = 'in_progress'
  ) then
    raise exception 'Expected current Balanced Weightlifting run was not found';
  end if;

  insert into cleanup_pre_v1_run_ids (id)
  select run.id
  from public.program_runs run
  where run.athlete_id = target_athlete_id
    and run.id <> keep_run_id
    and run.status = 'ended';

  select count(*) into target_count from cleanup_pre_v1_run_ids;
  if target_count <> 12 then
    raise exception 'Expected exactly 12 confirmed test runs, found %', target_count;
  end if;

  insert into cleanup_pre_v1_schedule_ids (id)
  select occurrence.id
  from public.scheduled_workouts occurrence
  where occurrence.program_run_id in (
    select target.id from cleanup_pre_v1_run_ids target
  );
end;
$$;

-- Completed sessions are normally immutable. This tightly scoped migration is
-- the explicit, auditable exception requested for confirmed test data.
alter table public.workout_sessions
  disable trigger protect_workout_session_history;
alter table public.session_item_logs
  disable trigger guard_session_item_history;
alter table public.session_entries
  disable trigger guard_session_entry_history;
alter table public.program_run_workouts
  disable trigger validate_program_run_workout;

delete from public.workout_sessions session
where session.program_run_id in (
    select target.id from cleanup_pre_v1_run_ids target
  )
  or session.scheduled_workout_id in (
    select target.id from cleanup_pre_v1_schedule_ids target
  );

update public.program_run_workouts slot
set scheduled_workout_id = null
where slot.program_run_id in (
  select target.id from cleanup_pre_v1_run_ids target
);

delete from public.scheduled_workouts occurrence
where occurrence.id in (
  select target.id from cleanup_pre_v1_schedule_ids target
);

delete from public.program_run_workouts slot
where slot.program_run_id in (
  select target.id from cleanup_pre_v1_run_ids target
);

delete from public.program_runs run
where run.id in (
  select target.id from cleanup_pre_v1_run_ids target
);

alter table public.program_run_workouts
  enable trigger validate_program_run_workout;
alter table public.session_entries
  enable trigger guard_session_entry_history;
alter table public.session_item_logs
  enable trigger guard_session_item_history;
alter table public.workout_sessions
  enable trigger protect_workout_session_history;
