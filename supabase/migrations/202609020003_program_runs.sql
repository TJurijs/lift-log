-- A program is reusable authored content. A program run is one athlete doing
-- one immutable revision of that content. Run workout rows materialize the
-- complete ordered plan even when no calendar dates have been chosen yet.
--
-- This migration is additive: legacy assignments, occurrences and completed
-- sessions remain in place and are linked to backfilled runs where possible.

begin;

create table public.program_runs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  created_by_id uuid not null references public.profiles(id) on delete restrict,
  source_program_id uuid not null references public.programs(id) on delete restrict,
  program_version_id uuid not null references public.program_versions(id) on delete restrict,
  legacy_assignment_id uuid unique references public.program_assignments(id) on delete restrict,
  repeated_from_run_id uuid references public.program_runs(id) on delete set null,
  request_key uuid not null,
  creation_schedule jsonb not null default '[]'::jsonb,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'ended')),
  started_at timestamptz,
  completed_at timestamptz,
  ended_at timestamptz,
  ended_by_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_runs_request_unique
    unique (created_by_id, athlete_id, request_key),
  constraint program_runs_schedule_array
    check (jsonb_typeof(creation_schedule) = 'array'),
  constraint program_runs_timeline_check check (
    (status = 'not_started' and started_at is null and completed_at is null and ended_at is null)
    or (status = 'in_progress' and started_at is not null and completed_at is null and ended_at is null)
    or (status = 'completed' and started_at is not null and completed_at is not null and ended_at is null)
    or (status = 'ended' and completed_at is null and ended_at is not null and ended_by_id is not null)
  )
);

create table public.program_run_workouts (
  id uuid primary key default gen_random_uuid(),
  program_run_id uuid not null references public.program_runs(id) on delete restrict,
  workout_id uuid not null references public.workouts(id) on delete restrict,
  position integer not null check (position >= 0),
  planned_date date,
  status text not null default 'unscheduled'
    check (status in (
      'unscheduled', 'scheduled', 'in_progress', 'completed', 'skipped', 'cancelled'
    )),
  scheduled_workout_id uuid unique references public.scheduled_workouts(id) on delete restrict,
  prescription_overrides jsonb not null default '{}'::jsonb,
  override_updated_by_id uuid references public.profiles(id) on delete restrict,
  override_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_run_workouts_position_unique
    unique (program_run_id, position),
  constraint program_run_workouts_overrides_object
    check (jsonb_typeof(prescription_overrides) = 'object'),
  constraint program_run_workouts_override_metadata check (
    (prescription_overrides = '{}'::jsonb
      and override_updated_by_id is null and override_updated_at is null)
    or (prescription_overrides <> '{}'::jsonb
      and override_updated_by_id is not null and override_updated_at is not null)
  )
);

-- Scheduling is a separate mutation from run creation. Keep a durable request
-- receipt so an uncertain network retry cannot silently apply a different set
-- of dates under the same idempotency key.
create table public.program_run_schedule_requests (
  requested_by_id uuid not null references public.profiles(id) on delete restrict,
  request_key uuid not null,
  program_run_id uuid not null references public.program_runs(id) on delete cascade,
  canonical_schedule jsonb not null,
  created_at timestamptz not null default now(),
  primary key (requested_by_id, request_key),
  constraint program_run_schedule_requests_array
    check (jsonb_typeof(canonical_schedule) = 'array')
);

alter table public.scheduled_workouts
  add column program_run_id uuid references public.program_runs(id) on delete restrict,
  add column program_run_workout_id uuid references public.program_run_workouts(id) on delete restrict;

alter table public.workout_sessions
  add column program_run_id uuid references public.program_runs(id) on delete restrict,
  add column program_run_workout_id uuid references public.program_run_workouts(id) on delete restrict;

create unique index idx_scheduled_workouts_program_run_workout
  on public.scheduled_workouts (program_run_workout_id)
  where program_run_workout_id is not null;
create index idx_scheduled_workouts_program_run_status
  on public.scheduled_workouts (program_run_id, status)
  where program_run_id is not null;

create index idx_program_runs_athlete_status_created
  on public.program_runs (athlete_id, status, created_at desc, id desc);
create index idx_program_runs_creator_athlete_created
  on public.program_runs (created_by_id, athlete_id, created_at desc, id desc);
create index idx_program_runs_athlete_summary_page
  on public.program_runs (
    athlete_id,
    created_at desc,
    id desc
  );
create index idx_program_runs_athlete_coach_summary_page
  on public.program_runs (
    athlete_id,
    created_at desc,
    id desc
  )
  where created_by_id <> athlete_id;
create index idx_program_runs_creator_active_athlete
  on public.program_runs (created_by_id, athlete_id)
  where status in ('not_started', 'in_progress');
create index idx_program_runs_creator_request
  on public.program_runs (created_by_id, request_key);
create index idx_program_run_schedule_requests_run
  on public.program_run_schedule_requests (program_run_id);
create index idx_program_runs_source_created
  on public.program_runs (source_program_id, created_at desc, id desc);
create index idx_program_runs_version
  on public.program_runs (program_version_id);
create index idx_program_run_workouts_run_status_position
  on public.program_run_workouts (program_run_id, status, position);
create index idx_program_run_workouts_run_date
  on public.program_run_workouts (program_run_id, planned_date, position)
  where planned_date is not null;
create index idx_workout_sessions_program_run
  on public.workout_sessions (program_run_id, started_at desc, id desc)
  where program_run_id is not null;
create index idx_workout_sessions_run_workout_completed
  on public.workout_sessions (
    program_run_workout_id, completed_at desc, id desc
  )
  where program_run_workout_id is not null and status = 'completed';

create trigger program_runs_set_updated_at
before update on public.program_runs
for each row execute function public.set_updated_at();

create trigger program_run_workouts_set_updated_at
before update on public.program_run_workouts
for each row execute function public.set_updated_at();

alter table public.program_runs enable row level security;
alter table public.program_run_workouts enable row level security;
alter table public.program_run_schedule_requests enable row level security;

create or replace function private.can_read_program_run(target_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.program_runs run
    where run.id = target_run_id
      and (
        run.athlete_id = (select auth.uid())
        or (
          run.created_by_id = (select auth.uid())
          and exists (
            select 1
            from public.coach_relationships relationship
            where relationship.athlete_id = run.athlete_id
              and relationship.coach_id = (select auth.uid())
              and relationship.ended_at is null
          )
        )
      )
  );
$$;

create policy program_runs_read_participant
on public.program_runs for select to authenticated
using (private.can_read_program_run(id));

create policy program_run_workouts_read_participant
on public.program_run_workouts for select to authenticated
using (private.can_read_program_run(program_run_id));

revoke insert, update, delete on public.program_runs
  from public, anon, authenticated;
revoke insert, update, delete on public.program_run_workouts
  from public, anon, authenticated;
revoke all on public.program_run_schedule_requests
  from public, anon, authenticated;

-- Coach assignments already represent one athlete using one immutable version,
-- so each is a natural legacy run, including archived assignments whose result
-- history must remain visible.
insert into public.program_runs (
  athlete_id, created_by_id, source_program_id, program_version_id,
  legacy_assignment_id, request_key, status, started_at, ended_at, ended_by_id,
  created_at, updated_at
)
select
  assignment.athlete_id,
  assignment.assigned_by_id,
  -- `source_program_id` is the container that owns the immutable content.
  -- Legacy customized assignments point at a cloned content version, so using
  -- their earlier template origin here would make a later repeat fail lineage
  -- validation (version.program_id would not match the run source).
  content_version.program_id,
  content_version.id,
  assignment.id,
  coalesce(assignment.assignment_request_key, assignment.id),
  case when assignment.status = 'archived' then 'ended' else 'not_started' end,
  null,
  case when assignment.status = 'archived' then assignment.updated_at else null end,
  case when assignment.status = 'archived' then assignment.athlete_id else null end,
  assignment.assigned_at,
  assignment.updated_at
from public.program_assignments assignment
join public.program_versions content_version
  on content_version.id = private.assignment_content_version(assignment.id)
on conflict (legacy_assignment_id) do nothing;

-- Self scheduling pre-dated runs. Group each athlete/version pair into one
-- conservative legacy run; no occurrence or result identity is rewritten.
insert into public.program_runs (
  athlete_id, created_by_id, source_program_id, program_version_id,
  request_key, status, created_at, updated_at
)
select
  legacy.athlete_id,
  legacy.created_by_id,
  legacy.program_id,
  legacy.program_version_id,
  legacy.request_key,
  'not_started',
  legacy.created_at,
  legacy.created_at
from (
  select
    legacy_use.athlete_id,
    version.program_id,
    version.id as program_version_id,
    coalesce(program.created_by_id, legacy_use.athlete_id) as created_by_id,
    (array_agg(legacy_use.identity_id order by legacy_use.used_at, legacy_use.identity_id))[1]
      as request_key,
    min(legacy_use.used_at) as created_at
  from (
    select occurrence.athlete_id, occurrence.program_version_id,
      occurrence.id as identity_id, occurrence.created_at as used_at
    from public.scheduled_workouts occurrence
    where occurrence.assignment_id is null
    union all
    select session.athlete_id, session.program_version_id,
      session.id, session.created_at
    from public.workout_sessions session
    where session.assignment_id is null
      and session.program_version_id is not null
  ) legacy_use
  join public.program_versions version on version.id = legacy_use.program_version_id
  join public.programs program on program.id = version.program_id
  group by legacy_use.athlete_id, version.program_id, version.id,
    program.created_by_id
) legacy
on conflict (created_by_id, athlete_id, request_key) do nothing;

-- Materialize the canonical workout sequence for every backfilled run. Match
-- at most one existing occurrence to each source workout; any legacy repeats
-- are retained as additional slots immediately afterwards.
insert into public.program_run_workouts (
  program_run_id, workout_id, position, planned_date, status,
  scheduled_workout_id, created_at, updated_at
)
select
  run.id,
  workout.id,
  row_number() over (
    partition by run.id order by week.week_index, workout.position, workout.id
  )::integer - 1,
  occurrence.planned_date,
  case
    when occurrence.status = 'completed' then 'completed'
    when occurrence.status = 'in_progress' then 'in_progress'
    when occurrence.status = 'skipped' then 'skipped'
    when occurrence.planned_date is not null then 'scheduled'
    else 'unscheduled'
  end,
  occurrence.id,
  coalesce(occurrence.created_at, run.created_at),
  coalesce(occurrence.updated_at, run.updated_at)
from public.program_runs run
join public.program_weeks week on week.program_version_id = run.program_version_id
join public.workouts workout on workout.program_week_id = week.id
left join lateral (
  select candidate.*
  from public.scheduled_workouts candidate
  where candidate.athlete_id = run.athlete_id
    and candidate.program_version_id = run.program_version_id
    and candidate.workout_id = workout.id
    and (
      (run.legacy_assignment_id is not null
        and candidate.assignment_id = run.legacy_assignment_id)
      or (run.legacy_assignment_id is null and candidate.assignment_id is null)
    )
  order by candidate.sequence_number nulls last, candidate.created_at, candidate.id
  limit 1
) occurrence on true
on conflict (program_run_id, position) do nothing;

with unmatched as materialized (
  select
    occurrence.*,
    run.id as resolved_run_id,
    row_number() over (
      partition by run.id order by occurrence.sequence_number nulls last,
        occurrence.created_at, occurrence.id
    )::integer - 1 as extra_position
  from public.scheduled_workouts occurrence
  join public.program_runs run
    on run.athlete_id = occurrence.athlete_id
   and run.program_version_id = occurrence.program_version_id
   and (
     (occurrence.assignment_id is not null
       and run.legacy_assignment_id = occurrence.assignment_id)
     or (occurrence.assignment_id is null and run.legacy_assignment_id is null)
   )
  where not exists (
    select 1 from public.program_run_workouts slot
    where slot.scheduled_workout_id = occurrence.id
  )
), run_offsets as materialized (
  select program_run_id, coalesce(max(position), -1) + 1 as next_position
  from public.program_run_workouts
  group by program_run_id
)
insert into public.program_run_workouts (
  program_run_id, workout_id, position, planned_date, status,
  scheduled_workout_id, created_at, updated_at
)
select
  unmatched.resolved_run_id,
  unmatched.workout_id,
  run_offsets.next_position + unmatched.extra_position,
  unmatched.planned_date,
  case
    when unmatched.status = 'completed' then 'completed'
    when unmatched.status = 'in_progress' then 'in_progress'
    when unmatched.status = 'skipped' then 'skipped'
    when unmatched.planned_date is not null then 'scheduled'
    else 'unscheduled'
  end,
  unmatched.id,
  unmatched.created_at,
  unmatched.updated_at
from unmatched
join run_offsets on run_offsets.program_run_id = unmatched.resolved_run_id;

update public.scheduled_workouts occurrence
set
  program_run_id = slot.program_run_id,
  program_run_workout_id = slot.id
from public.program_run_workouts slot
where slot.scheduled_workout_id = occurrence.id
  and occurrence.program_run_id is null;

-- Completed session rows are intentionally immutable. Temporarily disable the
-- existing identity guard solely while adding the new lineage columns.
alter table public.workout_sessions
  disable trigger protect_workout_session_history;

update public.workout_sessions session
set
  program_run_id = occurrence.program_run_id,
  program_run_workout_id = occurrence.program_run_workout_id
from public.scheduled_workouts occurrence
where occurrence.id = session.scheduled_workout_id
  and occurrence.program_run_id is not null
  and session.program_run_id is null;

with ranked_session_slots as materialized (
  select
    session.id as session_id,
    run.id as program_run_id,
    slot.id as slot_id,
    row_number() over (
      partition by session.id order by slot.position, slot.id
    ) as rank
  from public.workout_sessions session
  join public.program_runs run
    on run.athlete_id = session.athlete_id
   and run.program_version_id = session.program_version_id
   and (
     (session.assignment_id is not null
       and run.legacy_assignment_id = session.assignment_id)
     or (session.assignment_id is null and run.legacy_assignment_id is null)
   )
  join public.program_run_workouts slot
    on slot.program_run_id = run.id
   and slot.workout_id = session.workout_id
  where session.program_run_id is null
    and session.program_version_id is not null
    and session.workout_id is not null
)
update public.workout_sessions session
set
  program_run_id = resolved.program_run_id,
  program_run_workout_id = resolved.slot_id
from ranked_session_slots resolved
where resolved.session_id = session.id
  and resolved.rank = 1;

alter table public.workout_sessions
  enable trigger protect_workout_session_history;

-- Session history wins over an old occurrence status during backfill.
update public.program_run_workouts slot
set status = case
  when exists (
    select 1 from public.workout_sessions session
    where session.program_run_workout_id = slot.id
      and session.status = 'completed'
  ) then 'completed'
  when exists (
    select 1 from public.workout_sessions session
    where session.program_run_workout_id = slot.id
      and session.status = 'in_progress'
  ) then 'in_progress'
  else slot.status
end
where exists (
  select 1 from public.workout_sessions session
  where session.program_run_workout_id = slot.id
    and session.status in ('in_progress', 'completed')
);

