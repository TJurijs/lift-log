-- V1 bounded data architecture.
--
-- Published program content is immutable and may therefore be shared safely.
-- New multi-athlete assignments reference one immutable source version instead
-- of cloning its complete tree. Existing materialized assignments are retained
-- as legacy forks so schedule/session foreign keys and historical provenance do
-- not change during this forward migration.

begin;

create table public.program_assignments (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by_id uuid not null references public.profiles(id) on delete restrict,
  source_program_id uuid references public.programs(id) on delete set null,
  source_version_id uuid references public.program_versions(id) on delete restrict,
  customized_program_id uuid references public.programs(id) on delete restrict,
  assignment_request_key uuid,
  fork_request_key uuid,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  legacy_materialized boolean not null default false,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_assignments_not_self check (athlete_id <> assigned_by_id),
  constraint program_assignments_content_check check (
    source_version_id is not null or customized_program_id is not null
  )
);

create unique index idx_program_assignments_active_source
  on public.program_assignments (athlete_id, source_program_id)
  where status = 'active' and source_program_id is not null;

create unique index idx_program_assignments_customized_program
  on public.program_assignments (customized_program_id)
  where customized_program_id is not null;

create unique index idx_program_assignments_request_key
  on public.program_assignments (
    assigned_by_id,
    athlete_id,
    assignment_request_key
  )
  where assignment_request_key is not null;

create index idx_program_assignments_athlete_active_assigned
  on public.program_assignments (athlete_id, assigned_at desc, id desc)
  where status = 'active';

create index idx_program_assignments_coach_active_athlete
  on public.program_assignments (assigned_by_id, athlete_id, id)
  where status = 'active';

create trigger program_assignments_set_updated_at
before update on public.program_assignments
for each row execute function public.set_updated_at();

alter table public.scheduled_workouts
  add column assignment_id uuid
    references public.program_assignments(id) on delete restrict,
  add column request_key uuid;

alter table public.workout_sessions
  add column assignment_id uuid
    references public.program_assignments(id) on delete restrict;

-- Register every still-identifiable materialized assignment. The customized
-- program remains authoritative for these rows, so no existing tree is deleted
-- and no historical workout/item identifier is rewritten.
insert into public.program_assignments (
  athlete_id,
  assigned_by_id,
  source_program_id,
  source_version_id,
  customized_program_id,
  status,
  legacy_materialized,
  assigned_at
)
select
  assigned.athlete_id,
  assigned.created_by_id,
  assigned.assigned_from_program_id,
  coalesce(first_version.based_on_version_id, source_version.id),
  assigned.id,
  case when assigned.archived_at is null then 'active' else 'archived' end,
  true,
  assigned.created_at
from public.programs assigned
left join lateral (
  select version.based_on_version_id
  from public.program_versions version
  where version.program_id = assigned.id
  order by version.version_number, version.id
  limit 1
) first_version on true
left join lateral (
  select version.id
  from public.program_versions version
  where version.program_id = assigned.assigned_from_program_id
    and version.status in ('published', 'superseded')
  order by
    case version.status when 'published' then 0 else 1 end,
    version.version_number desc,
    version.id
  limit 1
) source_version on true
where assigned.assigned_from_program_id is not null
  and assigned.source_type = 'coach'
on conflict do nothing;

update public.scheduled_workouts scheduled
set assignment_id = assignment.id
from public.program_versions version
join public.program_assignments assignment
  on assignment.customized_program_id = version.program_id
where scheduled.program_version_id = version.id
  and scheduled.assignment_id is null;

-- Completed sessions are otherwise immutable. Disable only the identity guard
-- while the new provenance FK is backfilled inside this migration transaction.
alter table public.workout_sessions
  disable trigger protect_workout_session_history;

update public.workout_sessions session
set assignment_id = assignment.id
from public.program_versions version
join public.program_assignments assignment
  on assignment.customized_program_id = version.program_id
where session.program_version_id = version.id
  and session.assignment_id is null;

alter table public.workout_sessions
  enable trigger protect_workout_session_history;

create unique index idx_scheduled_workouts_athlete_request_key
  on public.scheduled_workouts (athlete_id, request_key)
  where request_key is not null;

create index idx_scheduled_workouts_assignment_sequence
  on public.scheduled_workouts (assignment_id, sequence_number, id)
  where assignment_id is not null;

create index idx_scheduled_workouts_version_sequence_id
  on public.scheduled_workouts (program_version_id, sequence_number, id)
  where sequence_number is not null;

create index idx_scheduled_workouts_athlete_version_sequence
  on public.scheduled_workouts (
    athlete_id,
    program_version_id,
    sequence_number desc
  )
  where sequence_number is not null;

create index idx_scheduled_workouts_athlete_calendar
  on public.scheduled_workouts (athlete_id, planned_date, id)
  where planned_date is not null;

create index idx_workout_sessions_athlete_completed_cursor
  on public.workout_sessions (athlete_id, started_at desc, id desc)
  where status = 'completed';

create index idx_workout_sessions_athlete_calendar
  on public.workout_sessions (athlete_id, completed_for_date, id)
  where status = 'completed' and completed_for_date is not null;

create index idx_exercises_global_search
  on public.exercises (lower(name), id)
  where archived_at is null and scope = 'global';

create index idx_exercises_personal_search
  on public.exercises (owner_id, lower(name), id)
  where archived_at is null and scope = 'personal';

-- The old occurrence uniqueness assumed every athlete had a cloned version.
-- Shared source versions require athlete_id in the identity.
drop index if exists public.idx_scheduled_workouts_version_workout_sequence;
create unique index idx_scheduled_workouts_athlete_version_workout_sequence
  on public.scheduled_workouts (
    athlete_id,
    program_version_id,
    workout_id,
    sequence_number
  )
  where sequence_number is not null;

-- These indexes duplicate constraint-owned btrees (or, for active sessions, a
-- stronger partial unique index). Removing them lowers clone/fork write cost.
drop index if exists public.idx_program_versions_program_version_desc;
drop index if exists public.idx_program_weeks_version_week_index;
drop index if exists public.idx_workouts_week_position;
drop index if exists public.idx_workout_sections_workout_position;
drop index if exists public.idx_workout_items_section_position;
drop index if exists public.idx_prescribed_entries_item_position;
drop index if exists public.idx_workout_sessions_athlete_active_started;

alter table public.program_assignments enable row level security;

create policy program_assignments_read_participant
on public.program_assignments for select to authenticated
using (
  athlete_id = (select auth.uid())
  or (
    assigned_by_id = (select auth.uid())
    and exists (
      select 1
      from public.coach_relationships relationship
      where relationship.athlete_id = program_assignments.athlete_id
        and relationship.coach_id = (select auth.uid())
        and relationship.ended_at is null
    )
  )
);

revoke insert, update, delete on public.program_assignments
  from public, anon, authenticated;

