-- One-time removal of the pre-launch program-builder test content confirmed by
-- the sole user. Preserve exactly the three programs visible in their library.
create temporary table cleanup_pre_v1_program_ids (
  id uuid primary key
) on commit drop;

create temporary table cleanup_pre_v1_version_ids (
  id uuid primary key
) on commit drop;

do $$
declare
  target_athlete_id uuid;
  target_count integer;
  linked_count integer;
begin
  select user_row.id
  into target_athlete_id
  from auth.users user_row
  where lower(user_row.email) = 'toyurit@gmail.com';

  -- Fresh/local installations do not contain this hosted-development user.
  if target_athlete_id is null then
    return;
  end if;

  if (
    select count(*)
    from public.programs program
    where program.athlete_id = target_athlete_id
      and program.id in (
        'db92f491-aeeb-4835-9432-51066b1e3b3d',
        '00c3e9cc-425d-4cde-a106-25d1521af226',
        'feea90de-9f4c-4171-bd61-af3844676f7d'
      )
  ) <> 3 then
    raise exception 'Expected the three retained library programs were not found';
  end if;

  insert into cleanup_pre_v1_program_ids (id)
  select program.id
  from public.programs program
  where program.athlete_id = target_athlete_id
    and program.id not in (
      'db92f491-aeeb-4835-9432-51066b1e3b3d',
      '00c3e9cc-425d-4cde-a106-25d1521af226',
      'feea90de-9f4c-4171-bd61-af3844676f7d'
    );

  select count(*) into target_count from cleanup_pre_v1_program_ids;
  if target_count <> 23 then
    raise exception 'Expected exactly 23 confirmed test programs, found %', target_count;
  end if;

  insert into cleanup_pre_v1_version_ids (id)
  select version.id
  from public.program_versions version
  where version.program_id in (
    select target.id from cleanup_pre_v1_program_ids target
  );

  select count(*) into linked_count
  from public.program_runs run
  where run.source_program_id in (
      select target.id from cleanup_pre_v1_program_ids target
    )
    or run.program_version_id in (
      select target.id from cleanup_pre_v1_version_ids target
    );
  if linked_count <> 0 then
    raise exception 'Test programs still have % linked program runs', linked_count;
  end if;

  if exists (
    select 1
    from public.program_assignments assignment
    where (
        assignment.source_program_id in (
          select target.id from cleanup_pre_v1_program_ids target
        )
        or assignment.customized_program_id in (
          select target.id from cleanup_pre_v1_program_ids target
        )
        or assignment.source_version_id in (
          select target.id from cleanup_pre_v1_version_ids target
        )
      )
      and assignment.status <> 'archived'
  ) then
    raise exception 'Test programs still have a non-archived assignment';
  end if;

  if exists (
    select 1 from public.scheduled_workouts occurrence
    where occurrence.program_version_id in (
      select target.id from cleanup_pre_v1_version_ids target
    )
  ) or exists (
    select 1 from public.workout_sessions session
    where session.program_version_id in (
      select target.id from cleanup_pre_v1_version_ids target
    )
  ) then
    raise exception 'Test programs still have schedule or session history';
  end if;

  -- One archived Full-body workout test assignment produced an empty private
  -- copy for Elina. It has no schedule or result and is part of this confirmed
  -- pre-launch cleanup, but no other athlete-owned content is in scope.
  if not exists (
    select 1
    from public.program_assignments assignment
    join public.program_runs run
      on run.legacy_assignment_id = assignment.id
    where assignment.id = '62c91f43-8449-4656-a3a0-519607507abc'
      and assignment.status = 'archived'
      and assignment.source_program_id = '96febc0b-bb4c-48c5-a4cf-2ec42d564ac4'
      and assignment.customized_program_id = 'fafa4371-e80f-4cc5-8213-a5e15f185470'
      and run.id = 'fcfa7091-abfb-4c36-a57e-e7e891590f04'
      and run.status = 'ended'
      and run.source_program_id = assignment.customized_program_id
  ) then
    raise exception 'Expected empty Full-body workout test assignment was not found';
  end if;

  if exists (
    select 1 from public.scheduled_workouts occurrence
    where occurrence.program_run_id = 'fcfa7091-abfb-4c36-a57e-e7e891590f04'
  ) or exists (
    select 1 from public.workout_sessions session
    where session.program_run_id = 'fcfa7091-abfb-4c36-a57e-e7e891590f04'
  ) or (
    select count(*)
    from public.program_run_workouts slot
    where slot.program_run_id = 'fcfa7091-abfb-4c36-a57e-e7e891590f04'
      and slot.status = 'unscheduled'
      and slot.scheduled_workout_id is null
  ) <> 1 then
    raise exception 'Full-body workout test assignment is no longer empty';
  end if;
end;
$$;

-- Published exercise prescriptions are immutable during normal operation.
-- Temporarily suspend only their draft-tree guards for this confirmed,
-- fail-closed hard deletion; the whole migration remains transactional.
alter table public.program_phases disable trigger guard_program_phases_draft;
alter table public.program_weeks disable trigger guard_program_weeks_draft;
alter table public.workouts disable trigger guard_workouts_draft;
alter table public.workout_sections disable trigger guard_workout_sections_draft;
alter table public.workout_items disable trigger guard_workout_items_draft;
alter table public.prescribed_entries disable trigger guard_prescribed_entries_draft;

delete from public.program_run_workouts slot
where slot.program_run_id = 'fcfa7091-abfb-4c36-a57e-e7e891590f04';

delete from public.program_runs run
where run.id = 'fcfa7091-abfb-4c36-a57e-e7e891590f04';

delete from public.program_assignments assignment
where assignment.source_program_id in (
    select target.id from cleanup_pre_v1_program_ids target
  )
  or assignment.customized_program_id in (
    select target.id from cleanup_pre_v1_program_ids target
  )
  or assignment.source_version_id in (
    select target.id from cleanup_pre_v1_version_ids target
  );

delete from public.programs program
where program.id = 'fafa4371-e80f-4cc5-8213-a5e15f185470';

delete from public.programs program
where program.id in (
  select target.id from cleanup_pre_v1_program_ids target
);

alter table public.prescribed_entries enable trigger guard_prescribed_entries_draft;
alter table public.workout_items enable trigger guard_workout_items_draft;
alter table public.workout_sections enable trigger guard_workout_sections_draft;
alter table public.workouts enable trigger guard_workouts_draft;
alter table public.program_weeks enable trigger guard_program_weeks_draft;
alter table public.program_phases enable trigger guard_program_phases_draft;