create or replace function private.refresh_program_run_status(target_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  next_status text;
  activity_at timestamptz;
  terminal_activity_at timestamptz;
begin
  select run.status into current_status
  from public.program_runs run
  where run.id = target_run_id
  for update;
  if not found or current_status = 'ended' then return; end if;

  select case
    when count(*) > 0
      and bool_and(slot.status in ('completed', 'skipped', 'cancelled'))
      then 'completed'
    when count(*) filter (
      where slot.status in ('in_progress', 'completed', 'skipped')
    ) > 0 then 'in_progress'
    else 'not_started'
  end
  into next_status
  from public.program_run_workouts slot
  where slot.program_run_id = target_run_id;

  select
    min(session.started_at),
    max(session.completed_at) filter (where session.status = 'completed')
  into activity_at, terminal_activity_at
  from public.workout_sessions session
  where session.program_run_id = target_run_id;

  -- Older skipped occurrences may have no session. Their status-change time
  -- is still better historical evidence than migration time (and unlike
  -- created_at does not claim that scheduling itself started the run).
  select
    coalesce(
      activity_at,
      min(occurrence.updated_at) filter (
        where occurrence.status in ('in_progress', 'completed', 'skipped')
      )
    ),
    coalesce(
      terminal_activity_at,
      max(occurrence.updated_at) filter (
        where occurrence.status in ('completed', 'skipped')
      )
    )
  into activity_at, terminal_activity_at
  from public.program_run_workouts slot
  left join public.scheduled_workouts occurrence
    on occurrence.id = slot.scheduled_workout_id
  where slot.program_run_id = target_run_id;

  update public.program_runs
  set
    status = next_status,
    started_at = case
      when next_status = 'not_started' then null
      else coalesce(started_at, activity_at, now())
    end,
    completed_at = case
      when next_status = 'completed'
        then coalesce(completed_at, terminal_activity_at, now())
      else null
    end
  where id = target_run_id;
end;
$$;

do $$
declare candidate record;
begin
  for candidate in select id from public.program_runs loop
    perform private.refresh_program_run_status(candidate.id);
  end loop;
end;
$$;

-- Runs replace assignments as the user-visible usage object. Retain legacy
-- assignment rows solely as immutable provenance, but remove them from active
-- Programs/Coach-library queries so one historical assignment is not shown a
-- second time beside its backfilled run.
update public.program_assignments assignment
set status = 'archived', updated_at = now()
where assignment.status = 'active'
  and exists (
    select 1 from public.program_runs run
    where run.legacy_assignment_id = assignment.id
  );

create or replace function private.validate_program_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' and (
    new.athlete_id is distinct from old.athlete_id
    or new.created_by_id is distinct from old.created_by_id
    or new.source_program_id is distinct from old.source_program_id
    or new.program_version_id is distinct from old.program_version_id
    or new.legacy_assignment_id is distinct from old.legacy_assignment_id
    or new.repeated_from_run_id is distinct from old.repeated_from_run_id
    or new.request_key is distinct from old.request_key
    or new.creation_schedule is distinct from old.creation_schedule
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Program run identity and source are immutable';
  end if;

  if tg_op = 'INSERT' then
    if current_user_id is null or new.created_by_id is distinct from current_user_id then
      raise exception 'Program run creator must be the authenticated user';
    end if;
    if new.athlete_id is distinct from current_user_id and not exists (
      select 1 from public.coach_relationships relationship
      where relationship.athlete_id = new.athlete_id
        and relationship.coach_id = current_user_id
        and relationship.ended_at is null
    ) then
      raise exception 'Programs can only be assigned to athletes you currently coach';
    end if;
    if not exists (
      select 1
      from public.program_versions version
      where version.id = new.program_version_id
        and version.program_id = new.source_program_id
        and version.status in ('published', 'superseded')
    ) then
      raise exception 'Program runs require an immutable program revision';
    end if;
    if new.repeated_from_run_id is not null and not exists (
      select 1 from public.program_runs previous
      where previous.id = new.repeated_from_run_id
        and previous.athlete_id = new.athlete_id
        and previous.program_version_id = new.program_version_id
    ) then
      raise exception 'A repeated run must use the same athlete and revision';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_program_run
before insert or update on public.program_runs
for each row execute function private.validate_program_run();

create or replace function private.validate_program_run_workout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The service-only fixture reset must break the historical schedule/slot
  -- pointer before deleting the whole isolated test aggregate. No application
  -- caller can enable this path.
  if current_setting('liftlog.test_reset', true) = 'on'
    and coalesce((select auth.role()), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' and (
    new.program_run_id is distinct from old.program_run_id
    or new.workout_id is distinct from old.workout_id
    or new.position is distinct from old.position
    or (
      old.scheduled_workout_id is not null
      and new.scheduled_workout_id is distinct from old.scheduled_workout_id
    )
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Program run workout identity is immutable';
  end if;

  if not exists (
    select 1
    from public.program_runs run
    join public.program_weeks week
      on week.program_version_id = run.program_version_id
    join public.workouts workout on workout.program_week_id = week.id
    where run.id = new.program_run_id
      and workout.id = new.workout_id
  ) then
    raise exception 'Run workout is not part of the immutable program revision';
  end if;
  return new;
end;
$$;

create trigger validate_program_run_workout
before insert or update on public.program_run_workouts
for each row execute function private.validate_program_run_workout();

-- Run-linked occurrences use the same calendar/session machinery as legacy
-- occurrences. Extend the existing identity guard with their lineage and the
-- same athlete/active-coach authorization rules.
create or replace function private.protect_schedule_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  assignment public.program_assignments%rowtype;
  linked_run public.program_runs%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.athlete_id is distinct from old.athlete_id
      or new.program_version_id is distinct from old.program_version_id
      or new.workout_id is distinct from old.workout_id
      or new.scheduled_by_id is distinct from old.scheduled_by_id
      or new.assignment_id is distinct from old.assignment_id
      or new.request_key is distinct from old.request_key
      or new.program_run_id is distinct from old.program_run_id
      or new.program_run_workout_id is distinct from old.program_run_workout_id then
      raise exception 'Scheduled workout identity and scheduler cannot be changed';
    end if;
    return new;
  end if;

  if new.program_run_workout_id is not null then
    select run.* into linked_run
    from public.program_run_workouts slot
    join public.program_runs run on run.id = slot.program_run_id
    where slot.id = new.program_run_workout_id
      and slot.program_run_id = new.program_run_id
      and slot.workout_id = new.workout_id
      and run.athlete_id = new.athlete_id
      and run.program_version_id = new.program_version_id
      and run.status <> 'ended';
    if not found then raise exception 'Scheduled workout run lineage is invalid'; end if;
    if new.assignment_id is distinct from linked_run.legacy_assignment_id then
      raise exception 'Scheduled workout assignment/run lineage is invalid';
    end if;
    if new.scheduled_by_id = new.athlete_id then
      if current_user_id is not null and current_user_id is distinct from new.athlete_id then
        raise exception 'Athlete-scheduled workout must record the authenticated athlete';
      end if;
    elsif current_user_id is null
      or new.scheduled_by_id is distinct from current_user_id
      or linked_run.created_by_id is distinct from current_user_id
      or not exists (
        select 1 from public.coach_relationships relationship
        where relationship.athlete_id = new.athlete_id
          and relationship.coach_id = current_user_id
          and relationship.ended_at is null
      ) then
      raise exception 'Coach-scheduled workout provenance is invalid';
    end if;
    return new;
  end if;

  if new.program_run_id is not null then
    raise exception 'Scheduled workout run slot is required';
  end if;

  if new.assignment_id is not null then
    select candidate.* into assignment
    from public.program_assignments candidate
    where candidate.id = new.assignment_id;
    if not found or assignment.status <> 'active'
      or assignment.athlete_id is distinct from new.athlete_id
      or private.assignment_content_version(assignment.id) is distinct from new.program_version_id
      or not exists (
        select 1 from public.workouts workout
        join public.program_weeks week on week.id = workout.program_week_id
        where workout.id = new.workout_id
          and week.program_version_id = new.program_version_id
      ) then
      raise exception 'Scheduled workout assignment lineage is invalid';
    end if;
  elsif not exists (
    select 1
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    join public.program_versions version on version.id = week.program_version_id
    join public.programs program on program.id = version.program_id
    where workout.id = new.workout_id
      and version.id = new.program_version_id
      and program.athlete_id = new.athlete_id
      and version.status in ('published', 'superseded')
  ) then
    raise exception 'Scheduled workout must belong to immutable athlete content';
  end if;

  if new.scheduled_by_id = new.athlete_id then
    if current_user_id is not null and current_user_id is distinct from new.athlete_id then
      raise exception 'Athlete-scheduled workout must record the authenticated athlete';
    end if;
    return new;
  end if;
  if current_user_id is null or new.scheduled_by_id is distinct from current_user_id
    or new.status is distinct from 'planned' or new.planned_date is null then
    raise exception 'Coach-scheduled workout provenance is invalid';
  end if;
  perform relationship.id
  from public.coach_relationships relationship
  where relationship.athlete_id = new.athlete_id
    and relationship.coach_id = current_user_id
    and relationship.ended_at is null
  for share;
  if not found then raise exception 'Coach can only schedule for an actively coached athlete'; end if;

  if new.assignment_id is not null then
    if assignment.assigned_by_id is distinct from current_user_id
      or not exists (
        select 1 from public.programs program
        where program.id = coalesce(assignment.customized_program_id, assignment.source_program_id)
          and program.content_type = 'quick_workout'
      ) then
      raise exception 'Coach can only schedule their quick-workout assignment';
    end if;
  elsif not exists (
    select 1
    from public.program_versions version
    join public.programs program on program.id = version.program_id
    where version.id = new.program_version_id
      and version.authored_by_id = current_user_id
      and program.athlete_id = new.athlete_id
      and program.created_by_id = current_user_id
      and program.source_type = 'coach'
      and program.content_type = 'quick_workout'
  ) then
    raise exception 'Coach can only schedule their published quick-workout assignment';
  end if;
  return new;
end;
$$;

create or replace function private.sync_program_run_from_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_run_status text;
  linked_slot_status text;
begin
  if new.program_run_workout_id is null then return new; end if;
  select run.status, slot.status
  into linked_run_status, linked_slot_status
  from public.program_runs run
  join public.program_run_workouts slot
    on slot.program_run_id = run.id
   and slot.id = new.program_run_workout_id
  where run.id = new.program_run_id
  for update of run;
  if not found then raise exception 'Scheduled workout run lineage is invalid'; end if;
  -- Terminal runs cannot be reopened through an older calendar-status RPC.
  -- Ending deliberately turns its remaining calendar rows into skipped
  -- history after the run itself becomes ended, so that one transition is the
  -- only terminal mutation accepted and must not revive cancelled slots.
  if linked_run_status = 'ended' then
    if tg_op is distinct from 'UPDATE'
      or old.status is distinct from 'planned'
      or new.status is distinct from 'skipped' then
      raise exception 'Ended program workouts cannot be restored';
    end if;
    return new;
  end if;
  -- Completion caused only by skipped slots is reversible. Restore exactly a
  -- skipped occurrence whose materialized slot is also skipped, and only when
  -- no completed session exists for that slot. Completed results and manually
  -- ended runs remain immutable.
  if linked_run_status = 'completed' and not (
    tg_op = 'UPDATE'
    and old.status = 'skipped'
    and new.status = 'planned'
    and linked_slot_status = 'skipped'
    and not exists (
      select 1
      from public.workout_sessions session
      where session.program_run_workout_id = new.program_run_workout_id
        and session.status = 'completed'
    )
  ) then
    raise exception 'Completed program workouts cannot be changed';
  end if;
  update public.program_run_workouts
  set
    scheduled_workout_id = coalesce(scheduled_workout_id, new.id),
    planned_date = new.planned_date,
    status = case
      when new.status = 'completed' then 'completed'
      when new.status = 'in_progress' then 'in_progress'
      when new.status = 'skipped' then 'skipped'
      when new.planned_date is not null then 'scheduled'
      else 'unscheduled'
    end
  where id = new.program_run_workout_id
    and program_run_id = new.program_run_id;
  if current_setting('liftlog.program_run_bulk_sync', true) is distinct from 'on' then
    perform private.refresh_program_run_status(new.program_run_id);
  end if;
  return new;
end;
$$;

create trigger sync_program_run_from_schedule
after insert or update of planned_date, status on public.scheduled_workouts
for each row execute function private.sync_program_run_from_schedule();

create or replace function private.hydrate_session_program_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare linked_schedule public.scheduled_workouts%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.program_run_id is distinct from old.program_run_id
    or new.program_run_workout_id is distinct from old.program_run_workout_id
  ) then
    raise exception 'Workout session run identity cannot be changed';
  end if;
  if tg_op = 'INSERT' and new.scheduled_workout_id is not null then
    select occurrence.* into linked_schedule
    from public.scheduled_workouts occurrence
    where occurrence.id = new.scheduled_workout_id;
    new.program_run_id := linked_schedule.program_run_id;
    new.program_run_workout_id := linked_schedule.program_run_workout_id;
  end if;
  return new;
end;
$$;

create trigger hydrate_session_program_run
before insert or update on public.workout_sessions
for each row execute function private.hydrate_session_program_run();

create or replace function private.protect_session_identity_and_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('liftlog.test_reset', true) = 'on'
    and coalesce((select auth.role()), '') = 'service_role' then
    return old;
  end if;
  if tg_op <> 'INSERT' and old.status = 'completed' then
    raise exception 'Completed workout sessions are immutable';
  end if;
  if tg_op = 'UPDATE' and (
    new.athlete_id is distinct from old.athlete_id
    or new.scheduled_workout_id is distinct from old.scheduled_workout_id
    or new.program_version_id is distinct from old.program_version_id
    or new.workout_id is distinct from old.workout_id
    or new.assignment_id is distinct from old.assignment_id
    or new.program_run_id is distinct from old.program_run_id
    or new.program_run_workout_id is distinct from old.program_run_workout_id
  ) then
    raise exception 'Workout session identity cannot be changed';
  end if;
  if tg_op <> 'DELETE' and new.scheduled_workout_id is not null and not exists (
    select 1
    from public.scheduled_workouts scheduled
    where scheduled.id = new.scheduled_workout_id
      and scheduled.athlete_id = new.athlete_id
      and scheduled.program_version_id is not distinct from new.program_version_id
      and scheduled.workout_id is not distinct from new.workout_id
      and scheduled.assignment_id is not distinct from new.assignment_id
      and scheduled.program_run_id is not distinct from new.program_run_id
      and scheduled.program_run_workout_id is not distinct from new.program_run_workout_id
  ) then
    raise exception 'Workout session does not match its scheduled workout';
  end if;
  if tg_op <> 'DELETE'
    and new.program_run_id is not null
    and not exists (
      select 1
      from public.program_runs run
      join public.program_run_workouts slot on slot.program_run_id = run.id
      where run.id = new.program_run_id
        and slot.id = new.program_run_workout_id
        and run.athlete_id = new.athlete_id
        and run.program_version_id = new.program_version_id
        and slot.workout_id = new.workout_id
    ) then
    raise exception 'Workout session run lineage is invalid';
  end if;
  if tg_op <> 'DELETE'
    and new.workout_id is not null
    and new.program_version_id is not null
    and new.assignment_id is not null
    and not exists (
      select 1
      from public.program_assignments assignment
      join public.workouts workout on workout.id = new.workout_id
      join public.program_weeks week on week.id = workout.program_week_id
      where assignment.id = new.assignment_id
        and assignment.athlete_id = new.athlete_id
        and week.program_version_id = new.program_version_id
        and (
          assignment.source_version_id = new.program_version_id
          or exists (
            select 1
            from public.program_versions custom_version
            where custom_version.id = new.program_version_id
              and custom_version.program_id = assignment.customized_program_id
              and custom_version.status in ('published', 'superseded')
          )
        )
    ) then
    raise exception 'Workout session assignment lineage is invalid';
  end if;
  if tg_op <> 'DELETE'
    and new.workout_id is not null
    and new.program_version_id is not null
    and new.assignment_id is null
    and new.program_run_id is null
    and not exists (
      select 1
      from public.workouts workout
      join public.program_weeks week on week.id = workout.program_week_id
      join public.program_versions version on version.id = week.program_version_id
      join public.programs program on program.id = version.program_id
      where workout.id = new.workout_id
        and version.id = new.program_version_id
        and program.athlete_id = new.athlete_id
    ) then
    raise exception 'Workout session program lineage is invalid';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Used revisions are snapshots. The reusable source remains editable through a
-- fresh draft revision, which is created automatically after each snapshot.
create or replace function public.can_edit_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.programs program
    where program.id = target_program_id
      and program.archived_at is null
      and program.created_by_id = (select auth.uid())
      and (
        (program.source_type = 'self'
          and program.athlete_id = (select auth.uid()))
        or (
          program.source_type = 'coach'
          and public.is_active_coach(program.athlete_id)
        )
      )
  );