create or replace function private.assignment_content_version(
  target_assignment_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(custom_version.id, assignment.source_version_id)
  from public.program_assignments assignment
  left join lateral (
    select version.id
    from public.program_versions version
    where version.program_id = assignment.customized_program_id
      and version.status = 'published'
    order by version.version_number desc, version.id
    limit 1
  ) custom_version on true
  where assignment.id = target_assignment_id;
$$;

create or replace function private.can_read_program_assignment(
  target_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.program_assignments assignment
    where assignment.id = target_assignment_id
      and assignment.status = 'active'
      and (
        assignment.athlete_id = (select auth.uid())
        or (
          assignment.assigned_by_id = (select auth.uid())
          and exists (
            select 1
            from public.coach_relationships relationship
            where relationship.athlete_id = assignment.athlete_id
              and relationship.coach_id = (select auth.uid())
              and relationship.ended_at is null
          )
        )
      )
  );
$$;

create or replace function private.validate_program_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_program_id_value uuid;
  source_status text;
  custom_athlete_id uuid;
  custom_author_id uuid;
begin
  if tg_op = 'UPDATE' and (
    new.athlete_id is distinct from old.athlete_id
    or new.assigned_by_id is distinct from old.assigned_by_id
    or new.source_program_id is distinct from old.source_program_id
    or new.source_version_id is distinct from old.source_version_id
    or new.assignment_request_key is distinct from old.assignment_request_key
    or new.legacy_materialized is distinct from old.legacy_materialized
    or new.assigned_at is distinct from old.assigned_at
    or (
      old.customized_program_id is not null
      and new.customized_program_id is distinct from old.customized_program_id
    )
    or (
      old.fork_request_key is not null
      and new.fork_request_key is distinct from old.fork_request_key
    )
  ) then
    raise exception 'Program assignment identity and source are immutable';
  end if;

  if new.source_version_id is not null then
    select version.program_id, version.status
    into source_program_id_value, source_status
    from public.program_versions version
    where version.id = new.source_version_id;

    if source_status not in ('published', 'superseded') then
      raise exception 'Assignment source version must be immutable';
    end if;
    if new.source_program_id is not null
      and new.source_program_id is distinct from source_program_id_value then
      raise exception 'Assignment source program/version mismatch';
    end if;
  end if;

  if new.customized_program_id is not null then
    select program.athlete_id, program.created_by_id
    into custom_athlete_id, custom_author_id
    from public.programs program
    where program.id = new.customized_program_id;

    if custom_athlete_id is distinct from new.athlete_id
      or custom_author_id is distinct from new.assigned_by_id then
      raise exception 'Assignment fork ownership mismatch';
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_program_assignment
before insert or update on public.program_assignments
for each row execute function private.validate_program_assignment();

create or replace function public.assign_published_program_version(
  target_program_id uuid,
  target_version_id uuid,
  target_athlete_ids uuid[],
  target_idempotency_key uuid
)
returns table (
  athlete_id uuid,
  assignment_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  normalized_athlete_ids uuid[];
  relationship_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if target_idempotency_key is null then
    raise exception 'An idempotency key is required';
  end if;
  if target_athlete_ids is null or cardinality(target_athlete_ids) = 0 then
    raise exception 'Choose at least one athlete';
  end if;
  if cardinality(target_athlete_ids) > 50 then
    raise exception 'A program can be assigned to at most 50 athletes at once';
  end if;
  if exists (
    select 1
    from unnest(target_athlete_ids) requested_id
    where requested_id is null
  ) then
    raise exception 'Athlete IDs cannot be empty';
  end if;

  select array_agg(requested_id order by first_position)
  into normalized_athlete_ids
  from (
    select requested_id, min(position) as first_position
    from unnest(target_athlete_ids)
      with ordinality requested(requested_id, position)
    group by requested_id
  ) normalized;

  if exists (
    select 1
    from public.program_assignments assignment
    where assignment.assigned_by_id = current_user_id
      and assignment.athlete_id = any(normalized_athlete_ids)
      and assignment.assignment_request_key = target_idempotency_key
      and (
        assignment.source_program_id is distinct from target_program_id
        or assignment.source_version_id is distinct from target_version_id
      )
  ) then
    raise exception 'Idempotency key was already used for another assignment';
  end if;

  perform program.id
  from public.programs program
  join public.program_versions version
    on version.program_id = program.id
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and program.created_by_id = current_user_id
    and program.source_type = 'self'
    and program.is_current
    and program.archived_at is null
    and version.id = target_version_id
    and version.status = 'published'
  for share of program, version;
  if not found then
    raise exception 'Only one immutable published Own program can be assigned';
  end if;

  perform relationship.id
  from public.coach_relationships relationship
  where relationship.coach_id = current_user_id
    and relationship.athlete_id = any(normalized_athlete_ids)
    and relationship.ended_at is null
  order by relationship.athlete_id
  for share;

  select count(distinct relationship.athlete_id)
  into relationship_count
  from public.coach_relationships relationship
  where relationship.coach_id = current_user_id
    and relationship.athlete_id = any(normalized_athlete_ids)
    and relationship.ended_at is null;

  if relationship_count <> cardinality(normalized_athlete_ids) then
    raise exception 'Programs can only be assigned to athletes you currently coach';
  end if;

  return query
  with requested as materialized (
    select requested_id as athlete_id
    from unnest(normalized_athlete_ids) requested_id
  ),
  inserted as (
    insert into public.program_assignments (
      athlete_id,
      assigned_by_id,
      source_program_id,
      source_version_id,
      assignment_request_key,
      status
    )
    select
      requested.athlete_id,
      current_user_id,
      target_program_id,
      target_version_id,
      target_idempotency_key,
      'active'
    from requested
    on conflict do nothing
    returning program_assignments.id, program_assignments.athlete_id
  )
  select
    requested.athlete_id,
    coalesce(inserted.id, existing_assignment.id),
    inserted.id is not null
  from requested
  left join inserted on inserted.athlete_id = requested.athlete_id
  left join public.program_assignments existing_assignment
    on existing_assignment.athlete_id = requested.athlete_id
   and existing_assignment.source_program_id = target_program_id
   and existing_assignment.status = 'active'
  where coalesce(inserted.id, existing_assignment.id) is not null
  order by requested.athlete_id;
end;
$$;

drop function if exists public.assign_own_program_to_athletes(uuid, uuid[]);

create or replace function public.fork_program_assignment(
  target_assignment_id uuid,
  target_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  assignment public.program_assignments%rowtype;
  source_program public.programs%rowtype;
  content_version_id uuid;
  content_version public.program_versions%rowtype;
  new_program_id uuid;
  new_version_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if target_idempotency_key is null then
    raise exception 'An idempotency key is required';
  end if;

  select *
  into assignment
  from public.program_assignments candidate
  where candidate.id = target_assignment_id
    and candidate.assigned_by_id = current_user_id
    and candidate.status = 'active'
    and exists (
      select 1
      from public.coach_relationships relationship
      where relationship.athlete_id = candidate.athlete_id
        and relationship.coach_id = current_user_id
        and relationship.ended_at is null
    )
  for update;
  if not found then
    raise exception 'Active authored assignment not found';
  end if;

  if assignment.customized_program_id is not null then
    if assignment.fork_request_key is distinct from target_idempotency_key then
      raise exception 'Assignment was already forked with another idempotency key';
    end if;
    select version.id
    into new_version_id
    from public.program_versions version
    where version.program_id = assignment.customized_program_id
      and version.status = 'draft'
    order by version.version_number desc, version.id
    limit 1;

    return jsonb_build_object(
      'assignmentId', assignment.id,
      'programId', assignment.customized_program_id,
      'versionId', new_version_id,
      'created', false
    );
  end if;

  content_version_id := private.assignment_content_version(assignment.id);
  select * into content_version
  from public.program_versions version
  where version.id = content_version_id
    and version.status in ('published', 'superseded');
  if not found then
    raise exception 'Assignment content is unavailable';
  end if;

  select * into source_program
  from public.programs program
  where program.id = content_version.program_id;

  insert into public.programs (
    athlete_id,
    created_by_id,
    title,
    description,
    planning_mode,
    is_current,
    source_type,
    source_label,
    assigned_from_program_id,
    content_type
  ) values (
    assignment.athlete_id,
    current_user_id,
    content_version.title,
    content_version.description,
    source_program.planning_mode,
    true,
    'coach',
    'Customized by assigning coach',
    assignment.source_program_id,
    source_program.content_type
  ) returning id into new_program_id;

  insert into public.program_versions (
    program_id,
    authored_by_id,
    based_on_version_id,
    version_number,
    status
  ) values (
    new_program_id,
    current_user_id,
    content_version_id,
    1,
    'draft'
  ) returning id into new_version_id;

  perform private.clone_program_version_tree(content_version_id, new_version_id);

  update public.program_assignments
  set
    customized_program_id = new_program_id,
    fork_request_key = target_idempotency_key
  where id = assignment.id;

  return jsonb_build_object(
    'assignmentId', assignment.id,
    'programId', new_program_id,
    'versionId', new_version_id,
    'created', true
  );
end;
$$;

-- Shared assignments change content ownership but never calendar ownership.
-- Validate the assignment once at insertion and keep all provenance columns
-- immutable afterwards so ordinary athlete rescheduling remains inexpensive.
create or replace function private.protect_schedule_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  assignment public.program_assignments%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.athlete_id is distinct from old.athlete_id
      or new.program_version_id is distinct from old.program_version_id
      or new.workout_id is distinct from old.workout_id
      or new.scheduled_by_id is distinct from old.scheduled_by_id
      or new.assignment_id is distinct from old.assignment_id
      or new.request_key is distinct from old.request_key then
      raise exception 'Scheduled workout identity and scheduler cannot be changed';
    end if;
    return new;
  end if;

  if new.assignment_id is not null then
    select candidate.*
    into assignment
    from public.program_assignments candidate
    where candidate.id = new.assignment_id;

    if not found
      or assignment.status <> 'active'
      or assignment.athlete_id is distinct from new.athlete_id
      or private.assignment_content_version(assignment.id)
        is distinct from new.program_version_id
      or not exists (
        select 1
        from public.workouts workout
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
    if current_user_id is not null
      and current_user_id is distinct from new.athlete_id then
      raise exception 'Athlete-scheduled workout must record the authenticated athlete';
    end if;
    return new;
  end if;

  if current_user_id is null
    or new.scheduled_by_id is distinct from current_user_id
    or new.status is distinct from 'planned'
    or new.planned_date is null then
    raise exception 'Coach-scheduled workout provenance is invalid';
  end if;

  perform relationship.id
  from public.coach_relationships relationship
  where relationship.athlete_id = new.athlete_id
    and relationship.coach_id = current_user_id
    and relationship.ended_at is null
  for share;
  if not found then
    raise exception 'Coach can only schedule for an actively coached athlete';
  end if;

  if new.assignment_id is not null then
    if assignment.assigned_by_id is distinct from current_user_id
      or not exists (
        select 1
        from public.programs program
        where program.id = coalesce(
          assignment.customized_program_id,
          assignment.source_program_id
        )
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

-- Create exactly the occurrence the athlete selected. The request key makes a
-- network retry return that same row and the profile lock serializes sequence
-- allocation without preparing or cloning any other workout in the program.
create or replace function public.create_scheduled_occurrence(
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
declare
  current_user_id uuid := (select auth.uid());
  content_version_id uuid;
  next_sequence integer;
  schedule public.scheduled_workouts%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if target_planned_date is null then
    raise exception 'Choose a calendar date';
  end if;
  if target_idempotency_key is null then
    raise exception 'An idempotency key is required';
  end if;
  if (target_program_id is null) = (target_assignment_id is null) then
    raise exception 'Choose exactly one program or assignment';
  end if;

  select occurrence.*
  into schedule
  from public.scheduled_workouts occurrence
  where occurrence.athlete_id = current_user_id
    and occurrence.request_key = target_idempotency_key;
  if found then
    if schedule.workout_id is distinct from target_workout_id
      or schedule.planned_date is distinct from target_planned_date
      or schedule.assignment_id is distinct from target_assignment_id then
      raise exception 'Idempotency key was already used for another occurrence';
    end if;
    return jsonb_build_object(
      'id', schedule.id,
      'assignmentId', schedule.assignment_id,
      'programVersionId', schedule.program_version_id,
      'workoutId', schedule.workout_id,
      'plannedDate', schedule.planned_date,
      'sequenceNumber', schedule.sequence_number,
      'status', schedule.status,
      'created', false
    );
  end if;

  -- This lock is deliberately per athlete, not global. It also shares the same
  -- serialization boundary as session start.
  perform profile.id
  from public.profiles profile
  where profile.id = current_user_id
  for update;

  if target_assignment_id is not null then
    select private.assignment_content_version(assignment.id)
    into content_version_id
    from public.program_assignments assignment
    where assignment.id = target_assignment_id
      and assignment.athlete_id = current_user_id
      and assignment.status = 'active'
    for share of assignment;
  else
    select version.id
    into content_version_id
    from public.programs program
    join public.program_versions version on version.program_id = program.id
    where program.id = target_program_id
      and program.athlete_id = current_user_id
      and program.archived_at is null
      and version.status = 'published'
    order by version.version_number desc, version.id
    limit 1
    for share of program, version;
  end if;

  if content_version_id is null or not exists (
    select 1
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    where workout.id = target_workout_id
      and week.program_version_id = content_version_id
  ) then
    raise exception 'Selected workout is not available in this content version';
  end if;

  select coalesce(max(occurrence.sequence_number), 0) + 1
  into next_sequence
  from public.scheduled_workouts occurrence
  where occurrence.athlete_id = current_user_id
    and occurrence.program_version_id = content_version_id;

  insert into public.scheduled_workouts (
    athlete_id,
    scheduled_by_id,
    assignment_id,
    program_version_id,
    workout_id,
    planned_date,
    sequence_number,
    status,
    request_key
  ) values (
    current_user_id,
    current_user_id,
    target_assignment_id,
    content_version_id,
    target_workout_id,
    target_planned_date,
    next_sequence,
    'planned',
    target_idempotency_key
  )
  on conflict (athlete_id, request_key)
    where request_key is not null
  do nothing
  returning * into schedule;

  if not found then
    select occurrence.*
    into schedule
    from public.scheduled_workouts occurrence
    where occurrence.athlete_id = current_user_id
      and occurrence.request_key = target_idempotency_key;
  end if;

  return jsonb_build_object(
    'id', schedule.id,
    'assignmentId', schedule.assignment_id,
    'programVersionId', schedule.program_version_id,
    'workoutId', schedule.workout_id,
    'plannedDate', schedule.planned_date,
    'sequenceNumber', schedule.sequence_number,
    'status', schedule.status,
    'created', true
  );
end;
$$;

-- V1 scheduling is occurrence-based. These pre-population/availability APIs
-- are removed together so no retained function references the obsolete
-- prepare_program_schedule routine.
drop function if exists public.set_program_availability(uuid, boolean);
drop function if exists public.prepare_program_schedule(uuid);

drop function if exists public.assign_quick_workout_to_athletes(
  uuid,
  uuid[],
  date
);

-- Quick-workout placement is also an idempotent V1 mutation: one shared
-- assignment and one selected dated occurrence per athlete, set-wise.
create or replace function public.assign_quick_workout_to_athletes(
  target_program_id uuid,
  target_athlete_ids uuid[],
  target_planned_date date,
  target_idempotency_key uuid
)
returns table (
  athlete_id uuid,
  assignment_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  source_version_id uuid;
  source_workout_id uuid;
  created_athlete_ids uuid[];
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if target_planned_date is null then
    raise exception 'Choose a calendar date';
  end if;
  if target_idempotency_key is null then
    raise exception 'An idempotency key is required';
  end if;

  select version.id
  into source_version_id
  from public.programs program
  join public.program_versions version on version.program_id = program.id
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and program.created_by_id = current_user_id
    and program.source_type = 'self'
    and program.content_type = 'quick_workout'
    and program.is_current
    and program.archived_at is null
    and version.status = 'published'
  order by version.version_number desc, version.id
  limit 1;
  if source_version_id is null then
    raise exception 'Only one of your published quick workouts can be assigned';
  end if;

  select workout.id
  into source_workout_id
  from public.program_weeks week
  join public.workouts workout on workout.program_week_id = week.id
  where week.program_version_id = source_version_id
  order by week.week_index, workout.position, workout.id
  limit 1;
  if source_workout_id is null then
    raise exception 'The quick workout is missing its session';
  end if;

  if exists (
    select 1
    from public.scheduled_workouts occurrence
    where occurrence.athlete_id = any(target_athlete_ids)
      and occurrence.request_key = target_idempotency_key
      and (
        occurrence.program_version_id is distinct from source_version_id
        or occurrence.workout_id is distinct from source_workout_id
        or occurrence.planned_date is distinct from target_planned_date
      )
  ) then
    raise exception 'Idempotency key was already used for another occurrence';
  end if;

  perform profile.id
  from public.profiles profile
  where profile.id = any(target_athlete_ids)
  order by profile.id
  for update;

  perform assigned.assignment_id
  from public.assign_published_program_version(
    target_program_id,
    source_version_id,
    target_athlete_ids,
    target_idempotency_key
  ) assigned;

  with assignments as materialized (
    select assignment.id, assignment.athlete_id
    from public.program_assignments assignment
    where assignment.athlete_id = any(target_athlete_ids)
      and assignment.source_program_id = target_program_id
      and assignment.status = 'active'
  ),
  inserted_schedules as (
    insert into public.scheduled_workouts (
      athlete_id,
      scheduled_by_id,
      assignment_id,
      program_version_id,
      workout_id,
      planned_date,
      sequence_number,
      status,
      request_key
    )
    select
      assignment.athlete_id,
      current_user_id,
      assignment.id,
      source_version_id,
      source_workout_id,
      target_planned_date,
      coalesce(sequence.maximum_sequence, 0) + 1,
      'planned',
      target_idempotency_key
    from assignments assignment
    left join lateral (
      select max(occurrence.sequence_number) as maximum_sequence
      from public.scheduled_workouts occurrence
      where occurrence.athlete_id = assignment.athlete_id
        and occurrence.program_version_id = source_version_id
    ) sequence on true
    on conflict (athlete_id, request_key)
      where request_key is not null
    do nothing
    returning scheduled_workouts.athlete_id
  )
  select array_agg(inserted.athlete_id)
  into created_athlete_ids
  from inserted_schedules inserted;

  return query
  select
    assignment.athlete_id,
    assignment.id,
    assignment.athlete_id = any(
      coalesce(created_athlete_ids, '{}'::uuid[])
    )
  from public.program_assignments assignment
  join public.scheduled_workouts occurrence
    on occurrence.athlete_id = assignment.athlete_id
   and occurrence.assignment_id = assignment.id
   and occurrence.request_key = target_idempotency_key
  where assignment.athlete_id = any(target_athlete_ids)
    and assignment.source_program_id = target_program_id
    and assignment.status = 'active'
  order by assignment.athlete_id;
end;
$$;

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
  ) then
    raise exception 'Workout session does not match its scheduled workout';
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

create or replace function public.start_scheduled_workout(
  target_scheduled_workout_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  scheduled_occurrence public.scheduled_workouts%rowtype;
  existing_session_id uuid;
  session_id uuid;
  workout_title_value text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select occurrence.*
  into scheduled_occurrence
  from public.scheduled_workouts occurrence
  where occurrence.id = target_scheduled_workout_id
    and occurrence.athlete_id = current_user_id
  for update;
  if not found then
    raise exception 'Scheduled workout is invalid';
  end if;

  perform profile.id
  from public.profiles profile
  where profile.id = current_user_id
  for update;

  if scheduled_occurrence.planned_date is null then
    raise exception 'Undated workout cannot be started';
  end if;
  if scheduled_occurrence.status = 'skipped' then
    raise exception 'Skipped workout must be restored before it can be started';
  end if;
  if scheduled_occurrence.status = 'completed' then
    raise exception 'Completed workout cannot be started again';
  end if;
  if scheduled_occurrence.status = 'in_progress' then
    select session.id
    into existing_session_id
    from public.workout_sessions session
    where session.scheduled_workout_id = scheduled_occurrence.id
      and session.athlete_id = current_user_id
      and session.status = 'in_progress';
    if existing_session_id is null then
      raise exception 'In-progress scheduled workout is missing its session';
    end if;
    return existing_session_id;
  end if;
  if scheduled_occurrence.status is distinct from 'planned' then
    raise exception 'Only a planned workout can be started';
  end if;

  select session.id
  into existing_session_id
  from public.workout_sessions session
  where session.athlete_id = current_user_id
    and session.status = 'in_progress'
  order by session.started_at desc, session.id
  limit 1
  for update;
  if existing_session_id is not null then
    raise exception 'Finish the in-progress workout before starting another';
  end if;

  select workout.title
  into workout_title_value
  from public.workouts workout
  join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = scheduled_occurrence.workout_id
    and week.program_version_id = scheduled_occurrence.program_version_id;
  if workout_title_value is null then
    raise exception 'Workout content is unavailable';
  end if;

  insert into public.workout_sessions (
    athlete_id,
    scheduled_workout_id,
    assignment_id,
    program_version_id,
    workout_id,
    workout_title,
    status
  ) values (
    current_user_id,
    scheduled_occurrence.id,
    scheduled_occurrence.assignment_id,
    scheduled_occurrence.program_version_id,
    scheduled_occurrence.workout_id,
    workout_title_value,
    'in_progress'
  ) returning id into session_id;

  with source_items as materialized (
    select
      item.id,
      item.snapshot_name,
      item.snapshot_cue,
      item.entry_mode,
      item.tracking_fields,
      row_number() over (
        order by section.position, item.position, item.id
      )::integer - 1 as session_position
    from public.workout_sections section
    join public.workout_items item on item.section_id = section.id
    where section.workout_id = scheduled_occurrence.workout_id
  ),
  inserted_items as (
    insert into public.session_item_logs (
      workout_session_id,
      source_workout_item_id,
      snapshot_name,
      snapshot_cue,
      entry_mode,
      tracking_fields,
      position
    )
    select
      session_id,
      item.id,
      item.snapshot_name,
      item.snapshot_cue,
      item.entry_mode,
      item.tracking_fields,
      item.session_position
    from source_items item
    order by item.session_position
    returning id, source_workout_item_id, entry_mode
  ),
  entry_seed as (
    select
      inserted.id as session_item_log_id,
      prescribed.position,
      prescribed.reps_min as reps,
      prescribed.load_kg,
      prescribed.duration_seconds,
      prescribed.distance_metres,
      prescribed.rounds,
      null::numeric as rpe
    from inserted_items inserted
    join public.prescribed_entries prescribed
      on prescribed.workout_item_id = inserted.source_workout_item_id
    union all
    select
      inserted.id,
      0,
      null::numeric,
      null::numeric,
      null::integer,
      null::numeric,
      null::integer,
      null::numeric
    from inserted_items inserted
    where inserted.entry_mode <> 'none'
      and not exists (
        select 1
        from public.prescribed_entries prescribed
        where prescribed.workout_item_id = inserted.source_workout_item_id
      )
  )
  insert into public.session_entries (
    session_item_log_id,
    position,
    reps,
    load_kg,
    duration_seconds,
    distance_metres,
    rounds,
    rpe
  )
  select
    entry.session_item_log_id,
    entry.position,
    entry.reps,
    entry.load_kg,
    entry.duration_seconds,
    entry.distance_metres,
    entry.rounds,
    entry.rpe
  from entry_seed entry;

  update public.scheduled_workouts
  set status = 'in_progress'
  where id = scheduled_occurrence.id
    and athlete_id = current_user_id
    and status = 'planned';
  if not found then
    raise exception 'Scheduled workout changed while it was being started';
  end if;

  return session_id;
end;
$$;

drop function if exists public.start_or_resume_workout(uuid, uuid, uuid);

-- Bottom-up JSON aggregation reads each content table once. These helpers are
-- private so callers cannot use them to bypass the authorization performed by
-- the bounded public RPC that selected the version or workout.
create or replace function private.workout_content_payload(
  target_workout_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with prescribed_payload as (
    select
      prescribed.workout_item_id,
      jsonb_agg(
        jsonb_build_object(
          'id', prescribed.id,
          'position', prescribed.position,
          'repsMin', prescribed.reps_min,
          'repsMax', prescribed.reps_max,
          'loadKg', prescribed.load_kg,
          'durationSeconds', prescribed.duration_seconds,
          'distanceMetres', prescribed.distance_metres,
          'rounds', prescribed.rounds,
          'workSeconds', prescribed.work_seconds,
          'restSeconds', prescribed.rest_seconds,
          'targetRpeMin', prescribed.target_rpe_min,
          'targetRpeMax', prescribed.target_rpe_max,
          'targetText', prescribed.target_text
        ) order by prescribed.position, prescribed.id
      ) as entries
    from public.prescribed_entries prescribed
    join public.workout_items item on item.id = prescribed.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    where section.workout_id = target_workout_id
    group by prescribed.workout_item_id
  ),
  item_payload as (
    select
      item.section_id,
      jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'sourceExerciseId', item.source_exercise_id,
          'name', item.snapshot_name,
          'cue', item.snapshot_cue,
          'entryMode', item.entry_mode,
          'trackingFields', item.tracking_fields,
          'position', item.position,
          'prescribedEntries', coalesce(prescribed.entries, '[]'::jsonb)
        ) order by item.position, item.id
      ) as items
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    left join prescribed_payload prescribed
      on prescribed.workout_item_id = item.id
    where section.workout_id = target_workout_id
    group by item.section_id
  ),
  section_payload as (
    select
      section.workout_id,
      jsonb_agg(
        jsonb_build_object(
          'id', section.id,
          'title', section.title,
          'kind', section.section_kind,
          'notes', section.notes,
          'position', section.position,
          'items', coalesce(item.items, '[]'::jsonb)
        ) order by section.position, section.id
      ) as sections
    from public.workout_sections section
    left join item_payload item on item.section_id = section.id
    where section.workout_id = target_workout_id
    group by section.workout_id
  )
  select jsonb_build_object(
    'id', workout.id,
    'title', workout.title,
    'scheduleLabel', workout.schedule_label,
    'dayOfWeek', workout.day_of_week,
    'position', workout.position,
    'estimatedMinutes', workout.estimated_minutes,
    'sections', coalesce(section.sections, '[]'::jsonb)
  )
  from public.workouts workout
  left join section_payload section on section.workout_id = workout.id
  where workout.id = target_workout_id;
$$;

create or replace function private.program_version_content_payload(
  target_program_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with prescribed_payload as (
    select
      prescribed.workout_item_id,
      jsonb_agg(
        jsonb_build_object(
          'id', prescribed.id,
          'position', prescribed.position,
          'repsMin', prescribed.reps_min,
          'repsMax', prescribed.reps_max,
          'loadKg', prescribed.load_kg,
          'durationSeconds', prescribed.duration_seconds,
          'distanceMetres', prescribed.distance_metres,
          'rounds', prescribed.rounds,
          'workSeconds', prescribed.work_seconds,
          'restSeconds', prescribed.rest_seconds,
          'targetRpeMin', prescribed.target_rpe_min,
          'targetRpeMax', prescribed.target_rpe_max,
          'targetText', prescribed.target_text
        ) order by prescribed.position, prescribed.id
      ) as entries
    from public.prescribed_entries prescribed
    join public.workout_items item on item.id = prescribed.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_program_version_id
    group by prescribed.workout_item_id
  ),
  item_payload as (
    select
      item.section_id,
      jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'sourceExerciseId', item.source_exercise_id,
          'name', item.snapshot_name,
          'cue', item.snapshot_cue,
          'entryMode', item.entry_mode,
          'trackingFields', item.tracking_fields,
          'position', item.position,
          'prescribedEntries', coalesce(prescribed.entries, '[]'::jsonb)
        ) order by item.position, item.id
      ) as items
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join prescribed_payload prescribed
      on prescribed.workout_item_id = item.id
    where week.program_version_id = target_program_version_id
    group by item.section_id
  ),
  section_payload as (
    select
      section.workout_id,
      jsonb_agg(
        jsonb_build_object(
          'id', section.id,
          'title', section.title,
          'kind', section.section_kind,
          'notes', section.notes,
          'position', section.position,
          'items', coalesce(item.items, '[]'::jsonb)
        ) order by section.position, section.id
      ) as sections
    from public.workout_sections section
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join item_payload item on item.section_id = section.id
    where week.program_version_id = target_program_version_id
    group by section.workout_id
  ),
  workout_payload as (
    select
      workout.program_week_id,
      jsonb_agg(
        jsonb_build_object(
          'id', workout.id,
          'title', workout.title,
          'scheduleLabel', workout.schedule_label,
          'dayOfWeek', workout.day_of_week,
          'position', workout.position,
          'estimatedMinutes', workout.estimated_minutes,
          'sections', coalesce(section.sections, '[]'::jsonb)
        ) order by workout.position, workout.id
      ) as workouts
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    left join section_payload section on section.workout_id = workout.id
    where week.program_version_id = target_program_version_id
    group by workout.program_week_id
  ),
  week_payload as (
    select jsonb_agg(
      jsonb_build_object(
        'id', week.id,
        'phaseId', week.phase_id,
        'weekIndex', week.week_index,
        'label', week.label,
        'workouts', coalesce(workout.workouts, '[]'::jsonb)
      ) order by week.week_index, week.id
    ) as weeks
    from public.program_weeks week
    left join workout_payload workout on workout.program_week_id = week.id
    where week.program_version_id = target_program_version_id
  ),
  phase_payload as (
    select jsonb_agg(
      jsonb_build_object(
        'id', phase.id,
        'name', phase.name,
        'position', phase.position
      ) order by phase.position, phase.id
    ) as phases
    from public.program_phases phase
    where phase.program_version_id = target_program_version_id
  )
  select jsonb_build_object(
    'phases', coalesce(phase.phases, '[]'::jsonb),
    'weeks', coalesce(week.weeks, '[]'::jsonb)
  )
  from phase_payload phase
  cross join week_payload week;
$$;

create or replace function public.get_workspace_bootstrap()
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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  with active_session as materialized (
    select session.*
    from public.workout_sessions session
    where session.athlete_id = current_user_id
      and session.status = 'in_progress'
    order by session.started_at desc, session.id
    limit 1
  )
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profile.id,
      'firstName', profile.first_name,
      'lastName', profile.last_name,
      'displayName', profile.display_name,
      'liftlogId', profile.liftlog_id,
      'weekStartsOnSunday', profile.week_starts_on_sunday,
      'weightUnit', profile.weight_unit,
      'distanceUnit', profile.distance_unit,
      'timezone', profile.timezone
    ),
    'coachingAccess', jsonb_build_object(
      'hasCoach', exists (
        select 1
        from public.coach_relationships relationship
        where relationship.athlete_id = current_user_id
          and relationship.ended_at is null
      ),
      'coachedAthleteCount', (
        select count(*)
        from public.coach_relationships relationship
        where relationship.coach_id = current_user_id
          and relationship.ended_at is null
      ),
      'pendingInviteCount', (
        select count(*)
        from public.coach_invites invite
        where invite.invited_profile_id = current_user_id
          and invite.status = 'pending'
          and invite.expires_at > now()
      )
    ),
    'activeSession', (
      select jsonb_build_object(
        'id', session.id,
        'draftRevision', session.draft_revision,
        'draftWriteToken', session.draft_write_token,
        'draftSavedAt', session.draft_saved_at,
        'assignmentId', session.assignment_id,
        'programVersionId', session.program_version_id,
        'workoutId', session.workout_id,
        'scheduledWorkoutId', session.scheduled_workout_id,
        'workoutTitle', session.workout_title,
        'startedAt', session.started_at,
        'sessionRpe', session.session_rpe,
        'sessionNote', session.athlete_note,
        'itemLogIds', coalesce((
          select jsonb_object_agg(
            item.source_workout_item_id::text,
            item.id
            order by item.position, item.id
          ) filter (where item.source_workout_item_id is not null)
          from public.session_item_logs item
          where item.workout_session_id = session.id
        ), '{}'::jsonb),
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'itemLogId', item.id,
              'sourceWorkoutItemId', item.source_workout_item_id,
              'name', item.snapshot_name,
              'cue', item.snapshot_cue,
              'entryMode', item.entry_mode,
              'trackingFields', item.tracking_fields,
              'position', item.position,
              'note', item.athlete_note,
              'entries', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', entry.id,
                    'position', entry.position,
                    'reps', entry.reps,
                    'loadKg', entry.load_kg,
                    'durationSeconds', entry.duration_seconds,
                    'distanceMetres', entry.distance_metres,
                    'rounds', entry.rounds,
                    'heartRate', entry.heart_rate,
                    'rpe', entry.rpe,
                    'note', entry.note
                  ) order by entry.position, entry.id
                )
                from public.session_entries entry
                where entry.session_item_log_id = item.id
              ), '[]'::jsonb)
            ) order by item.position, item.id
          )
          from public.session_item_logs item
          where item.workout_session_id = session.id
        ), '[]'::jsonb)
      )
      from active_session session
    ),
    'activeWorkout', (
      select private.workout_content_payload(session.workout_id)
      from active_session session
    ),
    'nextWorkouts', coalesce((
      select jsonb_agg(next_workout.payload order by next_workout.sort_status, next_workout.planned_date, next_workout.id)
      from (
        select
          occurrence.id,
          occurrence.planned_date,
          case when occurrence.status = 'in_progress' then 0 else 1 end as sort_status,
          jsonb_build_object(
            'id', occurrence.id,
            'assignmentId', occurrence.assignment_id,
            'programVersionId', occurrence.program_version_id,
            'workoutId', occurrence.workout_id,
            'workoutTitle', workout.title,
            'programTitle', version.title,
            'plannedDate', occurrence.planned_date,
            'sequenceNumber', occurrence.sequence_number,
            'status', occurrence.status
          ) as payload
        from public.scheduled_workouts occurrence
        join public.workouts workout on workout.id = occurrence.workout_id
        join public.program_versions version on version.id = occurrence.program_version_id
        where occurrence.athlete_id = current_user_id
          and occurrence.status in ('planned', 'in_progress')
          and occurrence.planned_date is not null
        order by sort_status, occurrence.planned_date, occurrence.id
        limit 6
      ) next_workout
    ), '[]'::jsonb)
  )
  into result_payload
  from public.profiles profile
  where profile.id = current_user_id;

  return result_payload;