$$;

-- Explicit publication remains a compatibility operation for older clients
-- and administrative tooling. Unlike the pre-lock implementation, it now
-- records first use atomically, so exposing the guarded RPC cannot produce a
-- published revision whose source still appears unused. New application flows
-- publish through snapshot_program_for_run instead.
create or replace function public.publish_program_version(
  target_version_id uuid,
  effective_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_program_id uuid;
begin
  select version.program_id
  into target_program_id
  from public.program_versions version
  where version.id = target_version_id
    and version.status = 'draft'
  for update;

  if target_program_id is null then
    raise exception 'Editable content was not found';
  end if;
  if not public.can_edit_program(target_program_id) then
    raise exception 'This content is not editable';
  end if;
  if effective_on is null then
    raise exception 'An effective date is required';
  end if;
  if not exists (
    select 1
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_version_id
  ) then
    raise exception 'Add at least one workout before using this content';
  end if;

  update public.program_versions
  set status = 'superseded'
  where program_id = target_program_id and status = 'published';
  update public.program_versions
  set status = 'published', effective_from = effective_on
  where id = target_version_id;
  update public.programs
  set locked_at = coalesce(locked_at, now())
  where id = target_program_id;

  return target_version_id;
end;
$$;

create or replace function public.can_read_version(target_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.program_versions version
    where version.id = target_version_id
      and (
        -- An athlete may consume immutable content addressed by their program,
        -- but a coach's working draft is private until it becomes a run
        -- snapshot. The author keeps normal draft access through can_edit.
        (version.status in ('published', 'superseded')
          and public.can_read_program(version.program_id))
        or public.can_edit_program(version.program_id)
      )
  ) or exists (
    select 1 from public.program_runs run
    where run.program_version_id = target_version_id
      and private.can_read_program_run(run.id)
  );
$$;

-- The original policy delegated only to the program container and therefore
-- exposed every version, including an active coach's unpublished customized
-- draft, to the athlete named on that container. Apply the status-aware
-- version check at the table boundary; descendant content policies already use
-- can_read_version and inherit the same rule.
drop policy if exists program_versions_read_authorized
  on public.program_versions;
create policy program_versions_read_authorized
on public.program_versions for select to authenticated
using (public.can_read_version(id));

-- get_program_version_detail is SECURITY DEFINER, so its direct-program branch
-- must apply the same draft rule explicitly instead of relying on table RLS.
create or replace function public.get_program_version_detail(
  target_program_id uuid default null,
  target_assignment_id uuid default null,
  target_version_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_assignment public.program_assignments%rowtype;
  selected_program public.programs%rowtype;
  selected_version public.program_versions%rowtype;
  may_read_draft boolean := false;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if (target_program_id is null) = (target_assignment_id is null) then
    raise exception 'Choose exactly one program or assignment';
  end if;

  if target_assignment_id is not null then
    select assignment.* into selected_assignment
    from public.program_assignments assignment
    where assignment.id = target_assignment_id
      and assignment.status = 'active'
      and (
        assignment.athlete_id = current_user_id
        or (
          assignment.assigned_by_id = current_user_id
          and exists (
            select 1 from public.coach_relationships relationship
            where relationship.athlete_id = assignment.athlete_id
              and relationship.coach_id = current_user_id
              and relationship.ended_at is null
          )
        )
      );
    if not found then return null; end if;

    may_read_draft := selected_assignment.assigned_by_id = current_user_id
      and exists (
        select 1 from public.coach_relationships relationship
        where relationship.athlete_id = selected_assignment.athlete_id
          and relationship.coach_id = current_user_id
          and relationship.ended_at is null
      );

    if target_version_id is not null then
      select version.* into selected_version
      from public.program_versions version
      where version.id = target_version_id
        and (
          version.id = selected_assignment.source_version_id
          or version.program_id = selected_assignment.customized_program_id
        )
        and (version.status <> 'draft' or may_read_draft);
    elsif may_read_draft and selected_assignment.customized_program_id is not null then
      select version.* into selected_version
      from public.program_versions version
      where version.program_id = selected_assignment.customized_program_id
      order by
        case version.status when 'draft' then 0 when 'published' then 1 else 2 end,
        version.version_number desc, version.id
      limit 1;
    else
      select version.* into selected_version
      from public.program_versions version
      where version.id = private.assignment_content_version(selected_assignment.id);
    end if;
  else
    select program.* into selected_program
    from public.programs program
    where program.id = target_program_id
      and (
        program.athlete_id = current_user_id
        or (
          program.created_by_id = current_user_id
          and program.source_type = 'coach'
          and exists (
            select 1 from public.coach_relationships relationship
            where relationship.athlete_id = program.athlete_id
              and relationship.coach_id = current_user_id
              and relationship.ended_at is null
          )
        )
      );
    if not found then return null; end if;

    may_read_draft := selected_program.created_by_id = current_user_id
      and public.can_edit_program(selected_program.id);
    if target_version_id is not null then
      select version.* into selected_version
      from public.program_versions version
      where version.id = target_version_id
        and version.program_id = selected_program.id
        and (version.status <> 'draft' or may_read_draft);
    elsif may_read_draft then
      select version.* into selected_version
      from public.program_versions version
      where version.program_id = selected_program.id
      order by
        case version.status when 'draft' then 0 when 'published' then 1 else 2 end,
        version.version_number desc, version.id
      limit 1;
    else
      select version.* into selected_version
      from public.program_versions version
      where version.program_id = selected_program.id
        and version.status in ('published', 'superseded')
      order by
        case version.status when 'published' then 0 else 1 end,
        version.version_number desc, version.id
      limit 1;
    end if;
  end if;

  if selected_version.id is null then return null; end if;
  select program.* into selected_program
  from public.programs program
  where program.id = selected_version.program_id;

  return jsonb_build_object(
    'kind', case when target_assignment_id is null then 'program' else 'assignment' end,
    'id', coalesce(target_assignment_id, selected_program.id),
    'programId', selected_program.id,
    'assignmentId', target_assignment_id,
    'customizedProgramId', selected_assignment.customized_program_id,
    'athleteId', coalesce(selected_assignment.athlete_id, selected_program.athlete_id),
    'createdById', coalesce(selected_assignment.assigned_by_id, selected_program.created_by_id),
    'versionId', selected_version.id,
    'versionNumber', selected_version.version_number,
    'versionStatus', selected_version.status,
    'title', selected_version.title,
    'description', selected_version.description,
    'planningMode', selected_program.planning_mode,
    'sourceType', selected_program.source_type,
    'contentType', selected_program.content_type,
    'effectiveFrom', selected_version.effective_from,
    'publishedAt', selected_version.published_at
  ) || private.program_version_content_payload(selected_version.id);
end;
$$;

-- A shared immutable program version is readable by every athlete who has a
-- run for it. Schedule metadata is not shared content: dates and status belong
-- to one athlete. Keep occurrence reads tied to that exact athlete/run (or to
-- the exact legacy assignment) instead of inheriting version visibility.
drop policy if exists scheduled_workouts_read_authorized
  on public.scheduled_workouts;
create policy scheduled_workouts_read_authorized
on public.scheduled_workouts for select to authenticated
using (
  athlete_id = (select auth.uid())
  or (
    program_run_id is not null
    and exists (
      select 1
      from public.program_runs run
      join public.coach_relationships relationship
        on relationship.athlete_id = run.athlete_id
       and relationship.coach_id = (select auth.uid())
       and relationship.ended_at is null
      where run.id = scheduled_workouts.program_run_id
        and run.athlete_id = scheduled_workouts.athlete_id
        and run.created_by_id = (select auth.uid())
    )
  )
  or (
    program_run_id is null
    and assignment_id is not null
    and exists (
      select 1
      from public.program_assignments assignment
      join public.coach_relationships relationship
        on relationship.athlete_id = assignment.athlete_id
       and relationship.coach_id = (select auth.uid())
       and relationship.ended_at is null
      where assignment.id = scheduled_workouts.assignment_id
        and assignment.athlete_id = scheduled_workouts.athlete_id
        and assignment.assigned_by_id = (select auth.uid())
        and assignment.status = 'active'
    )
  )
  or (
    program_run_id is null
    and assignment_id is null
    and exists (
      select 1
      from public.program_versions version
      join public.programs program on program.id = version.program_id
      join public.coach_relationships relationship
        on relationship.athlete_id = scheduled_workouts.athlete_id
       and relationship.coach_id = (select auth.uid())
       and relationship.ended_at is null
      where version.id = scheduled_workouts.program_version_id
        and program.athlete_id = scheduled_workouts.athlete_id
        and program.created_by_id = (select auth.uid())
        and program.source_type = 'coach'
    )
  )
);

create or replace function private.snapshot_program_for_run(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  draft_version_id uuid;
  published_version_id uuid;
  snapshot_version_id uuid;
  next_version_id uuid;
  next_version_number integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  perform program.id
  from public.programs program
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and program.created_by_id = current_user_id
    and program.source_type = 'self'
    and program.archived_at is null
  for update;
  if not found then raise exception 'Only your own reusable content can be assigned'; end if;

  select version.id into draft_version_id
  from public.program_versions version
  where version.program_id = target_program_id and version.status = 'draft'
  order by version.version_number desc, version.id
  limit 1;

  select version.id into published_version_id
  from public.program_versions version
  where version.program_id = target_program_id and version.status = 'published'
  order by version.version_number desc, version.id
  limit 1;

  if draft_version_id is not null then
    -- Always freeze the exact working tree the caller selected. A successor
    -- draft contains cloned workout IDs, so reusing an older semantically
    -- identical revision would make its submitted schedule point outside the
    -- run snapshot. Request-key handling in create_program_runs provides retry
    -- idempotency without sacrificing that identity match.
    snapshot_version_id := public.publish_program_version(draft_version_id, current_date);
  else
    snapshot_version_id := published_version_id;
  end if;
  if snapshot_version_id is null then raise exception 'Program revision is unavailable'; end if;

  if not exists (
    select 1 from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = snapshot_version_id
  ) then raise exception 'Add at least one workout before assigning this program'; end if;

  if not exists (
    select 1 from public.program_versions version
    where version.program_id = target_program_id and version.status = 'draft'
  ) then
    select coalesce(max(version.version_number), 0) + 1
    into next_version_number
    from public.program_versions version
    where version.program_id = target_program_id;
    insert into public.program_versions (
      program_id, authored_by_id, based_on_version_id, version_number, status
    ) values (
      target_program_id, current_user_id, snapshot_version_id,
      next_version_number, 'draft'
    ) returning id into next_version_id;
    perform private.clone_program_version_tree(snapshot_version_id, next_version_id);
  end if;

  update public.programs
  set locked_at = coalesce(locked_at, now())
  where id = target_program_id;
  return snapshot_version_id;
end;
$$;

-- Keep the old entry point compatible while changing its semantics from
-- permanent content lock to immutable-revision snapshot.
create or replace function public.lock_program_for_use(target_program_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.snapshot_program_for_run(target_program_id);
$$;

-- `locked_at` is retained as first-use telemetry for compatibility, not as an
-- editing capability. Catalog owners always see the current working draft;
-- assignments and runs continue to point at their immutable revisions.
create or replace function public.list_program_summaries(
  page_limit integer default 25,
  after_created_at timestamptz default null,
  after_id uuid default null
)
returns table (
  kind text, id uuid, program_id uuid, assignment_id uuid,
  customized_program_id uuid, athlete_id uuid, version_id uuid,
  version_status text, title text, description text, source_type text,
  content_type text, created_by_id uuid, created_at timestamptz,
  week_count bigint, workout_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if (after_created_at is null) <> (after_id is null) then
    raise exception 'Program cursor is incomplete';
  end if;

  return query
  with visible_programs as materialized (
    select
      'program'::text as kind, program.id, program.id as program_id,
      null::uuid as assignment_id, null::uuid as customized_program_id,
      program.athlete_id, version.id as version_id,
      version.status as version_status, version.title, version.description,
      program.source_type, program.content_type, program.created_by_id,
      program.created_at
    from public.programs program
    join lateral (
      select candidate.id, candidate.status, candidate.title, candidate.description
      from public.program_versions candidate
      where candidate.program_id = program.id
      order by
        case
          when candidate.status = 'draft' then 0
          when candidate.status = 'published' then 1
          else 2
        end,
        candidate.version_number desc,
        candidate.id
      limit 1
    ) version on true
    where program.athlete_id = current_user_id
      and program.created_by_id = current_user_id
      and program.source_type = 'self'
      and program.archived_at is null
      and not exists (
        select 1 from public.program_assignments assignment
        where assignment.customized_program_id = program.id
      )
  ), page as materialized (
    select visible.* from visible_programs visible
    where after_created_at is null
      or (visible.created_at, visible.id) < (after_created_at, after_id)
    order by visible.created_at desc, visible.id desc
    limit least(greatest(coalesce(page_limit, 25), 1), 50)
  )
  select
    page.kind, page.id, page.program_id, page.assignment_id,
    page.customized_program_id, page.athlete_id, page.version_id,
    page.version_status, page.title, page.description, page.source_type,
    page.content_type, page.created_by_id, page.created_at,
    content_count.week_count, content_count.workout_count
  from page
  cross join lateral (
    select count(distinct week.id) as week_count,
      count(workout.id) as workout_count
    from public.program_weeks week
    left join public.workouts workout on workout.program_week_id = week.id
    where week.program_version_id = page.version_id
  ) content_count
  order by page.created_at desc, page.id desc;
end;
$$;

-- The Calendar creates a single-workout run only for quick workouts. Full
-- programs are started or assigned through the run wizard so their entire
-- ordered plan remains visible and cannot be split into orphan occurrences.
-- Keep active legacy quick-workout assignments visible for old clients while
-- their historical rows are retired.
create or replace function public.list_schedulable_workouts(
  page_limit integer default 50,
  after_program_title text default null,
  after_week_index integer default null,
  after_workout_position integer default null,
  after_id uuid default null
)
returns table (
  kind text,
  program_id uuid,
  assignment_id uuid,
  program_version_id uuid,
  workout_id uuid,
  program_title text,
  workout_title text,
  content_type text,
  is_quick_workout boolean,
  week_index integer,
  week_label text,
  workout_position integer,
  schedule_label text,
  estimated_minutes integer,
  latest_occurrence_id uuid,
  latest_planned_date date,
  latest_status text,
  latest_sequence_number integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  cursor_part_count integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  cursor_part_count :=
    (after_program_title is not null)::integer
    + (after_week_index is not null)::integer
    + (after_workout_position is not null)::integer
    + (after_id is not null)::integer;
  if cursor_part_count not in (0, 4) then
    raise exception 'Schedulable workout cursor is incomplete';
  end if;

  return query
  with visible_versions as materialized (
    select
      'program'::text as kind,
      program.id as program_id,
      null::uuid as assignment_id,
      version.id as program_version_id,
      version.title as program_title,
      program.content_type
    from public.programs program
    join lateral (
      select candidate.id, candidate.title
      from public.program_versions candidate
      where candidate.program_id = program.id
        and candidate.status in ('draft', 'published')
      order by case when candidate.status = 'draft' then 0 else 1 end,
        candidate.version_number desc, candidate.id
      limit 1
    ) version on true
    where program.athlete_id = current_user_id
      and program.created_by_id = current_user_id
      and program.source_type = 'self'
      and program.is_current
      and program.archived_at is null
      and program.content_type = 'quick_workout'
      and not exists (
        select 1
        from public.program_assignments assignment
        where assignment.customized_program_id = program.id
      )

    union all

    select
      'assignment'::text,
      version.program_id,
      assignment.id,
      version.id,
      version.title,
      program.content_type
    from public.program_assignments assignment
    join public.program_versions version
      on version.id = private.assignment_content_version(assignment.id)
    join public.programs program on program.id = version.program_id
    where assignment.athlete_id = current_user_id
      and assignment.status = 'active'
      and program.content_type = 'quick_workout'
  ), candidate_page as materialized (
    select
      visible.kind,
      visible.program_id,
      visible.assignment_id,
      visible.program_version_id,
      visible.program_title,
      visible.content_type,
      week.week_index,
      week.label as week_label,
      workout.id as workout_id,
      workout.title as workout_title,
      workout.position as workout_position,
      workout.schedule_label,
      workout.estimated_minutes
    from visible_versions visible
    join public.program_weeks week
      on week.program_version_id = visible.program_version_id
    join public.workouts workout on workout.program_week_id = week.id
    where after_program_title is null
      or (
        lower(visible.program_title),
        week.week_index,
        workout.position,
        workout.id
      ) > (
        lower(after_program_title),
        after_week_index,
        after_workout_position,
        after_id
      )
    order by
      lower(visible.program_title),
      week.week_index,
      workout.position,
      workout.id
    limit least(greatest(coalesce(page_limit, 50), 1), 100)
  )
  select
    candidate.kind,
    candidate.program_id,
    candidate.assignment_id,
    candidate.program_version_id,
    candidate.workout_id,
    candidate.program_title,
    candidate.workout_title,
    candidate.content_type,
    true,
    candidate.week_index,
    candidate.week_label,
    candidate.workout_position,
    candidate.schedule_label,
    candidate.estimated_minutes,
    latest.id,
    latest.planned_date,
    latest.status,
    latest.sequence_number
  from candidate_page candidate
  left join lateral (
    select occurrence.id, occurrence.planned_date,
      occurrence.status, occurrence.sequence_number
    from public.scheduled_workouts occurrence
    where occurrence.athlete_id = current_user_id
      and occurrence.program_version_id = candidate.program_version_id
      and occurrence.workout_id = candidate.workout_id
      and occurrence.assignment_id is not distinct from candidate.assignment_id
    order by occurrence.sequence_number desc nulls last, occurrence.id desc
    limit 1
  ) latest on true
  order by lower(candidate.program_title), candidate.week_index,
    candidate.workout_position, candidate.workout_id;
end;
$$;

create or replace function public.list_frequent_schedulable_workouts(
  page_limit integer default 6
)
returns table (
  kind text,
  program_id uuid,
  assignment_id uuid,
  program_version_id uuid,
  workout_id uuid,
  program_title text,
  workout_title text,
  content_type text,
  is_quick_workout boolean,
  week_index integer,
  week_label text,
  workout_position integer,
  schedule_label text,
  estimated_minutes integer,
  usage_count bigint,
  last_used_at timestamptz,
  latest_occurrence_id uuid,
  latest_planned_date date,
  latest_status text,
  latest_sequence_number integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  return query
  with visible_versions as materialized (
    select
      'program'::text as kind,
      program.id as program_id,
      null::uuid as assignment_id,
      version.id as program_version_id,
      version.title as program_title,
      program.content_type
    from public.programs program
    join lateral (
      select candidate.id, candidate.title
      from public.program_versions candidate
      where candidate.program_id = program.id
        and candidate.status in ('draft', 'published')
      order by case when candidate.status = 'draft' then 0 else 1 end,
        candidate.version_number desc, candidate.id
      limit 1
    ) version on true
    where program.athlete_id = current_user_id
      and program.created_by_id = current_user_id
      and program.source_type = 'self'
      and program.is_current
      and program.archived_at is null
      and program.content_type = 'quick_workout'
      and not exists (
        select 1 from public.program_assignments assignment
        where assignment.customized_program_id = program.id
      )

    union all

    select
      'assignment'::text,
      version.program_id,
      assignment.id,
      version.id,
      version.title,
      program.content_type
    from public.program_assignments assignment
    join public.program_versions version
      on version.id = private.assignment_content_version(assignment.id)
    join public.programs program on program.id = version.program_id
    where assignment.athlete_id = current_user_id
      and assignment.status = 'active'
      and program.content_type = 'quick_workout'
  ), quick_candidates as materialized (
    select
      visible.kind,
      visible.program_id,
      visible.assignment_id,
      visible.program_version_id,
      visible.program_title,
      visible.content_type,
      week.week_index,
      week.label as week_label,
      workout.id as workout_id,
      workout.title as workout_title,
      workout.position as workout_position,
      workout.schedule_label,
      workout.estimated_minutes
    from visible_versions visible
    join public.program_weeks week
      on week.program_version_id = visible.program_version_id
    join public.workouts workout on workout.program_week_id = week.id
  ), completed_usage as materialized (
    select
      case when session.assignment_id is null
        then 'program'::text else 'assignment'::text end as identity_kind,
      coalesce(session.assignment_id, historical_version.program_id) as identity_id,
      count(*) as usage_count,
      max(session.completed_at) as last_used_at
    from public.workout_sessions session
    join public.program_versions historical_version
      on historical_version.id = session.program_version_id
    where session.athlete_id = current_user_id
      and session.status = 'completed'
    group by
      case when session.assignment_id is null
        then 'program'::text else 'assignment'::text end,
      coalesce(session.assignment_id, historical_version.program_id)
  ), frequent_page as materialized (
    select candidate.*, usage.usage_count, usage.last_used_at
    from quick_candidates candidate
    join completed_usage usage
      on usage.identity_kind = candidate.kind
     and usage.identity_id = coalesce(candidate.assignment_id, candidate.program_id)
    order by usage.usage_count desc, usage.last_used_at desc,
      lower(candidate.workout_title), candidate.kind,
      coalesce(candidate.assignment_id, candidate.program_id), candidate.workout_id
    limit least(greatest(coalesce(page_limit, 6), 1), 12)
  )
  select
    candidate.kind,
    candidate.program_id,
    candidate.assignment_id,
    candidate.program_version_id,
    candidate.workout_id,
    candidate.program_title,
    candidate.workout_title,
    candidate.content_type,
    true,
    candidate.week_index,
    candidate.week_label,
    candidate.workout_position,
    candidate.schedule_label,
    candidate.estimated_minutes,
    candidate.usage_count,
    candidate.last_used_at,
    latest.id,
    latest.planned_date,
    latest.status,
    latest.sequence_number
  from frequent_page candidate
  left join lateral (
    select occurrence.id, occurrence.planned_date,
      occurrence.status, occurrence.sequence_number
    from public.scheduled_workouts occurrence
    where occurrence.athlete_id = current_user_id
      and occurrence.program_version_id = candidate.program_version_id
      and occurrence.workout_id = candidate.workout_id
      and occurrence.assignment_id is not distinct from candidate.assignment_id
    order by occurrence.sequence_number desc nulls last, occurrence.id desc
    limit 1
  ) latest on true
  order by candidate.usage_count desc, candidate.last_used_at desc,
    lower(candidate.workout_title), candidate.kind,
    coalesce(candidate.assignment_id, candidate.program_id), candidate.workout_id;
end;
$$;

-- Compatibility entry point for older Calendar clients. They may still create
-- a legacy occurrence, but only for a quick workout. Candidate discovery is
-- draft-first, so freezing the exact selected draft preserves its workout UUID
-- while creating the next editable draft as a separate cloned tree.
create or replace function public.create_scheduled_occurrence_for_use(
  target_workout_id uuid,
  target_planned_date date,
  target_idempotency_key uuid,
  target_program_id uuid default null,
  target_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if (target_program_id is null) = (target_assignment_id is null) then
    raise exception 'Choose exactly one program or assignment';
  end if;

  -- An uncertain retry must not publish the successor draft before the
  -- underlying occurrence RPC has a chance to return its existing receipt.
  if exists (
    select 1 from public.scheduled_workouts occurrence
    where occurrence.athlete_id = current_user_id
      and occurrence.request_key = target_idempotency_key
  ) then
    return public.create_scheduled_occurrence(
      target_workout_id, target_planned_date, target_idempotency_key,
      target_program_id, target_assignment_id
    );
  end if;

  if target_assignment_id is not null then
    if not exists (
      select 1
      from public.program_assignments assignment
      join public.program_versions version
        on version.id = private.assignment_content_version(assignment.id)
      join public.programs program on program.id = version.program_id
      where assignment.id = target_assignment_id
        and assignment.athlete_id = current_user_id
        and assignment.status = 'active'
        and program.content_type = 'quick_workout'
    ) then raise exception 'Only a quick workout can be added directly to the calendar'; end if;
  else
    perform program.id from public.programs program
    where program.id = target_program_id
      and program.athlete_id = current_user_id
      and program.created_by_id = current_user_id
      and program.source_type = 'self'
      and program.content_type = 'quick_workout'
      and program.archived_at is null
    for update;
    if not found then
      raise exception 'Only your quick workout can be added directly to the calendar';
    end if;
  end if;

  if target_assignment_id is null then
    -- A concurrent request may have committed while this call waited for the
    -- program lock, so check the receipt again before publishing.
    if exists (
      select 1 from public.scheduled_workouts occurrence
      where occurrence.athlete_id = current_user_id
        and occurrence.request_key = target_idempotency_key
    ) then
      return public.create_scheduled_occurrence(
        target_workout_id, target_planned_date, target_idempotency_key,
        target_program_id, target_assignment_id
      );
    end if;
    perform public.lock_program_for_use(target_program_id);
  end if;

  return public.create_scheduled_occurrence(
    target_workout_id,
    target_planned_date,
    target_idempotency_key,
    target_program_id,
    target_assignment_id
  );
end;
$$;

create or replace function private.canonical_program_run_dates(
  target_program_version_id uuid,
  target_workout_dates jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare canonical jsonb;
begin
  if target_workout_dates is null then target_workout_dates := '[]'::jsonb; end if;
  if jsonb_typeof(target_workout_dates) <> 'array' then
    raise exception 'Workout dates must be an array';
  end if;
  if jsonb_array_length(target_workout_dates) > 200 then
    raise exception 'At most 200 workout dates can be changed at once';
  end if;
  if exists (
    select 1 from jsonb_array_elements(target_workout_dates) entry
    where jsonb_typeof(entry) <> 'object'
      or nullif(entry ->> 'workoutId', '') is null
  ) then raise exception 'Every workout date needs a workoutId'; end if;
  if exists (
    select 1
    from jsonb_array_elements(target_workout_dates) entry
    group by (entry ->> 'workoutId')::uuid
    having count(*) > 1
  ) then raise exception 'Each workout may appear only once in a schedule'; end if;
  if exists (
    select 1
    from jsonb_array_elements(target_workout_dates) entry
    where not exists (
      select 1 from public.workouts workout
      join public.program_weeks week on week.id = workout.program_week_id
      where workout.id = (entry ->> 'workoutId')::uuid
        and week.program_version_id = target_program_version_id
    )
  ) then raise exception 'Schedule contains a workout outside this program revision'; end if;

  -- A partial schedule may leave any number of workouts undated, but every
  -- dated workout must still respect the immutable program sequence. Enforce
  -- this here so create/repeat cannot persist an inverted initial plan.
  if exists (
    select 1
    from (
      select
        dated.planned_date,
        max(dated.planned_date) over (
          order by dated.week_index, dated.workout_position, dated.workout_id
          rows between unbounded preceding and 1 preceding
        ) as previous_planned_date
      from (
        select
          week.week_index,
          workout.position as workout_position,
          workout.id as workout_id,
          nullif(entry ->> 'plannedDate', '')::date as planned_date
        from jsonb_array_elements(target_workout_dates) entry
        join public.workouts workout
          on workout.id = (entry ->> 'workoutId')::uuid
        join public.program_weeks week on week.id = workout.program_week_id
        where week.program_version_id = target_program_version_id
          and nullif(entry ->> 'plannedDate', '') is not null
      ) dated
    ) ordered_dates
    where ordered_dates.planned_date < ordered_dates.previous_planned_date
  ) then
    raise exception 'Workout dates must follow program order';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'workoutId', normalized.workout_id,
    'plannedDate', normalized.planned_date
  ) order by normalized.workout_id), '[]'::jsonb)
  into canonical
  from (
    select
      (entry ->> 'workoutId')::uuid as workout_id,
      nullif(entry ->> 'plannedDate', '')::date as planned_date
    from jsonb_array_elements(target_workout_dates) entry
  ) normalized;
  return canonical;
end;
$$;

create or replace function private.validate_program_run_date_order(
  target_run_id uuid,
  target_workout_dates jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Apply the requested partial patch over every materialized slot before
  -- checking order. A one-workout reschedule therefore cannot silently move
  -- an earlier slot behind an already-dated later slot (or vice versa).
  if exists (
    select 1
    from (
      select
        effective.planned_date,
        max(effective.planned_date) over (
          order by effective.position
          rows between unbounded preceding and 1 preceding
        ) as previous_planned_date
      from (
        select
          slot.position,
          case
            when coalesce(requested.supplied, false) then requested.planned_date
            else slot.planned_date
          end as planned_date
        from public.program_run_workouts slot
        left join lateral (
          select
            nullif(entry ->> 'plannedDate', '')::date as planned_date,
            true as supplied
          from jsonb_array_elements(target_workout_dates) entry
          where (entry ->> 'workoutId')::uuid = slot.workout_id
        ) requested on true
        where slot.program_run_id = target_run_id
      ) effective
      where effective.planned_date is not null
    ) ordered_dates
    where ordered_dates.planned_date < ordered_dates.previous_planned_date
  ) then
    raise exception 'Workout dates must follow program order';
  end if;
end;
$$;

-- A run freezes a complete content tree and later detail reads aggregate that
-- tree into one bounded response. Direct API clients can write drafts without
-- going through the UI, so enforce generous V1 limits on the server before a
-- revision is materialized. These limits support the intended 10-week / 40-
-- workout coaching case while preventing a single run from amplifying an
-- unbounded authored tree.
create or replace function private.assert_program_run_content_within_limits(
  target_program_version_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  week_count bigint;
  workout_count bigint;
  section_count bigint;
  item_count bigint;
  entry_count bigint;
begin
  select count(*) into week_count
  from public.program_weeks week
  where week.program_version_id = target_program_version_id;
  if week_count > 52 then
    raise exception 'A program run can contain at most 52 weeks';
  end if;

  select count(*) into workout_count
  from public.workouts workout
  join public.program_weeks week on week.id = workout.program_week_id
  where week.program_version_id = target_program_version_id;
  if workout_count = 0 then
    raise exception 'Add at least one workout before assigning this program';
  end if;
  if workout_count > 200 then
    raise exception 'A program run can contain at most 200 workouts';
  end if;

  select count(*) into section_count
  from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where week.program_version_id = target_program_version_id;
  if section_count > 2000 then
    raise exception 'A program run can contain at most 2000 workout sections';
  end if;
  if exists (
    select 1
    from public.workout_sections section
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_program_version_id
    group by workout.id
    having count(*) > 20
  ) then
    raise exception 'A workout can contain at most 20 sections';
  end if;

  select count(*) into item_count
  from public.workout_items item
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where week.program_version_id = target_program_version_id;
  if item_count > 5000 then
    raise exception 'A program run can contain at most 5000 exercises';
  end if;
  if exists (
    select 1
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_program_version_id
    group by section.id
    having count(*) > 100
  ) then
    raise exception 'A workout section can contain at most 100 exercises';
  end if;

  select count(*) into entry_count
  from public.prescribed_entries entry
  join public.workout_items item on item.id = entry.workout_item_id
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where week.program_version_id = target_program_version_id;
  if entry_count > 20000 then
    raise exception 'A program run can contain at most 20000 prescribed entries';
  end if;
  if exists (
    select 1
    from public.prescribed_entries entry
    join public.workout_items item on item.id = entry.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_program_version_id
    group by item.id
    having count(*) > 100
  ) then
    raise exception 'An exercise can contain at most 100 prescribed entries';
  end if;
end;
$$;

create or replace function private.materialize_program_run(
  target_program_id uuid,
  target_program_version_id uuid,
  target_athlete_id uuid,
  target_created_by_id uuid,
  target_workout_dates jsonb,
  target_idempotency_key uuid,
  target_repeated_from_run_id uuid default null
)
returns table (run_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  normalized_dates jsonb;
  inserted_run_id uuid;
  existing_run public.program_runs%rowtype;
  next_sequence integer;
  dated_slot record;
begin
  perform private.assert_program_run_content_within_limits(
    target_program_version_id
  );
  normalized_dates := private.canonical_program_run_dates(
    target_program_version_id, target_workout_dates
  );

  insert into public.program_runs (
    athlete_id, created_by_id, source_program_id, program_version_id,
    repeated_from_run_id, request_key, creation_schedule
  ) values (
    target_athlete_id, target_created_by_id, target_program_id,
    target_program_version_id, target_repeated_from_run_id,
    target_idempotency_key, normalized_dates
  )
  on conflict (created_by_id, athlete_id, request_key) do nothing
  returning id into inserted_run_id;

  if inserted_run_id is null then
    select run.* into existing_run
    from public.program_runs run
    where run.created_by_id = target_created_by_id
      and run.athlete_id = target_athlete_id
      and run.request_key = target_idempotency_key;
    if existing_run.source_program_id is distinct from target_program_id
      or existing_run.program_version_id is distinct from target_program_version_id
      or existing_run.repeated_from_run_id is distinct from target_repeated_from_run_id
      or existing_run.creation_schedule is distinct from normalized_dates then
      raise exception 'Idempotency key was already used for another program run';
    end if;
    return query select existing_run.id, false;
    return;
  end if;

  insert into public.program_run_workouts (
    program_run_id, workout_id, position, planned_date, status
  )
  select
    inserted_run_id,
    workout.id,
    row_number() over (
      order by week.week_index, workout.position, workout.id
    )::integer - 1,
    schedule.planned_date,
    case when schedule.planned_date is null then 'unscheduled' else 'scheduled' end
  from public.program_weeks week
  join public.workouts workout on workout.program_week_id = week.id
  left join lateral (
    select nullif(entry ->> 'plannedDate', '')::date as planned_date
    from jsonb_array_elements(normalized_dates) entry
    where (entry ->> 'workoutId')::uuid = workout.id
  ) schedule on true
  where week.program_version_id = target_program_version_id
  order by week.week_index, workout.position, workout.id;

  perform profile.id from public.profiles profile
  where profile.id = target_athlete_id for update;
  select coalesce(max(occurrence.sequence_number), 0)
  into next_sequence
  from public.scheduled_workouts occurrence
  where occurrence.athlete_id = target_athlete_id
    and occurrence.program_version_id = target_program_version_id;

  perform pg_catalog.set_config('liftlog.program_run_bulk_sync', 'on', true);
  for dated_slot in
    select slot.* from public.program_run_workouts slot
    where slot.program_run_id = inserted_run_id
      and slot.planned_date is not null
    order by slot.position
  loop
    next_sequence := next_sequence + 1;
    insert into public.scheduled_workouts (
      athlete_id, scheduled_by_id, assignment_id, program_version_id,
      workout_id, planned_date, sequence_number, status, request_key,
      program_run_id, program_run_workout_id
    ) values (
      target_athlete_id, target_created_by_id, null, target_program_version_id,
      dated_slot.workout_id, dated_slot.planned_date, next_sequence, 'planned',
      gen_random_uuid(), inserted_run_id, dated_slot.id
    );
  end loop;
  perform pg_catalog.set_config('liftlog.program_run_bulk_sync', 'off', true);
  perform private.refresh_program_run_status(inserted_run_id);

  return query select inserted_run_id, true;
end;
$$;

create or replace function public.create_program_runs(
  target_program_id uuid,
  target_athlete_ids uuid[],
  target_workout_dates jsonb,
  target_idempotency_key uuid,
  target_repeated_from_run_id uuid default null
)
returns table (
  athlete_id uuid, run_id uuid, program_id uuid,
  program_version_id uuid, created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  normalized_athlete_ids uuid[];
  snapshot_version_id uuid;
  requested_athlete_id uuid;
  materialized_run record;
  existing_athlete_ids uuid[];
  existing_version_id uuid;
  existing_schedule jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  if target_athlete_ids is null or cardinality(target_athlete_ids) = 0 then
    raise exception 'Choose at least one athlete';
  end if;
  if cardinality(target_athlete_ids) > 50 then
    raise exception 'A program can be assigned to at most 50 athletes at once';
  end if;
  if exists (select 1 from unnest(target_athlete_ids) athlete where athlete is null) then
    raise exception 'Athlete IDs cannot be empty';
  end if;
  select array_agg(athlete order by first_position)
  into normalized_athlete_ids
  from (
    select athlete, min(position) first_position
    from unnest(target_athlete_ids) with ordinality requested(athlete, position)
    group by athlete
  ) normalized;

  if target_repeated_from_run_id is not null then
    raise exception 'Use repeat_program_run to repeat an existing run';
  end if;
  if exists (
    select 1 from unnest(normalized_athlete_ids) athlete
    where athlete <> current_user_id
      and not exists (
        select 1 from public.coach_relationships relationship
        where relationship.athlete_id = athlete
          and relationship.coach_id = current_user_id
          and relationship.ended_at is null
      )
  ) then raise exception 'Programs can only be assigned to athletes you currently coach'; end if;

  -- Serialize snapshot selection before checking the request receipt. Without
  -- this boundary, two simultaneous retries could both see no run, publish
  -- successive drafts, and make the second request conflict with the first
  -- run's immutable version instead of returning it idempotently.
  perform program.id
  from public.programs program
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and program.created_by_id = current_user_id
    and program.source_type = 'self'
    and program.archived_at is null
  for update;
  if not found then raise exception 'Only your own reusable content can be assigned'; end if;

  select
    array_agg(run.athlete_id order by run.athlete_id),
    min(run.program_version_id::text)::uuid,
    min(run.creation_schedule::text)::jsonb
  into existing_athlete_ids, existing_version_id, existing_schedule
  from public.program_runs run
  where run.created_by_id = current_user_id
    and run.request_key = target_idempotency_key;
  if existing_athlete_ids is not null then
    if existing_athlete_ids is distinct from (
      select array_agg(athlete order by athlete)
      from unnest(normalized_athlete_ids) athlete
    ) or exists (
      select 1 from public.program_runs run
      where run.created_by_id = current_user_id
        and run.request_key = target_idempotency_key
        and (
          run.source_program_id is distinct from target_program_id
          or run.program_version_id is distinct from existing_version_id
          or run.repeated_from_run_id is not null
          or run.creation_schedule is distinct from existing_schedule
        )
    ) or private.canonical_program_run_dates(
      existing_version_id, target_workout_dates
    ) is distinct from existing_schedule then
      raise exception 'Idempotency key was already used for another program run';
    end if;
    return query
    select run.athlete_id, run.id, run.source_program_id,
      run.program_version_id, false
    from public.program_runs run
    where run.created_by_id = current_user_id
      and run.request_key = target_idempotency_key
    order by run.athlete_id;
    return;
  end if;

  snapshot_version_id := private.snapshot_program_for_run(target_program_id);
  perform private.canonical_program_run_dates(snapshot_version_id, target_workout_dates);

  -- Bulk coach assignment may touch the same athlete set from two requests.
  -- Acquire profile locks in a deterministic order before materialization so
  -- reversed input order cannot deadlock while allocating occurrences.
  perform profile.id
  from public.profiles profile
  where profile.id = any(normalized_athlete_ids)
  order by profile.id
  for update;

  foreach requested_athlete_id in array normalized_athlete_ids loop
    select result.run_id, result.created into materialized_run
    from private.materialize_program_run(
      target_program_id, snapshot_version_id, requested_athlete_id,
      current_user_id, target_workout_dates, target_idempotency_key, null
    ) result;
    athlete_id := requested_athlete_id;
    run_id := materialized_run.run_id;
    program_id := target_program_id;
    program_version_id := snapshot_version_id;
    created := materialized_run.created;
    return next;
  end loop;
end;
$$;

create or replace function public.repeat_program_run(
  target_run_id uuid,
  target_workout_dates jsonb,
  target_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  previous public.program_runs%rowtype;
  materialized_run record;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  select run.* into previous
  from public.program_runs run
  where run.id = target_run_id
    and run.status in ('completed', 'ended')
    and (
      run.athlete_id = current_user_id
      or (
        run.created_by_id = current_user_id
        and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = run.athlete_id
            and relationship.coach_id = current_user_id
            and relationship.ended_at is null
        )
      )
    )
  for share;
  if not found then raise exception 'Program run was not found'; end if;

  select result.run_id, result.created into materialized_run
  from private.materialize_program_run(
    previous.source_program_id, previous.program_version_id,
    previous.athlete_id, current_user_id, target_workout_dates,
    target_idempotency_key, previous.id
  ) result;
  return jsonb_build_object(
    'athleteId', previous.athlete_id,
    'runId', materialized_run.run_id,
    'programId', previous.source_program_id,
    'programVersionId', previous.program_version_id,
    'created', materialized_run.created
  );
end;
$$;

create or replace function public.schedule_program_run_workouts(
  target_run_id uuid,
  target_workout_dates jsonb,
  target_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_run public.program_runs%rowtype;
  normalized_dates jsonb;
  requested record;
  slot public.program_run_workouts%rowtype;
  next_sequence integer;
  request_receipt public.program_run_schedule_requests%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  select run.* into target_run
  from public.program_runs run
  where run.id = target_run_id
    and (
      run.athlete_id = current_user_id
      or (
        run.created_by_id = current_user_id
        and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = run.athlete_id
            and relationship.coach_id = current_user_id
            and relationship.ended_at is null
        )
      )
    )
  for update;
  if not found then raise exception 'Active program run was not found'; end if;
  normalized_dates := private.canonical_program_run_dates(
    target_run.program_version_id, target_workout_dates
  );
  perform private.validate_program_run_date_order(
    target_run.id, normalized_dates
  );

  insert into public.program_run_schedule_requests (
    requested_by_id, request_key, program_run_id, canonical_schedule
  ) values (
    current_user_id, target_idempotency_key, target_run.id, normalized_dates
  )
  on conflict (requested_by_id, request_key) do nothing
  returning * into request_receipt;

  if not found then
    select receipt.* into request_receipt
    from public.program_run_schedule_requests receipt
    where receipt.requested_by_id = current_user_id
      and receipt.request_key = target_idempotency_key;
    if request_receipt.program_run_id is distinct from target_run.id
      or request_receipt.canonical_schedule is distinct from normalized_dates then
      raise exception 'Idempotency key was already used for another schedule change';
    end if;
    return jsonb_build_object('runId', target_run.id);
  end if;

  if target_run.status in ('completed', 'ended') then
    raise exception 'Active program run was not found';
  end if;

  perform profile.id from public.profiles profile
  where profile.id = target_run.athlete_id for update;
  select coalesce(max(occurrence.sequence_number), 0)
  into next_sequence
  from public.scheduled_workouts occurrence
  where occurrence.athlete_id = target_run.athlete_id
    and occurrence.program_version_id = target_run.program_version_id;

  perform pg_catalog.set_config('liftlog.program_run_bulk_sync', 'on', true);
  for requested in
    select
      (entry ->> 'workoutId')::uuid as workout_id,
      nullif(entry ->> 'plannedDate', '')::date as planned_date
    from jsonb_array_elements(normalized_dates) entry
  loop
    select candidate.* into slot
    from public.program_run_workouts candidate
    where candidate.program_run_id = target_run.id
      and candidate.workout_id = requested.workout_id
      and candidate.status in ('unscheduled', 'scheduled')
    order by candidate.position
    limit 1
    for update;
    if not found then raise exception 'Only future run workouts can be rescheduled'; end if;

    if slot.scheduled_workout_id is null and requested.planned_date is not null then
      next_sequence := next_sequence + 1;
      insert into public.scheduled_workouts (
        athlete_id, scheduled_by_id, assignment_id, program_version_id,
        workout_id, planned_date, sequence_number, status, request_key,
        program_run_id, program_run_workout_id
      ) values (
        target_run.athlete_id, current_user_id, target_run.legacy_assignment_id,
        target_run.program_version_id, slot.workout_id, requested.planned_date,
        next_sequence, 'planned', gen_random_uuid(), target_run.id, slot.id
      );
    elsif slot.scheduled_workout_id is not null then
      update public.scheduled_workouts
      set planned_date = requested.planned_date
      where id = slot.scheduled_workout_id and status = 'planned';
      if not found then raise exception 'Only future run workouts can be rescheduled'; end if;
    end if;
  end loop;
  perform pg_catalog.set_config('liftlog.program_run_bulk_sync', 'off', true);
  perform private.refresh_program_run_status(target_run.id);
  return jsonb_build_object('runId', target_run.id);
end;
$$;

create or replace function public.end_program_run(target_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_run public.program_runs%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select run.* into target_run
  from public.program_runs run
  where run.id = target_run_id
    and run.status in ('not_started', 'in_progress', 'ended')
    and (
      run.athlete_id = current_user_id
      or (
        run.created_by_id = current_user_id
        and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = run.athlete_id
            and relationship.coach_id = current_user_id
            and relationship.ended_at is null
        )
      )
    )
  for update;
  if not found then raise exception 'Active program run was not found'; end if;
  if target_run.status = 'ended' then return; end if;
  if exists (
    select 1 from public.workout_sessions session
    where session.program_run_id = target_run.id and session.status = 'in_progress'
  ) then raise exception 'Finish the active workout before ending this program'; end if;

  update public.program_run_workouts
  set status = 'cancelled'
  where program_run_id = target_run.id
    and status in ('unscheduled', 'scheduled');
  update public.program_runs
  set status = 'ended', ended_at = now(), ended_by_id = current_user_id,
    completed_at = null
  where id = target_run.id;
  update public.scheduled_workouts
  set status = 'skipped'
  where program_run_id = target_run.id and status = 'planned';
  update public.program_assignments
  set status = 'archived', updated_at = now()
  where id = target_run.legacy_assignment_id and status = 'active';
end;
$$;

-- First use no longer freezes a reusable template. "Delete" therefore means
-- archive the owner's library entry even when immutable run revisions retain a
-- reference to it; run content and results remain readable through the run.
create or replace function public.delete_own_program(target_program_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_program public.programs%rowtype;
  retained_schedules bigint;
  retained_sessions bigint;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select program.* into target_program
  from public.programs program
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and program.created_by_id = current_user_id
    and program.source_type = 'self'
    and program.archived_at is null
  for update;
  if not found then raise exception 'Your reusable content was not found'; end if;

  select count(*) into retained_schedules
  from public.scheduled_workouts occurrence
  join public.program_versions version on version.id = occurrence.program_version_id
  where version.program_id = target_program.id;
  select count(*) into retained_sessions
  from public.workout_sessions session
  join public.program_versions version on version.id = session.program_version_id
  where version.program_id = target_program.id;

  update public.programs
  set archived_at = now(), is_current = false
  where id = target_program.id;
  delete from public.program_availability availability
  where availability.athlete_id = current_user_id
    and availability.program_id = target_program.id;

  return jsonb_build_object(
    'programId', target_program.id,
    'removedPlannedWorkouts', 0,
    'retainedScheduledHistory', retained_schedules,
    'retainedSessions', retained_sessions
  );
end;
$$;

-- Keep the pre-run unassign command safe for backfilled assignments. Their
-- occurrences are now durable run history and cannot be deleted out from
-- underneath the materialized slots; ending cancels only unfinished work.
create or replace function public.unassign_program_assignment(
  target_assignment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  assignment public.program_assignments%rowtype;
  linked_run public.program_runs%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select candidate.* into assignment
  from public.program_assignments candidate
  where candidate.id = target_assignment_id
    and candidate.status = 'active'
    and (
      candidate.athlete_id = current_user_id
      or (
        candidate.assigned_by_id = current_user_id
        and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = candidate.athlete_id
            and relationship.coach_id = current_user_id
            and relationship.ended_at is null
        )
      )
    )
  for update of candidate;
  if not found then raise exception 'Active assignment not found'; end if;

  if exists (
    select 1 from public.workout_sessions session
    where session.assignment_id = assignment.id and session.status = 'in_progress'
  ) then raise exception 'Finish the active workout before unassigning this program'; end if;

  select run.* into linked_run
  from public.program_runs run
  where run.legacy_assignment_id = assignment.id
  for update;
  if found and linked_run.status <> 'completed' then
    perform public.end_program_run(linked_run.id);
  end if;

  update public.program_assignments
  set status = 'archived', updated_at = now()
  where id = assignment.id;
end;
$$;

create or replace function public.update_program_run_workout_overrides(
  target_program_run_workout_id uuid,
  target_overrides jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_slot public.program_run_workouts%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_overrides is null or jsonb_typeof(target_overrides) <> 'object' then
    raise exception 'Workout overrides must be an object';
  end if;
  if pg_column_size(target_overrides) > 65536 then
    raise exception 'Workout overrides are too large';
  end if;
  -- Assigned revisions are immutable in V1. Keep the reserved clearing API
  -- compatible, but never accept opaque prescription data that the workout
  -- reader/session seeder cannot faithfully apply yet.
  if target_overrides <> '{}'::jsonb then
    raise exception 'Per-run prescription overrides are not supported yet';
  end if;
  select slot.* into target_slot
  from public.program_run_workouts slot
  join public.program_runs run on run.id = slot.program_run_id
  where slot.id = target_program_run_workout_id
    and slot.status in ('unscheduled', 'scheduled')
    and run.status in ('not_started', 'in_progress')
    and (
      run.athlete_id = current_user_id
      or (
        run.created_by_id = current_user_id
        and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = run.athlete_id
            and relationship.coach_id = current_user_id
            and relationship.ended_at is null
        )
      )
    )
  for update of slot;
  if not found then raise exception 'Only a future run workout can be adjusted'; end if;

  update public.program_run_workouts
  set
    prescription_overrides = target_overrides,
    override_updated_by_id = case when target_overrides = '{}'::jsonb then null else current_user_id end,
    override_updated_at = case when target_overrides = '{}'::jsonb then null else now() end
  where id = target_slot.id;
  return jsonb_build_object('runId', target_slot.program_run_id);
end;
$$;

-- Preserve run identity and canonical self/coach provenance on every bounded
-- calendar/history read. Parameters, ordering and limits remain unchanged.
drop function public.list_calendar_occurrences(date, date, integer, date, uuid);
create function public.list_calendar_occurrences(
  range_start date,
  range_end date,
  page_limit integer default 100,
  after_planned_date date default null,
  after_id uuid default null
)
returns table (
  id uuid, assignment_id uuid, program_run_id uuid,
  program_run_workout_id uuid, program_id uuid, program_version_id uuid,
  program_title text, workout_id uuid, workout_title text,
  planned_date date, sequence_number integer, status text,
  scheduled_by_id uuid, source_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if range_start is null or range_end is null
    or range_end < range_start or range_end - range_start > 92 then
    raise exception 'Calendar range must span 1 to 93 days';
  end if;
  if (after_planned_date is null) <> (after_id is null) then
    raise exception 'Calendar cursor is incomplete';
  end if;

  return query
  select occurrence.id, occurrence.assignment_id, occurrence.program_run_id,
    occurrence.program_run_workout_id, version.program_id,
    occurrence.program_version_id, version.title, occurrence.workout_id,
    workout.title, occurrence.planned_date, occurrence.sequence_number,
    occurrence.status, occurrence.scheduled_by_id,
    case
      when run.id is not null then
        case when run.created_by_id <> run.athlete_id then 'coach' else 'self' end
      when occurrence.assignment_id is not null then 'coach'
      when occurrence.scheduled_by_id <> occurrence.athlete_id then 'coach'
      else 'self'
    end
  from public.scheduled_workouts occurrence
  join public.program_versions version on version.id = occurrence.program_version_id
  join public.workouts workout on workout.id = occurrence.workout_id
  left join public.program_runs run on run.id = occurrence.program_run_id
  where occurrence.athlete_id = current_user_id
    and (run.id is null or run.status <> 'ended')
    and occurrence.planned_date between range_start and range_end
    and (
      after_planned_date is null
      or (occurrence.planned_date, occurrence.id) > (after_planned_date, after_id)
    )
  order by occurrence.planned_date, occurrence.id
  limit least(greatest(coalesce(page_limit, 100), 1), 200);
end;
$$;

-- Next is an open-ended timeline, unlike the finite Calendar viewport. Page
-- it independently so the bootstrap's small preview never hides later work.
create or replace function public.list_upcoming_scheduled_workouts(
  page_limit integer default 20,
  after_planned_date date default null,
  after_id uuid default null
)
returns table (
  id uuid, assignment_id uuid, program_run_id uuid,
  program_run_workout_id uuid, program_id uuid, program_version_id uuid,
  program_title text, workout_id uuid, workout_title text,
  estimated_minutes integer, planned_date date, sequence_number integer, status text,
  scheduled_by_id uuid, source_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  current_user_today date;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if (after_planned_date is null) <> (after_id is null) then
    raise exception 'Upcoming-workout cursor is incomplete';
  end if;

  select case
    when exists (
      select 1
      from pg_catalog.pg_timezone_names timezone_name
      where timezone_name.name = profile.timezone
    ) then (current_timestamp at time zone profile.timezone)::date
    else current_date
  end
  into current_user_today
  from public.profiles profile
  where profile.id = current_user_id;
  current_user_today := coalesce(current_user_today, current_date);

  return query
  select occurrence.id, occurrence.assignment_id, occurrence.program_run_id,
    occurrence.program_run_workout_id, version.program_id,
    occurrence.program_version_id, version.title, occurrence.workout_id,
    workout.title, workout.estimated_minutes, occurrence.planned_date,
    occurrence.sequence_number,
    occurrence.status, occurrence.scheduled_by_id,
    case
      when run.id is not null then
        case when run.created_by_id <> run.athlete_id then 'coach' else 'self' end
      when occurrence.assignment_id is not null then 'coach'
      when occurrence.scheduled_by_id <> occurrence.athlete_id then 'coach'
      else 'self'
    end
  from public.scheduled_workouts occurrence
  join public.program_versions version on version.id = occurrence.program_version_id
  join public.workouts workout on workout.id = occurrence.workout_id
  left join public.program_runs run on run.id = occurrence.program_run_id
  where occurrence.athlete_id = current_user_id
    and (run.id is null or run.status <> 'ended')
    and occurrence.planned_date >= current_user_today
    and occurrence.status in ('planned', 'in_progress', 'skipped')
    and (
      after_planned_date is null
      or (occurrence.planned_date, occurrence.id) > (after_planned_date, after_id)
    )
  order by occurrence.planned_date, occurrence.id
  limit least(greatest(coalesce(page_limit, 20), 1), 100);
end;
$$;

drop function public.list_completed_session_summaries(integer, timestamptz, uuid);
create function public.list_completed_session_summaries(
  page_limit integer default 50,
  before_started_at timestamptz default null,
  before_id uuid default null
)
returns table (
  id uuid, assignment_id uuid, program_run_id uuid,
  program_run_workout_id uuid, scheduled_workout_id uuid,
  program_version_id uuid, workout_id uuid, workout_title text,
  started_at timestamptz, completed_at timestamptz,
  completed_for_date date, session_rpe numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if (before_started_at is null) <> (before_id is null) then
    raise exception 'History cursor is incomplete';
  end if;

  return query
  select session.id, session.assignment_id, session.program_run_id,
    session.program_run_workout_id, session.scheduled_workout_id,
    session.program_version_id, session.workout_id, session.workout_title,
    session.started_at, session.completed_at, session.completed_for_date,
    session.session_rpe
  from public.workout_sessions session
  where session.athlete_id = current_user_id
    and session.status = 'completed'
    and (
      before_started_at is null
      or (session.started_at, session.id) < (before_started_at, before_id)
    )
  order by session.started_at desc, session.id desc
  limit least(greatest(coalesce(page_limit, 50), 1), 100);
end;
$$;

drop function public.list_calendar_session_summaries(date, date, integer);
create function public.list_calendar_session_summaries(
  range_start date,
  range_end date,
  page_limit integer default 100
)
returns table (
  id uuid, assignment_id uuid, program_run_id uuid,
  program_run_workout_id uuid, scheduled_workout_id uuid,
  program_version_id uuid, workout_id uuid, workout_title text,
  started_at timestamptz, completed_at timestamptz,
  completed_for_date date, session_rpe numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if range_start is null or range_end is null
    or range_end < range_start or range_end - range_start > 92 then
    raise exception 'Calendar range must span 1 to 93 days';
  end if;

  return query
  select session.id, session.assignment_id, session.program_run_id,
    session.program_run_workout_id, session.scheduled_workout_id,
    session.program_version_id, session.workout_id, session.workout_title,
    session.started_at, session.completed_at, session.completed_for_date,
    session.session_rpe
  from public.workout_sessions session
  where session.athlete_id = current_user_id
    and session.status = 'completed'
    and session.completed_for_date between range_start and range_end
  order by session.completed_for_date, session.id
  limit least(greatest(coalesce(page_limit, 100), 1), 200);
end;
$$;

drop function if exists public.list_program_run_summaries(
  uuid, integer, integer, timestamptz, uuid, text
);
create or replace function public.list_program_run_summaries(
  target_athlete_id uuid default null,
  page_limit integer default 26,
  after_created_at timestamptz default null,
  after_id uuid default null,
  creator_scope text default 'all'
)
returns table (
  id uuid, athlete_id uuid, created_by_id uuid, program_id uuid,
  program_version_id uuid, title text, content_type text, status text,
  total_workouts bigint, scheduled_workouts bigint, completed_workouts bigint,
  completion_percent integer, next_workout_id uuid, next_workout_title text,
  next_workout_date date, next_workout_status text,
  repeated_from_run_id uuid, created_at timestamptz, ended_at timestamptz,
  finished_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  resolved_athlete_id uuid := coalesce(target_athlete_id, current_user_id);
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if creator_scope is null or creator_scope not in ('all', 'self', 'coach') then
    raise exception 'Program run creator scope is invalid';
  end if;
  if (after_created_at is null) <> (after_id is null) then
    raise exception 'Program run cursor is incomplete';
  end if;
  if resolved_athlete_id <> current_user_id and not exists (
    select 1 from public.coach_relationships relationship
    where relationship.athlete_id = resolved_athlete_id
      and relationship.coach_id = current_user_id
      and relationship.ended_at is null
  ) then raise exception 'Athlete program runs are unavailable'; end if;

  return query
  with run_page as materialized (
    -- Keep each creator scope in its own branch. Besides making the access
    -- semantics auditable, the direct coach predicate lets a generic cached
    -- PL/pgSQL plan use idx_program_runs_athlete_coach_summary_page.
    (
      select candidate.*
      from public.program_runs candidate
      where creator_scope = 'all'
        and candidate.athlete_id = resolved_athlete_id
        and (
          resolved_athlete_id = current_user_id
          or candidate.created_by_id = current_user_id
        )
        and (
          after_created_at is null
          or (candidate.created_at, candidate.id) < (after_created_at, after_id)
        )
      order by candidate.created_at desc, candidate.id desc
      limit least(greatest(coalesce(page_limit, 26), 1), 51)
    )
    union all
    (
      select candidate.*
      from public.program_runs candidate
      where creator_scope = 'self'
        and candidate.athlete_id = resolved_athlete_id
        and candidate.created_by_id = candidate.athlete_id
        and (
          resolved_athlete_id = current_user_id
          or candidate.created_by_id = current_user_id
        )
        and (
          after_created_at is null
          or (candidate.created_at, candidate.id) < (after_created_at, after_id)
        )
      order by candidate.created_at desc, candidate.id desc
      limit least(greatest(coalesce(page_limit, 26), 1), 51)
    )
    union all
    (
      select candidate.*
      from public.program_runs candidate
      where creator_scope = 'coach'
        and candidate.athlete_id = resolved_athlete_id
        and candidate.created_by_id <> candidate.athlete_id
        and (
          resolved_athlete_id = current_user_id
          or candidate.created_by_id = current_user_id
        )
        and (
          after_created_at is null
          or (candidate.created_at, candidate.id) < (after_created_at, after_id)
        )
      order by candidate.created_at desc, candidate.id desc
      limit least(greatest(coalesce(page_limit, 26), 1), 51)
    )
  )
  select
    run.id, run.athlete_id, run.created_by_id, run.source_program_id,
    run.program_version_id, version.title, program.content_type, run.status,
    count(slot.id),
    count(slot.id) filter (where slot.planned_date is not null),
    count(slot.id) filter (where slot.status = 'completed'),
    case when count(slot.id) = 0 then 0 else round(
      count(slot.id) filter (where slot.status = 'completed')::numeric
      * 100 / count(slot.id)
    )::integer end,
    next_slot.id, next_workout.title, next_slot.planned_date, next_slot.status,
    run.repeated_from_run_id, run.created_at, run.ended_at,
    coalesce(run.completed_at, run.ended_at)
  from run_page run
  join public.program_versions version on version.id = run.program_version_id
  join public.programs program on program.id = run.source_program_id
  left join public.program_run_workouts slot on slot.program_run_id = run.id
  left join lateral (
    select candidate.*
    from public.program_run_workouts candidate
    where candidate.program_run_id = run.id
      and candidate.status not in ('completed', 'skipped', 'cancelled')
    order by candidate.planned_date nulls last, candidate.position, candidate.id
    limit 1
  ) next_slot on true
  left join public.workouts next_workout on next_workout.id = next_slot.workout_id
  group by run.id, run.athlete_id, run.created_by_id, run.source_program_id,
    run.program_version_id, run.status, run.repeated_from_run_id,
    run.created_at, run.completed_at, run.ended_at, version.title,
    program.content_type, next_slot.id,
    next_slot.planned_date, next_slot.status, next_workout.title
  order by run.created_at desc, run.id desc;
end;
$$;

create or replace function public.get_program_run_detail(target_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result_payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not private.can_read_program_run(target_run_id) then
    raise exception 'Program run was not found';
  end if;
  select jsonb_build_object(
    'id', run.id,
    'athleteId', run.athlete_id,
    'createdById', run.created_by_id,
    'programId', run.source_program_id,
    'programVersionId', run.program_version_id,
    'title', version.title,
    'contentType', program.content_type,
    'status', run.status,
    'totalWorkouts', count(slot.id),
    'scheduledWorkouts', count(slot.id) filter (where slot.planned_date is not null),
    'completedWorkouts', count(slot.id) filter (where slot.status = 'completed'),
    'completionPercent', case when count(slot.id) = 0 then 0 else round(
      count(slot.id) filter (where slot.status = 'completed')::numeric
      * 100 / count(slot.id)
    )::integer end,
    'repeatedFromRunId', run.repeated_from_run_id,
    'createdAt', run.created_at,
    'endedAt', run.ended_at,
    'finishedAt', coalesce(run.completed_at, run.ended_at),
    'workouts', coalesce(jsonb_agg(jsonb_build_object(
      'id', slot.id,
      'runId', slot.program_run_id,
      'workoutId', slot.workout_id,
      'title', workout.title,
      'position', slot.position,
      'estimatedMinutes', workout.estimated_minutes,
      'plannedDate', slot.planned_date,
      'status', slot.status,
      'scheduledWorkoutId', slot.scheduled_workout_id,
      'sessionId', completed_session.id,
      'completedAt', completed_session.completed_at,
      'completedForDate', completed_session.completed_for_date,
      'sessionRpe', completed_session.session_rpe,
      'prescriptionOverrides', slot.prescription_overrides
    ) order by slot.position, slot.id) filter (where slot.id is not null), '[]'::jsonb)
  ) into result_payload
  from public.program_runs run
  join public.program_versions version on version.id = run.program_version_id
  join public.programs program on program.id = run.source_program_id
  left join public.program_run_workouts slot on slot.program_run_id = run.id
  left join public.workouts workout on workout.id = slot.workout_id
  left join lateral (
    select session.id, session.completed_at,
      session.completed_for_date, session.session_rpe
    from public.workout_sessions session
    where session.program_run_workout_id = slot.id
      and session.status = 'completed'
    order by session.completed_at desc, session.id desc
    limit 1
  ) completed_session on true
  where run.id = target_run_id
  group by run.id, version.title, program.content_type;
  return result_payload;
end;
$$;

-- A run is an immutable snapshot. Copying it clones the exact revision used
-- by that run, never whichever reusable revision is current at copy time.
create or replace function public.copy_program_run_to_own(target_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_run public.program_runs%rowtype;
  source_program public.programs%rowtype;
  source_version public.program_versions%rowtype;
  new_program_id uuid;
  new_version_id uuid;
  copy_title text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select run.* into source_run
  from public.program_runs run
  where run.id = target_run_id
    and (
      run.athlete_id = current_user_id
      or run.created_by_id = current_user_id
    );
  if source_run.id is null then raise exception 'Program run was not found'; end if;

  select program.* into source_program
  from public.programs program
  where program.id = source_run.source_program_id;
  select version.* into source_version
  from public.program_versions version
  where version.id = source_run.program_version_id
    and version.program_id = source_run.source_program_id;
  if source_program.id is null or source_version.id is null then
    raise exception 'Program run content was not found';
  end if;

  copy_title := left(source_version.title, 115) || ' copy';
  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label, content_type
  ) values (
    current_user_id, current_user_id, copy_title, source_version.description,
    source_program.planning_mode, true, 'self', 'Duplicated by you',
    source_program.content_type
  ) returning id into new_program_id;

  insert into public.program_versions (
    program_id, authored_by_id, based_on_version_id, version_number, status
  ) values (
    new_program_id, current_user_id, source_version.id, 1, 'draft'
  ) returning id into new_version_id;

  perform private.clone_program_version_tree(source_version.id, new_version_id);
  update public.programs set title = copy_title where id = new_program_id;
  return new_program_id;
end;
$$;

create or replace function public.get_program_run_program_detail(
  target_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_run public.program_runs%rowtype;
  version public.program_versions%rowtype;
  program public.programs%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not private.can_read_program_run(target_run_id) then
    raise exception 'Program run was not found';
  end if;
  select run.* into target_run
  from public.program_runs run where run.id = target_run_id;
  select candidate.* into version
  from public.program_versions candidate
  where candidate.id = target_run.program_version_id;
  select source.* into program
  from public.programs source where source.id = target_run.source_program_id;

  return jsonb_build_object(
    'kind', 'run',
    'id', target_run.id,
    'programRunId', target_run.id,
    'programId', program.id,
    'athleteId', target_run.athlete_id,
    'createdById', target_run.created_by_id,
    'versionId', version.id,
    'versionNumber', version.version_number,
    'versionStatus', version.status,
    'title', version.title,
    'description', version.description,
    'planningMode', program.planning_mode,
    'sourceType', case when target_run.created_by_id = target_run.athlete_id
      then 'self' else 'coach' end,
    'contentType', program.content_type,
    'effectiveFrom', version.effective_from,
    'publishedAt', version.published_at
  ) || private.program_version_content_payload(version.id);
end;
$$;

-- The compact athlete directory must use the same source of truth as the
-- athlete detail screen. Legacy assignments are provenance only after this
-- migration and must not inflate or duplicate the visible plan count.
create or replace function public.list_coach_athletes(
  page_limit integer default 50,
  after_display_name text default null,
  after_id uuid default null
)
returns table (
  id uuid,
  relationship_id uuid,
  display_name text,
  assigned_program_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if (after_display_name is null) <> (after_id is null) then
    raise exception 'Coach athlete cursor is incomplete';
  end if;

  return query
  with relationship_page as materialized (
    select athlete.id, relationship.id as relationship_id, athlete.display_name
    from public.coach_relationships relationship
    join public.profiles athlete on athlete.id = relationship.athlete_id
    where relationship.coach_id = current_user_id
      and relationship.ended_at is null
      and (
        after_display_name is null
        or (lower(athlete.display_name), athlete.id)
          > (lower(after_display_name), after_id)
      )
    order by lower(athlete.display_name), athlete.id
    limit least(greatest(coalesce(page_limit, 50), 1), 50)
  ), run_counts as (
    select run.athlete_id, count(*) as run_count
    from public.program_runs run
    join relationship_page page on page.id = run.athlete_id
    where run.created_by_id = current_user_id
      and run.status in ('not_started', 'in_progress')
    group by run.athlete_id
  )
  select page.id, page.relationship_id, page.display_name,
    coalesce(run_count.run_count, 0) as assigned_program_count
  from relationship_page page
  left join run_counts run_count on run_count.athlete_id = page.id
  order by lower(page.display_name), page.id;
end;
$$;

-- Add run lineage and authorization to the existing bounded coach overview
-- without duplicating its established pagination and result payload logic.
do $$
declare
  function_definition text;
  old_upcoming_payload constant text := $fragment$'assignmentId', occurrence.assignment_id,
        'programId', version.program_id,$fragment$;
  new_upcoming_payload constant text := $fragment$'assignmentId', occurrence.assignment_id,
        'programRunId', occurrence.program_run_id,
        'programRunWorkoutId', occurrence.program_run_workout_id,
        'programId', version.program_id,$fragment$;
  old_completed_payload constant text := $fragment$'assignmentId', session.assignment_id,
        'programId', version.program_id,$fragment$;
  new_completed_payload constant text := $fragment$'assignmentId', session.assignment_id,
        'programRunId', session.program_run_id,
        'programRunWorkoutId', session.program_run_workout_id,
        'programId', version.program_id,$fragment$;
  old_upcoming_scope constant text := $fragment$or (
          occurrence.assignment_id is null
          and exists (
            select 1
            from public.programs program
            where program.id = version.program_id
              and program.created_by_id = current_user_id
              and program.source_type = 'coach'
          )
        )$fragment$;
  new_upcoming_scope constant text := $fragment$or (
          occurrence.assignment_id is null
          and exists (
            select 1
            from public.programs program
            where program.id = version.program_id
              and program.created_by_id = current_user_id
              and program.source_type = 'coach'
          )
        )
        or exists (
          select 1 from public.program_runs run
          where run.id = occurrence.program_run_id
            and run.created_by_id = current_user_id
        )$fragment$;
  old_completed_scope constant text := $fragment$or (
          session.assignment_id is null
          and exists (
            select 1
            from public.programs program
            where program.id = version.program_id
              and program.created_by_id = current_user_id
              and program.source_type = 'coach'
          )
        )$fragment$;
  new_completed_scope constant text := $fragment$or (
          session.assignment_id is null
          and exists (
            select 1
            from public.programs program
            where program.id = version.program_id
              and program.created_by_id = current_user_id
              and program.source_type = 'coach'
          )
        )
        or exists (
          select 1 from public.program_runs run
          where run.id = session.program_run_id
            and run.created_by_id = current_user_id
        )$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.get_coach_athlete_detail(uuid,integer,integer,integer)'::regprocedure
  ) into function_definition;
  if pg_catalog.strpos(function_definition, old_upcoming_payload) = 0
    or pg_catalog.strpos(function_definition, old_completed_payload) = 0
    or pg_catalog.strpos(function_definition, old_upcoming_scope) = 0
    or pg_catalog.strpos(function_definition, old_completed_scope) = 0 then
    raise exception 'Coach athlete detail run-lineage shape was not recognized';
  end if;
  function_definition := pg_catalog.replace(
    function_definition, old_upcoming_payload, new_upcoming_payload
  );
  function_definition := pg_catalog.replace(
    function_definition, old_completed_payload, new_completed_payload
  );
  function_definition := pg_catalog.replace(
    function_definition, old_upcoming_scope, new_upcoming_scope
  );
  function_definition := pg_catalog.replace(
    function_definition, old_completed_scope, new_completed_scope
  );
  execute function_definition;
end;
$$;

create or replace function public.can_read_authored_session(
  target_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workout_sessions session
    join public.coach_relationships relationship
      on relationship.athlete_id = session.athlete_id
     and relationship.coach_id = (select auth.uid())
     and relationship.ended_at is null
    left join public.program_assignments assignment
      on assignment.id = session.assignment_id
    left join public.program_versions version
      on version.id = session.program_version_id
    left join public.programs program on program.id = version.program_id
    left join public.program_runs run on run.id = session.program_run_id
    where session.id = target_session_id
      and (
        assignment.assigned_by_id = (select auth.uid())
        or run.created_by_id = (select auth.uid())
        or (
          session.assignment_id is null
          and program.athlete_id = session.athlete_id
          and program.created_by_id = (select auth.uid())
          and program.source_type = 'coach'
        )
      )
  );
$$;

-- Cursor-based coach history follows the same authored scope as detail reads.
-- Run identity and display metadata let the client open a result directly
-- without loading or guessing a matching reusable program.
drop function public.list_authored_coach_session_summaries(
  uuid, integer, timestamptz, uuid
);
create function public.list_authored_coach_session_summaries(
  target_athlete_id uuid default null,
  target_limit integer default 100,
  target_before_started_at timestamptz default null,
  target_before_id uuid default null
)
returns table (
  id uuid,
  athlete_id uuid,
  program_run_id uuid,
  program_run_workout_id uuid,
  program_id uuid,
  program_title text,
  program_version_id uuid,
  workout_id uuid,
  scheduled_workout_id uuid,
  workout_title text,
  started_at timestamptz,
  completed_at timestamptz,
  completed_for_date date,
  session_rpe numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if (target_before_started_at is null) <> (target_before_id is null) then
    raise exception 'Coach history cursor is incomplete';
  end if;

  return query
  select
    session.id,
    session.athlete_id,
    session.program_run_id,
    session.program_run_workout_id,
    coalesce(run.source_program_id, version.program_id),
    version.title,
    session.program_version_id,
    session.workout_id,
    session.scheduled_workout_id,
    session.workout_title,
    session.started_at,
    session.completed_at,
    session.completed_for_date,
    session.session_rpe
  from public.workout_sessions session
  join public.program_versions version
    on version.id = session.program_version_id
  join public.programs program
    on program.id = version.program_id
  join public.coach_relationships relationship
    on relationship.athlete_id = session.athlete_id
   and relationship.coach_id = (select auth.uid())
   and relationship.ended_at is null
  left join public.program_assignments assignment
    on assignment.id = session.assignment_id
  left join public.program_runs run
    on run.id = session.program_run_id
   and run.athlete_id = session.athlete_id
   and run.program_version_id = session.program_version_id
  where session.status = 'completed'
    and (
      run.created_by_id = (select auth.uid())
      or assignment.assigned_by_id = (select auth.uid())
      or (
        session.assignment_id is null
        and session.program_run_id is null
        and program.athlete_id = session.athlete_id
        and program.created_by_id = (select auth.uid())
        and program.source_type = 'coach'
      )
    )
    and (
      target_athlete_id is null
      or session.athlete_id = target_athlete_id
    )
    and (
      target_before_started_at is null
      or (session.started_at, session.id)
        < (target_before_started_at, target_before_id)
    )
  order by session.started_at desc, session.id desc
  limit least(greatest(coalesce(target_limit, 100), 1), 250);
end;
$$;

-- A run created by the active coach is authored scope even though its source
-- template remains owned by the coach (rather than cloned onto the athlete).
-- Keep the established note-free projection for coach-visible results.
create or replace function public.get_authored_coach_session_detail(
  target_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result_payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  select jsonb_build_object(
    'id', session.id,
    'programRunId', session.program_run_id,
    'programRunWorkoutId', session.program_run_workout_id,
    'programVersionId', session.program_version_id,
    'workoutId', session.workout_id,
    'scheduledWorkoutId', session.scheduled_workout_id,
    'workoutTitle', session.workout_title,
    'startedAt', session.started_at,
    'completedAt', session.completed_at,
    'completedForDate', session.completed_for_date,
    'sessionRpe', session.session_rpe,
    'items', coalesce((
      select jsonb_agg(item_payload.payload order by item_payload.position, item_payload.id)
      from (
        select item.id, item.position, jsonb_build_object(
          'id', item.id,
          'title', item.snapshot_name,
          'cue', item.snapshot_cue,
          'exerciseCategory', item.snapshot_category,
          'videoUrl', item.snapshot_video_url,
          'mode', item.entry_mode,
          'fields', item.tracking_fields,
          'position', item.position,
          'entries', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', entry.id,
              'position', entry.position,
              'reps', entry.reps,
              'loadKg', entry.load_kg,
              'durationSeconds', entry.duration_seconds,
              'distanceMetres', entry.distance_metres,
              'rounds', entry.rounds,
              'heartRate', entry.heart_rate,
              'rpe', entry.rpe
            ) order by entry.position, entry.id)
            from public.session_entries entry
            where entry.session_item_log_id = item.id
          ), '[]'::jsonb)
        ) as payload
        from public.session_item_logs item
        where item.workout_session_id = session.id
      ) item_payload
    ), '[]'::jsonb)
  ) into result_payload
  from public.workout_sessions session
  where session.id = target_session_id
    and session.status = 'completed'
    and public.can_read_authored_session(session.id);

  return result_payload;
end;
$$;

create or replace function public.get_scheduled_workout_detail(
  target_schedule_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result_payload jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select jsonb_build_object(
    'id', occurrence.id,
    'athleteId', occurrence.athlete_id,
    'scheduledById', occurrence.scheduled_by_id,
    'assignmentId', occurrence.assignment_id,
    'programRunId', occurrence.program_run_id,
    'programRunWorkoutId', occurrence.program_run_workout_id,
    'sourceType', case
      when run.id is not null then
        case when run.created_by_id <> run.athlete_id then 'coach' else 'self' end
      when occurrence.assignment_id is not null then 'coach'
      when occurrence.scheduled_by_id <> occurrence.athlete_id then 'coach'
      else 'self'
    end,
    'programId', version.program_id,
    'programVersionId', occurrence.program_version_id,
    'programTitle', version.title,
    'workoutId', occurrence.workout_id,
    'plannedDate', occurrence.planned_date,
    'sequenceNumber', occurrence.sequence_number,
    'status', occurrence.status,
    'workout', private.workout_content_payload(occurrence.workout_id)
  ) into result_payload
  from public.scheduled_workouts occurrence
  join public.program_versions version on version.id = occurrence.program_version_id
  left join public.program_runs run on run.id = occurrence.program_run_id
  where occurrence.id = target_schedule_id
    and (
      occurrence.athlete_id = current_user_id
      or (
        run.created_by_id = current_user_id
        and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = occurrence.athlete_id
            and relationship.coach_id = current_user_id
            and relationship.ended_at is null
        )
      )
      or (
        occurrence.assignment_id is not null
        and exists (
          select 1
          from public.program_assignments assignment
          join public.coach_relationships relationship
            on relationship.athlete_id = assignment.athlete_id
           and relationship.coach_id = current_user_id
           and relationship.ended_at is null
          where assignment.id = occurrence.assignment_id
            and assignment.assigned_by_id = current_user_id
        )
      )
      or (
        occurrence.assignment_id is null
        and exists (
          select 1
          from public.programs source_program
          where source_program.id = version.program_id
            and source_program.athlete_id = occurrence.athlete_id
            and source_program.created_by_id = current_user_id
            and source_program.source_type = 'coach'
            and exists (
              select 1 from public.coach_relationships relationship
              where relationship.athlete_id = occurrence.athlete_id
                and relationship.coach_id = current_user_id
                and relationship.ended_at is null
            )
        )
      )
    );
  return result_payload;
end;
$$;

-- Existing lightweight Next payloads can now expose run lineage without a new
-- bootstrap query. Migration 002 already inserted estimatedMinutes.
do $$
declare
  function_definition text;
  old_active constant text := $fragment$'assignmentId', session.assignment_id,
        'programVersionId', session.program_version_id,$fragment$;
  new_active constant text := $fragment$'assignmentId', session.assignment_id,
        'programRunId', session.program_run_id,
        'programRunWorkoutId', session.program_run_workout_id,
        'programVersionId', session.program_version_id,$fragment$;
  old_next constant text := $fragment$'assignmentId', occurrence.assignment_id,
            'programVersionId', occurrence.program_version_id,$fragment$;
  new_next constant text := $fragment$'assignmentId', occurrence.assignment_id,
            'programRunId', occurrence.program_run_id,
            'programRunWorkoutId', occurrence.program_run_workout_id,
            'scheduledById', occurrence.scheduled_by_id,
            'sourceType', case
              when occurrence.program_run_id is not null then coalesce((
                select case
                  when run.created_by_id <> run.athlete_id then 'coach'
                  else 'self'
                end
                from public.program_runs run
                where run.id = occurrence.program_run_id
              ), 'self')
              when occurrence.assignment_id is not null then 'coach'
              when occurrence.scheduled_by_id <> occurrence.athlete_id then 'coach'
              else 'self'
            end,
            'programVersionId', occurrence.program_version_id,$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.get_workspace_bootstrap()'::regprocedure
  ) into function_definition;
  if pg_catalog.strpos(function_definition, old_active) = 0
    or pg_catalog.strpos(function_definition, old_next) = 0 then
    raise exception 'Workspace bootstrap run-lineage shape was not recognized';
  end if;
  function_definition := pg_catalog.replace(function_definition, old_active, new_active);
  function_definition := pg_catalog.replace(function_definition, old_next, new_next);
  execute function_definition;
end;
$$;

-- Extend the service-only fixture reset over the new run aggregate. The
-- namespace boundary check happens before any unlinking, and the old reset is
-- still responsible for the original program/profile tables.
create or replace function public.reset_test_population(
  expected_namespace text,
  expected_persona_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  test_ids uuid[];
  result jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Test population reset requires the service role';
  end if;
  if expected_namespace is null
    or expected_namespace !~ '^[a-z0-9-]+-v[0-9]+$' then
    raise exception 'A valid fixture namespace is required';
  end if;

  select array_agg(profile.id) into test_ids
  from public.profiles profile
  where profile.account_kind = 'test'
    and profile.test_persona_key like expected_namespace || ':%';

  if test_ids is not null and exists (
    select 1 from public.program_assignments assignment
    where (
      assignment.athlete_id = any(test_ids)
      and not (assignment.assigned_by_id = any(test_ids))
    ) or (
      assignment.assigned_by_id = any(test_ids)
      and not (assignment.athlete_id = any(test_ids))
    )
  ) then
    raise exception 'Fixture assignments cross namespace boundaries; reset aborted';
  end if;
  if test_ids is not null and exists (
    select 1 from public.program_runs run
    where (
      run.athlete_id = any(test_ids)
      and not (run.created_by_id = any(test_ids))
    ) or (
      run.created_by_id = any(test_ids)
      and not (run.athlete_id = any(test_ids))
    )
  ) then
    raise exception 'Fixture program runs cross namespace boundaries; reset aborted';
  end if;

  if test_ids is not null then
    perform pg_catalog.set_config('liftlog.test_reset', 'on', true);
    delete from public.workout_sessions session
    where session.athlete_id = any(test_ids);

    -- Break the reverse pointer first; scheduled rows themselves still retain
    -- their run/slot identity until they are deleted on the next statement.
    update public.program_run_workouts slot
    set scheduled_workout_id = null
    from public.program_runs run
    where run.id = slot.program_run_id
      and (run.athlete_id = any(test_ids) or run.created_by_id = any(test_ids));

    delete from public.scheduled_workouts occurrence
    where occurrence.athlete_id = any(test_ids);
    delete from public.program_run_workouts slot
    using public.program_runs run
    where run.id = slot.program_run_id
      and (run.athlete_id = any(test_ids) or run.created_by_id = any(test_ids));
    delete from public.program_runs run
    where run.athlete_id = any(test_ids) or run.created_by_id = any(test_ids);
    delete from public.program_assignments assignment
    where assignment.athlete_id = any(test_ids)
       or assignment.assigned_by_id = any(test_ids);
  end if;

  select public.reset_test_population_pre_v1(
    expected_namespace, expected_persona_keys
  ) into result;
  return result;
end;
$$;

revoke all on function private.can_read_program_run(uuid)
  from public, anon, authenticated;
revoke all on function private.refresh_program_run_status(uuid)
  from public, anon, authenticated;
revoke all on function private.validate_program_run()
  from public, anon, authenticated;
revoke all on function private.validate_program_run_workout()
  from public, anon, authenticated;
revoke all on function private.sync_program_run_from_schedule()
  from public, anon, authenticated;
revoke all on function private.hydrate_session_program_run()
  from public, anon, authenticated;
revoke all on function private.snapshot_program_for_run(uuid)
  from public, anon, authenticated;
revoke all on function private.canonical_program_run_dates(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function private.validate_program_run_date_order(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function private.assert_program_run_content_within_limits(uuid)
  from public, anon, authenticated;
revoke all on function private.materialize_program_run(uuid, uuid, uuid, uuid, jsonb, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_program_runs(uuid, uuid[], jsonb, uuid, uuid)
  from public, anon;
revoke all on function public.repeat_program_run(uuid, jsonb, uuid)
  from public, anon;
revoke all on function public.schedule_program_run_workouts(uuid, jsonb, uuid)
  from public, anon;
revoke all on function public.end_program_run(uuid) from public, anon;
revoke all on function public.update_program_run_workout_overrides(uuid, jsonb)
  from public, anon;
revoke all on function public.list_program_run_summaries(
  uuid, integer, timestamptz, uuid, text
)
  from public, anon;
revoke all on function public.get_program_run_detail(uuid)
  from public, anon;
revoke all on function public.copy_program_run_to_own(uuid)
  from public, anon;
revoke all on function public.get_program_run_program_detail(uuid)
  from public, anon;
revoke all on function public.list_authored_coach_session_summaries(
  uuid, integer, timestamptz, uuid
)
  from public, anon;
revoke all on function public.list_calendar_occurrences(date, date, integer, date, uuid)
  from public, anon;
revoke all on function public.list_upcoming_scheduled_workouts(integer, date, uuid)
  from public, anon;
revoke all on function public.list_completed_session_summaries(integer, timestamptz, uuid)
  from public, anon;
revoke all on function public.list_calendar_session_summaries(date, date, integer)
  from public, anon;
revoke all on function public.publish_program_version(uuid, date)
  from public, anon;
-- These V0 writers and compatibility wrappers bypass the run aggregate. Keep
-- the definitions for migration/backfill compatibility, but expose no path for
-- an authenticated app client to create an assignment or occurrence without a
-- program run.
revoke all on function public.assign_published_program_version(uuid, uuid, uuid[], uuid)
  from public, anon, authenticated;
revoke all on function public.fork_program_assignment(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.assign_program_for_use(uuid, uuid[], uuid)
  from public, anon, authenticated;
revoke all on function public.assign_quick_workout_to_athletes(uuid, uuid[], date, uuid)
  from public, anon, authenticated;
revoke all on function public.assign_quick_workout_for_use(uuid, uuid[], date, uuid)
  from public, anon, authenticated;
revoke all on function public.create_scheduled_occurrence(uuid, date, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_scheduled_occurrence_for_use(uuid, date, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_coach_scheduled_occurrence(uuid, uuid, date, uuid)
  from public, anon, authenticated;

grant execute on function public.create_program_runs(uuid, uuid[], jsonb, uuid, uuid)
  to authenticated;
grant execute on function public.repeat_program_run(uuid, jsonb, uuid)
  to authenticated;
grant execute on function public.schedule_program_run_workouts(uuid, jsonb, uuid)
  to authenticated;
grant execute on function public.end_program_run(uuid) to authenticated;
grant execute on function public.update_program_run_workout_overrides(uuid, jsonb)
  to authenticated;
grant execute on function public.list_program_run_summaries(
  uuid, integer, timestamptz, uuid, text
)
  to authenticated;
grant execute on function public.get_program_run_detail(uuid)
  to authenticated;
grant execute on function public.copy_program_run_to_own(uuid)
  to authenticated;
grant execute on function public.get_program_run_program_detail(uuid)
  to authenticated;
grant execute on function public.list_authored_coach_session_summaries(
  uuid, integer, timestamptz, uuid
)
  to authenticated;
grant execute on function public.list_calendar_occurrences(date, date, integer, date, uuid)
  to authenticated;
grant execute on function public.list_upcoming_scheduled_workouts(integer, date, uuid)
  to authenticated;
grant execute on function public.list_completed_session_summaries(integer, timestamptz, uuid)
  to authenticated;
grant execute on function public.list_calendar_session_summaries(date, date, integer)
  to authenticated;
-- The participant RLS policies call this helper as the querying role.
grant execute on function private.can_read_program_run(uuid)
  to authenticated;
-- Explicit publishing remains a supported authenticated compatibility path.
-- The function itself checks ownership through can_edit_program; snapshotting
-- also calls it internally when a reusable draft becomes a run revision.
grant execute on function public.publish_program_version(uuid, date)
  to authenticated;

commit;