end;
$$;

create or replace function public.list_program_summaries(
  page_limit integer default 25,
  after_created_at timestamptz default null,
  after_id uuid default null
)
returns table (
  kind text,
  id uuid,
  program_id uuid,
  assignment_id uuid,
  customized_program_id uuid,
  athlete_id uuid,
  version_id uuid,
  version_status text,
  title text,
  description text,
  source_type text,
  content_type text,
  created_by_id uuid,
  created_at timestamptz,
  week_count bigint,
  workout_count bigint
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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if (after_created_at is null) <> (after_id is null) then
    raise exception 'Program cursor is incomplete';
  end if;

  return query
  with visible_programs as materialized (
    select
      'program'::text as kind,
      program.id,
      program.id as program_id,
      null::uuid as assignment_id,
      null::uuid as customized_program_id,
      program.athlete_id,
      version.id as version_id,
      version.status as version_status,
      version.title,
      version.description,
      program.source_type,
      program.content_type,
      program.created_by_id,
      program.created_at
    from public.programs program
    join lateral (
      select candidate.id, candidate.status, candidate.title, candidate.description
      from public.program_versions candidate
      where candidate.program_id = program.id
      order by
        case candidate.status when 'draft' then 0 when 'published' then 1 else 2 end,
        candidate.version_number desc,
        candidate.id
      limit 1
    ) version on true
    where program.athlete_id = current_user_id
      and program.archived_at is null
      and not exists (
        select 1
        from public.program_assignments assignment
        where assignment.customized_program_id = program.id
      )

    union all

    select
      'assignment'::text,
      assignment.id,
      content_program.id,
      assignment.id,
      assignment.customized_program_id,
      assignment.athlete_id,
      version.id,
      version.status,
      version.title,
      version.description,
      'coach'::text,
      content_program.content_type,
      assignment.assigned_by_id,
      assignment.assigned_at
    from public.program_assignments assignment
    join public.program_versions version
      on version.id = private.assignment_content_version(assignment.id)
    join public.programs content_program on content_program.id = version.program_id
    where assignment.athlete_id = current_user_id
      and assignment.status = 'active'
  ),
  page as materialized (
    select visible.*
    from visible_programs visible
    where after_created_at is null
      or (visible.created_at, visible.id) < (after_created_at, after_id)
    order by visible.created_at desc, visible.id desc
    limit least(greatest(coalesce(page_limit, 25), 1), 50)
  )
  select
    page.kind,
    page.id,
    page.program_id,
    page.assignment_id,
    page.customized_program_id,
    page.athlete_id,
    page.version_id,
    page.version_status,
    page.title,
    page.description,
    page.source_type,
    page.content_type,
    page.created_by_id,
    page.created_at,
    content_count.week_count,
    content_count.workout_count
  from page
  cross join lateral (
    select
      count(distinct week.id) as week_count,
      count(workout.id) as workout_count
    from public.program_weeks week
    left join public.workouts workout on workout.program_week_id = week.id
    where week.program_version_id = page.version_id
  ) content_count
  order by page.created_at desc, page.id desc;
end;
$$;

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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if (target_program_id is null) = (target_assignment_id is null) then
    raise exception 'Choose exactly one program or assignment';
  end if;

  if target_assignment_id is not null then
    select assignment.*
    into selected_assignment
    from public.program_assignments assignment
    where assignment.id = target_assignment_id
      and assignment.status = 'active'
      and (
        assignment.athlete_id = current_user_id
        or (
          assignment.assigned_by_id = current_user_id
          and exists (
            select 1
            from public.coach_relationships relationship
            where relationship.athlete_id = assignment.athlete_id
              and relationship.coach_id = current_user_id
              and relationship.ended_at is null
          )
        )
      );
    if not found then
      return null;
    end if;

    may_read_draft := selected_assignment.assigned_by_id = current_user_id
      and exists (
        select 1
        from public.coach_relationships relationship
        where relationship.athlete_id = selected_assignment.athlete_id
          and relationship.coach_id = current_user_id
          and relationship.ended_at is null
      );

    if target_version_id is not null then
      select version.*
      into selected_version
      from public.program_versions version
      where version.id = target_version_id
        and (
          version.id = selected_assignment.source_version_id
          or version.program_id = selected_assignment.customized_program_id
        )
        and (version.status <> 'draft' or may_read_draft);
    elsif may_read_draft and selected_assignment.customized_program_id is not null then
      select version.*
      into selected_version
      from public.program_versions version
      where version.program_id = selected_assignment.customized_program_id
      order by
        case version.status when 'draft' then 0 when 'published' then 1 else 2 end,
        version.version_number desc,
        version.id
      limit 1;
    else
      select version.*
      into selected_version
      from public.program_versions version
      where version.id = private.assignment_content_version(selected_assignment.id);
    end if;
  else
    select program.*
    into selected_program
    from public.programs program
    where program.id = target_program_id
      and (
        program.athlete_id = current_user_id
        or (
          program.created_by_id = current_user_id
          and program.source_type = 'coach'
          and exists (
            select 1
            from public.coach_relationships relationship
            where relationship.athlete_id = program.athlete_id
              and relationship.coach_id = current_user_id
              and relationship.ended_at is null
          )
        )
      );
    if not found then
      return null;
    end if;

    if target_version_id is not null then
      select version.*
      into selected_version
      from public.program_versions version
      where version.id = target_version_id
        and version.program_id = selected_program.id;
    else
      select version.*
      into selected_version
      from public.program_versions version
      where version.program_id = selected_program.id
      order by
        case version.status when 'draft' then 0 when 'published' then 1 else 2 end,
        version.version_number desc,
        version.id
      limit 1;
    end if;
  end if;

  if selected_version.id is null then
    return null;
  end if;
  select program.*
  into selected_program
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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'id', occurrence.id,
    'athleteId', occurrence.athlete_id,
    'scheduledById', occurrence.scheduled_by_id,
    'assignmentId', occurrence.assignment_id,
    'programId', version.program_id,
    'programVersionId', occurrence.program_version_id,
    'programTitle', version.title,
    'workoutId', occurrence.workout_id,
    'plannedDate', occurrence.planned_date,
    'sequenceNumber', occurrence.sequence_number,
    'status', occurrence.status,
    'workout', private.workout_content_payload(occurrence.workout_id)
  )
  into result_payload
  from public.scheduled_workouts occurrence
  join public.program_versions version on version.id = occurrence.program_version_id
  where occurrence.id = target_schedule_id
    and (
      occurrence.athlete_id = current_user_id
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
          from public.programs program
          where program.id = version.program_id
            and program.athlete_id = occurrence.athlete_id
            and program.created_by_id = current_user_id
            and program.source_type = 'coach'
            and exists (
              select 1
              from public.coach_relationships relationship
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

create or replace function public.list_calendar_occurrences(
  range_start date,
  range_end date,
  page_limit integer default 100,
  after_planned_date date default null,
  after_id uuid default null
)
returns table (
  id uuid,
  assignment_id uuid,
  program_id uuid,
  program_version_id uuid,
  program_title text,
  workout_id uuid,
  workout_title text,
  planned_date date,
  sequence_number integer,
  status text,
  scheduled_by_id uuid
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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if range_start is null or range_end is null
    or range_end < range_start
    or range_end - range_start > 92 then
    raise exception 'Calendar range must span 1 to 93 days';
  end if;
  if (after_planned_date is null) <> (after_id is null) then
    raise exception 'Calendar cursor is incomplete';
  end if;

  return query
  select
    occurrence.id,
    occurrence.assignment_id,
    version.program_id,
    occurrence.program_version_id,
    version.title,
    occurrence.workout_id,
    workout.title,
    occurrence.planned_date,
    occurrence.sequence_number,
    occurrence.status,
    occurrence.scheduled_by_id
  from public.scheduled_workouts occurrence
  join public.program_versions version on version.id = occurrence.program_version_id
  join public.workouts workout on workout.id = occurrence.workout_id
  where occurrence.athlete_id = current_user_id
    and occurrence.planned_date between range_start and range_end
    and (
      after_planned_date is null
      or (occurrence.planned_date, occurrence.id)
        > (after_planned_date, after_id)
    )
  order by occurrence.planned_date, occurrence.id
  limit least(greatest(coalesce(page_limit, 100), 1), 200);
end;
$$;

create or replace function public.list_completed_session_summaries(
  page_limit integer default 50,
  before_started_at timestamptz default null,
  before_id uuid default null
)
returns table (
  id uuid,
  assignment_id uuid,
  scheduled_workout_id uuid,
  program_version_id uuid,
  workout_id uuid,
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
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if (before_started_at is null) <> (before_id is null) then
    raise exception 'History cursor is incomplete';
  end if;

  return query
  select
    session.id,
    session.assignment_id,
    session.scheduled_workout_id,
    session.program_version_id,
    session.workout_id,
    session.workout_title,
    session.started_at,
    session.completed_at,
    session.completed_for_date,
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

create or replace function public.list_calendar_session_summaries(
  range_start date,
  range_end date,
  page_limit integer default 100
)
returns table (
  id uuid,
  assignment_id uuid,
  scheduled_workout_id uuid,
  program_version_id uuid,
  workout_id uuid,
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
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if range_start is null or range_end is null
    or range_end < range_start
    or range_end - range_start > 92 then
    raise exception 'Calendar range must span 1 to 93 days';
  end if;

  return query
  select
    session.id,
    session.assignment_id,
    session.scheduled_workout_id,
    session.program_version_id,
    session.workout_id,
    session.workout_title,
    session.started_at,
    session.completed_at,
    session.completed_for_date,
    session.session_rpe
  from public.workout_sessions session
  where session.athlete_id = current_user_id
    and session.status = 'completed'
    and session.completed_for_date between range_start and range_end
  order by session.completed_for_date, session.id
  limit least(greatest(coalesce(page_limit, 100), 1), 200);
end;
$$;

create or replace function public.search_exercises(
  search_text text default '',
  scope_filter text default 'all',
  discipline_filters text[] default null,
  category_filters text[] default null,
  mode_filters text[] default null,
  tracking_filters text[] default null,
  page_limit integer default 50,
  after_name text default null,
  after_id uuid default null
)
returns table (
  id uuid,
  scope text,
  owner_id uuid,
  name text,
  category text,
  cue text,
  default_entry_mode text,
  default_tracking_fields text[],
  discipline text,
  tags text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  normalized_search text := lower(trim(coalesce(search_text, '')));
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if length(normalized_search) > 100 then
    raise exception 'Exercise search is too long';
  end if;
  if scope_filter not in ('all', 'global', 'personal') then
    raise exception 'Exercise scope is invalid';
  end if;
  if coalesce(cardinality(discipline_filters), 0) > 3
    or not coalesce(
      discipline_filters <@ array['weightlifting', 'gym', 'functional']::text[],
      true
    ) then
    raise exception 'Exercise discipline is invalid';
  end if;
  if coalesce(cardinality(category_filters), 0) > 20
    or exists (
      select 1 from unnest(coalesce(category_filters, '{}'::text[])) category
      where length(trim(category)) = 0 or length(category) > 80
    ) then
    raise exception 'Exercise category filter is invalid';
  end if;
  if coalesce(cardinality(mode_filters), 0) > 4
    or not coalesce(
      mode_filters <@ array['none', 'sets', 'result', 'intervals']::text[],
      true
    ) then
    raise exception 'Exercise logging filter is invalid';
  end if;
  if coalesce(cardinality(tracking_filters), 0) > 8
    or not coalesce(
      tracking_filters <@ array[
        'reps', 'load', 'duration', 'distance', 'rounds', 'heartRate', 'rpe'
      ]::text[],
      true
    ) then
    raise exception 'Exercise tracking filter is invalid';
  end if;
  if (after_name is null) <> (after_id is null) then
    raise exception 'Exercise cursor is incomplete';
  end if;

  return query
  select
    exercise.id,
    exercise.scope,
    exercise.owner_id,
    exercise.name,
    exercise.category,
    exercise.cue,
    exercise.default_entry_mode,
    exercise.default_tracking_fields,
    exercise.discipline,
    exercise.tags
  from public.exercises exercise
  where exercise.archived_at is null
    and (
      exercise.scope = 'global'
      or (exercise.scope = 'personal' and exercise.owner_id = current_user_id)
    )
    and (scope_filter = 'all' or exercise.scope = scope_filter)
    and (
      coalesce(cardinality(discipline_filters), 0) = 0
      or exercise.discipline = any(discipline_filters)
    )
    and (
      coalesce(cardinality(category_filters), 0) = 0
      or exercise.category = any(category_filters)
    )
    and (
      coalesce(cardinality(mode_filters), 0) = 0
      or exercise.default_entry_mode = any(mode_filters)
    )
    and exercise.default_tracking_fields
      @> coalesce(tracking_filters, '{}'::text[])
    and (
      normalized_search = ''
      or (
        lower(exercise.name) >= normalized_search
        and lower(exercise.name) < normalized_search || U&'\FFFF'
      )
    )
    and (
      after_name is null
      or (lower(exercise.name), exercise.id)
        > (lower(after_name), after_id)
    )
  order by lower(exercise.name), exercise.id
  limit least(greatest(coalesce(page_limit, 50), 1), 100);
end;
$$;

-- Calendar candidate discovery returns only identifiers and display metadata;
-- complete workout trees remain lazy behind get_scheduled_workout_detail or
-- get_program_version_detail. Candidate rows are paged before occurrence lookup.
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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
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
        and candidate.status = 'published'
      order by candidate.version_number desc, candidate.id
      limit 1
    ) version on true
    where program.athlete_id = current_user_id
      and program.is_current
      and program.archived_at is null
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
  ),
  candidate_page as materialized (
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
    candidate.content_type = 'quick_workout' as is_quick_workout,
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
    select
      occurrence.id,
      occurrence.planned_date,
      occurrence.status,
      occurrence.sequence_number
    from public.scheduled_workouts occurrence
    where occurrence.athlete_id = current_user_id
      and occurrence.program_version_id = candidate.program_version_id
      and occurrence.workout_id = candidate.workout_id
      and occurrence.assignment_id is not distinct from candidate.assignment_id
    order by occurrence.sequence_number desc nulls last, occurrence.id desc
    limit 1
  ) latest on true
  order by
    lower(candidate.program_title),
    candidate.week_index,
    candidate.workout_position,
    candidate.workout_id;
end;
$$;

create or replace function public.get_coaching_access_summary()
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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'coachConnections', coalesce((
      select jsonb_agg(connection.payload order by connection.accepted_at, connection.relationship_id)
      from (
        select
          relationship.id as relationship_id,
          relationship.accepted_at,
          jsonb_build_object(
            'relationshipId', relationship.id,
            'coachId', coach.id,
            'coachName', coach.display_name,
            'connectedSince', relationship.accepted_at::date
          ) as payload
        from public.coach_relationships relationship
        join public.profiles coach on coach.id = relationship.coach_id
        where relationship.athlete_id = current_user_id
          and relationship.ended_at is null
        order by relationship.accepted_at, relationship.id
        limit 25
      ) connection
    ), '[]'::jsonb),
    'pendingCoachInvites', coalesce((
      select jsonb_agg(invitation.payload order by invitation.created_at, invitation.id)
      from (
        select
          request.id,
          request.created_at,
          jsonb_build_object(
            'id', request.id,
            'athleteId', athlete.id,
            'athleteName', athlete.display_name,
            'createdAt', request.created_at,
            'expiresAt', request.expires_at
          ) as payload
        from public.coach_invites request
        join public.profiles athlete on athlete.id = request.athlete_id
        where request.invited_profile_id = current_user_id
          and request.status = 'pending'
          and request.expires_at > current_timestamp
        order by request.created_at, request.id
        limit 25
      ) invitation
    ), '[]'::jsonb),
    'outgoingCoachInvites', coalesce((
      select jsonb_agg(invitation.payload order by invitation.created_at desc, invitation.id desc)
      from (
        select
          request.id,
          request.created_at,
          jsonb_build_object(
            'id', request.id,
            'coachId', coach.id,
            'coachName', coach.display_name,
            'createdAt', request.created_at,
            'expiresAt', request.expires_at
          ) as payload
        from public.coach_invites request
        join public.profiles coach on coach.id = request.invited_profile_id
        where request.athlete_id = current_user_id
          and request.status = 'pending'
          and request.expires_at > current_timestamp
        order by request.created_at desc, request.id desc
        limit 25
      ) invitation
    ), '[]'::jsonb)
  ) into result_payload;

  return result_payload;
end;
$$;

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
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if (after_display_name is null) <> (after_id is null) then
    raise exception 'Coach athlete cursor is incomplete';
  end if;

  return query
  with relationship_page as materialized (
    select
      athlete.id,
      relationship.id as relationship_id,
      athlete.display_name
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
  ),
  assignment_counts as (
    select assignment.athlete_id, count(*) as assignment_count
    from public.program_assignments assignment
    join relationship_page page on page.id = assignment.athlete_id
    where assignment.assigned_by_id = current_user_id
      and assignment.status = 'active'
    group by assignment.athlete_id
  ),
  standalone_counts as (
    select program.athlete_id, count(*) as program_count
    from public.programs program
    join relationship_page page on page.id = program.athlete_id
    where program.created_by_id = current_user_id
      and program.source_type = 'coach'
      and program.is_current
      and program.archived_at is null
      and not exists (
        select 1
        from public.program_assignments assignment
        where assignment.customized_program_id = program.id
      )
      and exists (
        select 1
        from public.program_versions version
        where version.program_id = program.id
          and version.status = 'published'
      )
    group by program.athlete_id
  )
  select
    page.id,
    page.relationship_id,
    page.display_name,
    coalesce(assignment.assignment_count, 0)
      + coalesce(standalone.program_count, 0) as assigned_program_count
  from relationship_page page
  left join assignment_counts assignment on assignment.athlete_id = page.id
  left join standalone_counts standalone on standalone.athlete_id = page.id
  order by lower(page.display_name), page.id;
end;
$$;

create or replace function public.get_coach_athlete_detail(
  target_athlete_id uuid,
  program_limit integer default 25,
  upcoming_limit integer default 6,
  completed_limit integer default 6
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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  with relationship_scope as materialized (
    select
      relationship.id as relationship_id,
      athlete.id as athlete_id,
      athlete.display_name,
      case
        when exists (
          select 1
          from pg_catalog.pg_timezone_names timezone_name
          where timezone_name.name = athlete.timezone
        ) then (current_timestamp at time zone athlete.timezone)::date
        else current_date
      end as today
    from public.coach_relationships relationship
    join public.profiles athlete on athlete.id = relationship.athlete_id
    where relationship.coach_id = current_user_id
      and relationship.athlete_id = target_athlete_id
      and relationship.ended_at is null
  ),
  authored_programs as materialized (
    select
      'assignment'::text as kind,
      assignment.id,
      assignment.id as assignment_id,
      version.program_id,
      version.id as version_id,
      version.title,
      assignment.assigned_at as created_at
    from public.program_assignments assignment
    join relationship_scope scope on scope.athlete_id = assignment.athlete_id
    join public.program_versions version
      on version.id = private.assignment_content_version(assignment.id)
    where assignment.assigned_by_id = current_user_id
      and assignment.status = 'active'

    union all

    select
      'program'::text,
      program.id,
      null::uuid,
      program.id,
      version.id,
      version.title,
      program.created_at
    from public.programs program
    join relationship_scope scope on scope.athlete_id = program.athlete_id
    join lateral (
      select candidate.id, candidate.title
      from public.program_versions candidate
      where candidate.program_id = program.id
        and candidate.status = 'published'
      order by candidate.version_number desc, candidate.id
      limit 1
    ) version on true
    where program.created_by_id = current_user_id
      and program.source_type = 'coach'
      and program.is_current
      and program.archived_at is null
      and not exists (
        select 1
        from public.program_assignments assignment
        where assignment.customized_program_id = program.id
      )
  ),
  program_page as materialized (
    select authored.*
    from authored_programs authored
    order by authored.created_at desc, authored.id desc
    limit least(greatest(coalesce(program_limit, 25), 1), 50)
  ),
  content_stats as (
    select
      page.id,
      count(distinct week.id)::integer as total_weeks,
      count(workout.id)::integer as total_workouts
    from program_page page
    left join public.program_weeks week
      on week.program_version_id = page.version_id
    left join public.workouts workout on workout.program_week_id = week.id
    group by page.id
  ),
  schedule_stats as (
    select
      page.id,
      count(occurrence.id)::integer as scheduled_workouts,
      count(occurrence.id) filter (
        where occurrence.status = 'completed'
      )::integer as completed_workouts
    from program_page page
    left join public.scheduled_workouts occurrence
      on occurrence.athlete_id = target_athlete_id
     and (
       (page.assignment_id is not null
         and occurrence.assignment_id = page.assignment_id)
       or (page.assignment_id is null
         and occurrence.assignment_id is null
         and occurrence.program_version_id = page.version_id)
     )
    group by page.id
  ),
  ranked_next as (
    select
      page.id as authored_program_id,
      occurrence.id,
      occurrence.planned_date,
      occurrence.status,
      occurrence.workout_id,
      workout.title as workout_title,
      row_number() over (
        partition by page.id
        order by
          case when occurrence.status = 'in_progress' then 0 else 1 end,
          occurrence.planned_date,
          occurrence.id
      ) as rank
    from program_page page
    join public.scheduled_workouts occurrence
      on occurrence.athlete_id = target_athlete_id
     and occurrence.status in ('planned', 'in_progress')
     and occurrence.planned_date is not null
     and (
       (page.assignment_id is not null
         and occurrence.assignment_id = page.assignment_id)
       or (page.assignment_id is null
         and occurrence.assignment_id is null
         and occurrence.program_version_id = page.version_id)
     )
    join public.workouts workout on workout.id = occurrence.workout_id
  ),
  program_payload as (
    select
      page.id,
      page.created_at,
      jsonb_build_object(
        'kind', page.kind,
        'id', page.id,
        'assignmentId', page.assignment_id,
        'programId', page.program_id,
        'versionId', page.version_id,
        'title', page.title,
        'assignedAt', page.created_at,
        'totalWeeks', content.total_weeks,
        'totalWorkouts', content.total_workouts,
        'scheduledWorkouts', schedule.scheduled_workouts,
        'completedWorkouts', schedule.completed_workouts,
        'nextWorkout', case when next.id is null then null else jsonb_build_object(
          'id', next.id,
          'workoutId', next.workout_id,
          'workoutTitle', next.workout_title,
          'plannedDate', next.planned_date,
          'status', next.status
        ) end
      ) as payload
    from program_page page
    join content_stats content on content.id = page.id
    join schedule_stats schedule on schedule.id = page.id
    left join ranked_next next
      on next.authored_program_id = page.id
     and next.rank = 1
  ),
  authored_upcoming as materialized (
    select
      occurrence.id,
      occurrence.planned_date,
      occurrence.status,
      jsonb_build_object(
        'id', occurrence.id,
        'assignmentId', occurrence.assignment_id,
        'programId', version.program_id,
        'programVersionId', occurrence.program_version_id,
        'programTitle', version.title,
        'workoutId', occurrence.workout_id,
        'workoutTitle', workout.title,
        'plannedDate', occurrence.planned_date,
        'status', occurrence.status
      ) as payload
    from public.scheduled_workouts occurrence
    join public.program_versions version on version.id = occurrence.program_version_id
    join public.workouts workout on workout.id = occurrence.workout_id
    join relationship_scope scope on scope.athlete_id = occurrence.athlete_id
    where occurrence.status in ('planned', 'in_progress')
      and occurrence.planned_date is not null
      and (
        exists (
          select 1
          from public.program_assignments assignment
          where assignment.id = occurrence.assignment_id
            and assignment.assigned_by_id = current_user_id
        )
        or (
          occurrence.assignment_id is null
          and exists (
            select 1
            from public.programs program
            where program.id = version.program_id
              and program.created_by_id = current_user_id
              and program.source_type = 'coach'
          )
        )
      )
    order by
      case when occurrence.status = 'in_progress' then 0 else 1 end,
      occurrence.planned_date,
      occurrence.id
    limit least(greatest(coalesce(upcoming_limit, 6), 1), 12)
  ),
  authored_completed as materialized (
    select
      session.id,
      session.started_at,
      jsonb_build_object(
        'id', session.id,
        'assignmentId', session.assignment_id,
        'programId', version.program_id,
        'programVersionId', session.program_version_id,
        'programTitle', version.title,
        'workoutId', session.workout_id,
        'workoutTitle', session.workout_title,
        'scheduledWorkoutId', session.scheduled_workout_id,
        'completedAt', session.completed_at,
        'completedForDate', session.completed_for_date,
        'sessionRpe', session.session_rpe
      ) as payload
    from public.workout_sessions session
    join public.program_versions version on version.id = session.program_version_id
    join relationship_scope scope on scope.athlete_id = session.athlete_id
    where session.status = 'completed'
      and (
        exists (
          select 1
          from public.program_assignments assignment
          where assignment.id = session.assignment_id
            and assignment.assigned_by_id = current_user_id
        )
        or (
          session.assignment_id is null
          and exists (
            select 1
            from public.programs program
            where program.id = version.program_id
              and program.created_by_id = current_user_id
              and program.source_type = 'coach'
          )
        )
      )
    order by session.started_at desc, session.id desc
    limit least(greatest(coalesce(completed_limit, 6), 1), 12)
  )
  select jsonb_build_object(
    'athlete', jsonb_build_object(
      'id', scope.athlete_id,
      'relationshipId', scope.relationship_id,
      'displayName', scope.display_name
    ),
    'assignedProgramCount', (select count(*) from authored_programs),
    'programs', coalesce((
      select jsonb_agg(program.payload order by program.created_at desc, program.id desc)
      from program_payload program
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(upcoming.payload order by
        case when upcoming.status = 'in_progress' then 0 else 1 end,
        upcoming.planned_date,
        upcoming.id
      )
      from authored_upcoming upcoming
    ), '[]'::jsonb),
    'completed', coalesce((
      select jsonb_agg(completed.payload order by completed.started_at desc, completed.id desc)
      from authored_completed completed
    ), '[]'::jsonb)
  )
  into result_payload
  from relationship_scope scope;

  return result_payload;
end;
$$;

-- Preserve coach feedback/read behavior for new shared-assignment sessions.
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
    where session.id = target_session_id
      and (
        assignment.assigned_by_id = (select auth.uid())
        or (
          session.assignment_id is null
          and program.athlete_id = session.athlete_id
          and program.created_by_id = (select auth.uid())
          and program.source_type = 'coach'
        )
      )
  );
$$;

create index idx_programs_athlete_created_cursor
  on public.programs (athlete_id, created_at desc, id desc)
  where archived_at is null;

create index idx_scheduled_workouts_athlete_open_calendar
  on public.scheduled_workouts (athlete_id, status, planned_date, id)
  where planned_date is not null and status in ('planned', 'in_progress');

create index idx_scheduled_workouts_assignment_open_calendar
  on public.scheduled_workouts (assignment_id, status, planned_date, id)
  where assignment_id is not null
    and planned_date is not null
    and status in ('planned', 'in_progress');

create index idx_workout_sessions_assignment_completed_cursor
  on public.workout_sessions (assignment_id, started_at desc, id desc)
  where assignment_id is not null and status = 'completed';

drop index if exists public.idx_scheduled_workouts_athlete_date;

drop policy if exists scheduled_workouts_read_authorized
  on public.scheduled_workouts;
create policy scheduled_workouts_read_authorized
on public.scheduled_workouts for select to authenticated
using (
  athlete_id = (select auth.uid())
  or (
    assignment_id is not null
    and exists (
      select 1
      from public.program_assignments assignment
      join public.coach_relationships relationship
        on relationship.athlete_id = assignment.athlete_id
       and relationship.coach_id = (select auth.uid())
       and relationship.ended_at is null
      where assignment.id = scheduled_workouts.assignment_id
        and assignment.assigned_by_id = (select auth.uid())
        and assignment.status = 'active'
    )
  )
  or (
    assignment_id is null
    and public.can_read_version(program_version_id)
  )
);

grant select on public.program_assignments to authenticated;
grant all on public.program_assignments to service_role;

revoke all on function private.assignment_content_version(uuid)
  from public, anon, authenticated;
revoke all on function private.can_read_program_assignment(uuid)
  from public, anon, authenticated;
revoke all on function private.validate_program_assignment()
  from public, anon, authenticated;
revoke all on function private.workout_content_payload(uuid)
  from public, anon, authenticated;
revoke all on function private.program_version_content_payload(uuid)
  from public, anon, authenticated;

revoke all on function public.assign_published_program_version(
  uuid,
  uuid,
  uuid[],
  uuid
) from public, anon, authenticated;
revoke all on function public.fork_program_assignment(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_scheduled_occurrence(
  uuid,
  date,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;
revoke all on function public.assign_quick_workout_to_athletes(
  uuid,
  uuid[],
  date,
  uuid
) from public, anon, authenticated;
revoke all on function public.start_scheduled_workout(uuid)
  from public, anon, authenticated;

revoke all on function public.get_workspace_bootstrap()
  from public, anon, authenticated;
revoke all on function public.list_program_summaries(
  integer,
  timestamptz,
  uuid
) from public, anon, authenticated;
revoke all on function public.get_program_version_detail(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_scheduled_workout_detail(uuid)
  from public, anon, authenticated;
revoke all on function public.list_calendar_occurrences(
  date,
  date,
  integer,
  date,
  uuid
) from public, anon, authenticated;
revoke all on function public.list_completed_session_summaries(
  integer,
  timestamptz,
  uuid
) from public, anon, authenticated;
revoke all on function public.list_calendar_session_summaries(
  date,
  date,
  integer
) from public, anon, authenticated;
revoke all on function public.search_exercises(
  text,
  text,
  text[],
  text[],
  text[],
  text[],
  integer,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.list_schedulable_workouts(
  integer,
  text,
  integer,
  integer,
  uuid
) from public, anon, authenticated;
revoke all on function public.list_coach_athletes(integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_coaching_access_summary()
  from public, anon, authenticated;
revoke all on function public.get_coach_athlete_detail(
  uuid,
  integer,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.assign_published_program_version(
  uuid,
  uuid,
  uuid[],
  uuid
) to authenticated;
grant execute on function public.fork_program_assignment(uuid, uuid)
  to authenticated;
grant execute on function public.create_scheduled_occurrence(
  uuid,
  date,
  uuid,
  uuid,
  uuid
) to authenticated;
grant execute on function public.assign_quick_workout_to_athletes(
  uuid,
  uuid[],
  date,
  uuid
) to authenticated;
grant execute on function public.start_scheduled_workout(uuid)
  to authenticated;

grant execute on function public.get_workspace_bootstrap()
  to authenticated;
grant execute on function public.list_program_summaries(
  integer,
  timestamptz,
  uuid
) to authenticated;
grant execute on function public.get_program_version_detail(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.get_scheduled_workout_detail(uuid)
  to authenticated;
grant execute on function public.list_calendar_occurrences(
  date,
  date,
  integer,
  date,
  uuid
) to authenticated;
grant execute on function public.list_completed_session_summaries(
  integer,
  timestamptz,
  uuid
) to authenticated;
grant execute on function public.list_calendar_session_summaries(
  date,
  date,
  integer
) to authenticated;
grant execute on function public.search_exercises(
  text,
  text,
  text[],
  text[],
  text[],
  text[],
  integer,
  text,
  uuid
) to authenticated;
grant execute on function public.list_schedulable_workouts(
  integer,
  text,
  integer,
  integer,
  uuid
) to authenticated;
grant execute on function public.list_coach_athletes(integer, text, uuid)
  to authenticated;
grant execute on function public.get_coaching_access_summary()
  to authenticated;
grant execute on function public.get_coach_athlete_detail(
  uuid,
  integer,
  integer,
  integer
) to authenticated;

-- Keep the exact test-population reset compatible with shared assignments.
-- The wrapper performs the V1 boundary check and removes assignment rows before
-- the legacy reset deletes programs (whose immutable source FKs intentionally
-- reject an implicit ON DELETE mutation). Everything remains one transaction,
-- so a later legacy guard failure also rolls these deletes back.
alter function public.reset_test_population(text, text[])
  rename to reset_test_population_pre_v1;

create function public.reset_test_population(
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

  select array_agg(profile.id)
  into test_ids
  from public.profiles profile
  where profile.account_kind = 'test'
    and profile.test_persona_key like expected_namespace || ':%';

  if test_ids is not null and exists (
    select 1
    from public.program_assignments assignment
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

  if test_ids is not null then
    perform pg_catalog.set_config('liftlog.test_reset', 'on', true);
    delete from public.workout_sessions session
    where session.athlete_id = any(test_ids);
    delete from public.scheduled_workouts scheduled
    where scheduled.athlete_id = any(test_ids);
    delete from public.program_assignments assignment
    where assignment.athlete_id = any(test_ids)
       or assignment.assigned_by_id = any(test_ids);
  end if;

  select public.reset_test_population_pre_v1(
    expected_namespace,
    expected_persona_keys
  ) into result;
  return result;
end;
$$;

revoke all on function public.reset_test_population_pre_v1(text, text[])
  from public, anon, authenticated;
revoke all on function public.reset_test_population(text, text[])
  from public, anon, authenticated;
grant execute on function public.reset_test_population(text, text[])
  to service_role;

select pg_catalog.set_config('search_path', 'public', false);

commit;
