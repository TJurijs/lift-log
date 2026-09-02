-- Programs and quick workouts have one user-facing lifecycle:
-- editable until first use, then permanently locked. Internal versions remain
-- immutable snapshots, but Draft/Published is no longer a product concept.

begin;

alter table public.programs
  add column locked_at timestamptz;

-- Assignments, calendar occurrences and sessions are all durable uses.
update public.programs program
set locked_at = coalesce(program.locked_at, now())
where exists (
  select 1
  from public.program_assignments assignment
  where assignment.source_program_id = program.id
     or assignment.customized_program_id = program.id
)
or exists (
  select 1
  from public.scheduled_workouts occurrence
  join public.program_versions version
    on version.id = occurrence.program_version_id
  where version.program_id = program.id
)
or exists (
  select 1
  from public.workout_sessions session
  join public.program_versions version
    on version.id = session.program_version_id
  where version.program_id = program.id
);

-- Compare versions without persistence IDs so an untouched automatically
-- generated draft is not mistaken for a user edit.
create or replace function private.program_version_semantic_payload(
  target_program_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with entry_payload as (
    select entry.workout_item_id,
      jsonb_agg(jsonb_build_object(
        'position', entry.position,
        'repsMin', entry.reps_min,
        'repsMax', entry.reps_max,
        'loadKg', entry.load_kg,
        'durationSeconds', entry.duration_seconds,
        'distanceMetres', entry.distance_metres,
        'rounds', entry.rounds,
        'workSeconds', entry.work_seconds,
        'restSeconds', entry.rest_seconds,
        'targetRpeMin', entry.target_rpe_min,
        'targetRpeMax', entry.target_rpe_max,
        'targetText', entry.target_text
      ) order by entry.position) as entries
    from public.prescribed_entries entry
    join public.workout_items item on item.id = entry.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_program_version_id
    group by entry.workout_item_id
  ), item_payload as (
    select item.section_id,
      jsonb_agg(jsonb_build_object(
        'sourceExerciseId', item.source_exercise_id,
        'name', item.snapshot_name,
        'cue', item.snapshot_cue,
        'entryMode', item.entry_mode,
        'trackingFields', item.tracking_fields,
        'position', item.position,
        'entries', coalesce(entry.entries, '[]'::jsonb)
      ) order by item.position) as items
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join entry_payload entry on entry.workout_item_id = item.id
    where week.program_version_id = target_program_version_id
    group by item.section_id
  ), section_payload as (
    select section.workout_id,
      jsonb_agg(jsonb_build_object(
        'title', section.title,
        'kind', section.section_kind,
        'notes', section.notes,
        'position', section.position,
        'items', coalesce(item.items, '[]'::jsonb)
      ) order by section.position) as sections
    from public.workout_sections section
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join item_payload item on item.section_id = section.id
    where week.program_version_id = target_program_version_id
    group by section.workout_id
  ), workout_payload as (
    select workout.program_week_id,
      jsonb_agg(jsonb_build_object(
        'title', workout.title,
        'scheduleLabel', workout.schedule_label,
        'dayOfWeek', workout.day_of_week,
        'position', workout.position,
        'estimatedMinutes', workout.estimated_minutes,
        'sections', coalesce(section.sections, '[]'::jsonb)
      ) order by workout.position) as workouts
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    left join section_payload section on section.workout_id = workout.id
    where week.program_version_id = target_program_version_id
    group by workout.program_week_id
  ), version_payload as (
    select jsonb_build_object(
      'title', version.title,
      'description', version.description,
      'workouts', coalesce(jsonb_agg(workout.workouts order by week.week_index), '[]'::jsonb)
    ) as payload
    from public.program_versions version
    left join public.program_weeks week on week.program_version_id = version.id
    left join workout_payload workout on workout.program_week_id = week.id
    where version.id = target_program_version_id
    group by version.id, version.title, version.description
  )
  select coalesce(payload, '{}'::jsonb) from version_payload;
$$;

-- A locked program may have an old auto-created draft. Discard it if it is an
-- exact clone; otherwise preserve the user's work as a new editable item.
do $$
declare
  candidate record;
  immutable_version_id uuid;
  editable_program_id uuid;
  editable_version_id uuid;
  copy_title text;
begin
  for candidate in
    select
      program.*,
      draft.id as draft_version_id,
      draft.authored_by_id as draft_author_id
    from public.programs program
    join public.program_versions draft
      on draft.program_id = program.id
     and draft.status = 'draft'
    where program.locked_at is not null
  loop
    select version.id
    into immutable_version_id
    from public.program_versions version
    where version.program_id = candidate.id
      and version.status in ('published', 'superseded')
    order by
      case version.status when 'published' then 0 else 1 end,
      version.version_number desc,
      version.id
    limit 1;

    if immutable_version_id is null then
      raise exception 'Locked program % has no immutable version', candidate.id;
    end if;

    if private.program_version_semantic_payload(candidate.draft_version_id)
      is distinct from private.program_version_semantic_payload(immutable_version_id) then
      copy_title := left(
        (select version.title from public.program_versions version
         where version.id = candidate.draft_version_id),
        105
      ) || ' (editable copy)';

      insert into public.programs (
        athlete_id, created_by_id, title, description, planning_mode,
        is_current, source_type, source_label, content_type
      ) values (
        candidate.athlete_id,
        candidate.created_by_id,
        copy_title,
        (select version.description from public.program_versions version
         where version.id = candidate.draft_version_id),
        candidate.planning_mode,
        true,
        candidate.source_type,
        case when candidate.source_type = 'self'
          then 'Duplicated by you'
          else candidate.source_label
        end,
        candidate.content_type
      ) returning id into editable_program_id;

      insert into public.program_versions (
        program_id, authored_by_id, version_number, status
      ) values (
        editable_program_id, candidate.draft_author_id, 1, 'draft'
      ) returning id into editable_version_id;

      perform private.clone_program_version_tree(
        candidate.draft_version_id,
        editable_version_id
      );
    end if;

    -- Delete from the leaves upward while the draft row still exists. The
    -- immutable-tree trigger resolves each parent back to this draft; relying
    -- on ON DELETE CASCADE would remove that identity before child triggers run.
    delete from public.prescribed_entries entry
    using public.workout_items item, public.workout_sections section,
      public.workouts workout, public.program_weeks week
    where entry.workout_item_id = item.id
      and item.section_id = section.id
      and section.workout_id = workout.id
      and workout.program_week_id = week.id
      and week.program_version_id = candidate.draft_version_id;
    delete from public.workout_items item
    using public.workout_sections section, public.workouts workout,
      public.program_weeks week
    where item.section_id = section.id
      and section.workout_id = workout.id
      and workout.program_week_id = week.id
      and week.program_version_id = candidate.draft_version_id;
    delete from public.workout_sections section
    using public.workouts workout, public.program_weeks week
    where section.workout_id = workout.id
      and workout.program_week_id = week.id
      and week.program_version_id = candidate.draft_version_id;
    delete from public.workouts workout
    using public.program_weeks week
    where workout.program_week_id = week.id
      and week.program_version_id = candidate.draft_version_id;
    delete from public.program_weeks week
    where week.program_version_id = candidate.draft_version_id;
    delete from public.program_versions
    where id = candidate.draft_version_id;

    update public.programs program
    set
      title = immutable.title,
      description = immutable.description
    from public.program_versions immutable
    where program.id = candidate.id
      and immutable.id = immutable_version_id;
  end loop;
end;
$$;

-- Previously published but never-used content remains editable. Recreate its
-- working version if an older client had removed it.
do $$
declare
  candidate record;
  draft_version_id uuid;
begin
  for candidate in
    select program.id, program.created_by_id, immutable.id as immutable_version_id,
      immutable.version_number
    from public.programs program
    join lateral (
      select version.id, version.version_number
      from public.program_versions version
      where version.program_id = program.id
        and version.status in ('published', 'superseded')
      order by
        case version.status when 'published' then 0 else 1 end,
        version.version_number desc,
        version.id
      limit 1
    ) immutable on true
    where program.locked_at is null
      and program.archived_at is null
      and not exists (
        select 1 from public.program_versions draft
        where draft.program_id = program.id and draft.status = 'draft'
      )
  loop
    insert into public.program_versions (
      program_id, authored_by_id, based_on_version_id, version_number, status
    ) values (
      candidate.id,
      candidate.created_by_id,
      candidate.immutable_version_id,
      candidate.version_number + 1,
      'draft'
    ) returning id into draft_version_id;

    perform private.clone_program_version_tree(
      candidate.immutable_version_id,
      draft_version_id
    );
  end loop;
end;
$$;

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
      and program.locked_at is null
      and program.created_by_id = (select auth.uid())
      and (
        (program.source_type = 'self'
          and program.athlete_id = (select auth.uid()))
        or (program.source_type = 'coach'
          and public.is_active_coach(program.athlete_id))
      )
  );
$$;

-- Publishing is now an internal lock transition and must not create another
-- draft on the newly locked source.
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
    raise exception 'This content is locked';
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

  return target_version_id;
end;
$$;

create function public.lock_program_for_use(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  editable_version_id uuid;
  immutable_version_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform program.id
  from public.programs program
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and (
      (program.created_by_id = current_user_id and program.source_type = 'self')
      or program.source_type = 'coach'
    )
    and program.archived_at is null
  for update;
  if not found then
    raise exception 'Only content owned by your account can be used';
  end if;

  select version.id into editable_version_id
  from public.program_versions version
  where version.program_id = target_program_id
    and version.status = 'draft';

  if editable_version_id is not null then
    immutable_version_id := public.publish_program_version(
      editable_version_id,
      current_date
    );
  else
    select version.id into immutable_version_id
    from public.program_versions version
    where version.program_id = target_program_id
      and version.status = 'published'
    order by version.version_number desc, version.id
    limit 1;
  end if;

  if immutable_version_id is null then
    raise exception 'Content could not be locked for use';
  end if;

  update public.programs
  set locked_at = coalesce(locked_at, now())
  where id = target_program_id;

  return immutable_version_id;
end;
$$;

-- First use is atomic: a failed schedule or assignment rolls the lock back.
create function public.create_scheduled_occurrence_for_use(
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
begin
  if target_assignment_id is null then
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

create function public.assign_program_for_use(
  target_program_id uuid,
  target_athlete_ids uuid[],
  target_idempotency_key uuid
)
returns table (athlete_id uuid, assignment_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  immutable_version_id uuid;
begin
  immutable_version_id := public.lock_program_for_use(target_program_id);
  return query
  select assignment.athlete_id, assignment.assignment_id, assignment.created
  from public.assign_published_program_version(
    target_program_id,
    immutable_version_id,
    target_athlete_ids,
    target_idempotency_key
  ) assignment;
end;
$$;

-- Coaches use the same occurrence model as athletes, but may only schedule
-- content they assigned to an athlete with an active coaching relationship.
create function public.create_coach_scheduled_occurrence(
  target_assignment_id uuid,
  target_workout_id uuid,
  target_planned_date date,
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
  content_version_id uuid;
  next_sequence integer;
  schedule public.scheduled_workouts%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_planned_date is null then raise exception 'Choose a workout date'; end if;

  select candidate.* into assignment
  from public.program_assignments candidate
  where candidate.id = target_assignment_id
    and candidate.assigned_by_id = current_user_id
    and candidate.status = 'active'
    and exists (
      select 1 from public.coach_relationships relationship
      where relationship.coach_id = current_user_id
        and relationship.athlete_id = candidate.athlete_id
        and relationship.ended_at is null
    )
  for share of candidate;
  if not found then raise exception 'Active athlete assignment not found'; end if;

  select occurrence.* into schedule
  from public.scheduled_workouts occurrence
  where occurrence.athlete_id = assignment.athlete_id
    and occurrence.request_key = target_idempotency_key;
  if found then
    return jsonb_build_object('id', schedule.id, 'created', false);
  end if;

  content_version_id := private.assignment_content_version(assignment.id);
  if not exists (
    select 1 from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    where workout.id = target_workout_id
      and week.program_version_id = content_version_id
  ) then raise exception 'Selected workout is not available in this assignment'; end if;

  perform profile.id from public.profiles profile
  where profile.id = assignment.athlete_id for update;
  select coalesce(max(occurrence.sequence_number), 0) + 1 into next_sequence
  from public.scheduled_workouts occurrence
  where occurrence.athlete_id = assignment.athlete_id
    and occurrence.program_version_id = content_version_id;

  insert into public.scheduled_workouts (
    athlete_id, scheduled_by_id, assignment_id, program_version_id,
    workout_id, planned_date, sequence_number, status, request_key
  ) values (
    assignment.athlete_id, current_user_id, assignment.id, content_version_id,
    target_workout_id, target_planned_date, next_sequence, 'planned',
    target_idempotency_key
  )
  on conflict (athlete_id, request_key) where request_key is not null do nothing
  returning * into schedule;
  if not found then
    select occurrence.* into schedule from public.scheduled_workouts occurrence
    where occurrence.athlete_id = assignment.athlete_id
      and occurrence.request_key = target_idempotency_key;
  end if;
  return jsonb_build_object(
    'id', schedule.id, 'assignmentId', schedule.assignment_id,
    'programVersionId', schedule.program_version_id,
    'workoutId', schedule.workout_id, 'plannedDate', schedule.planned_date,
    'sequenceNumber', schedule.sequence_number, 'status', schedule.status,
    'created', true
  );
end;
$$;

create function public.unassign_program_assignment(target_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  assignment public.program_assignments%rowtype;
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
    where session.assignment_id = assignment.id
      and session.status = 'in_progress'
  ) then raise exception 'Finish the active workout before unassigning this program'; end if;

  delete from public.scheduled_workouts occurrence
  where occurrence.assignment_id = assignment.id
    and occurrence.status in ('planned', 'skipped');

  update public.program_assignments
  set status = 'archived', updated_at = now()
  where id = assignment.id;
end;
$$;

create function public.assign_quick_workout_for_use(
  target_program_id uuid,
  target_athlete_ids uuid[],
  target_planned_date date,
  target_idempotency_key uuid
)
returns table (athlete_id uuid, assignment_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_program_for_use(target_program_id);
  return query
  select assignment.athlete_id, assignment.assignment_id, assignment.created
  from public.assign_quick_workout_to_athletes(
    target_program_id,
    target_athlete_ids,
    target_planned_date,
    target_idempotency_key
  ) assignment;
end;
$$;

-- Any lower-level writer that creates durable use also enforces the lock.
create function private.lock_program_from_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.programs
  set locked_at = coalesce(locked_at, now())
  where id in (new.source_program_id, new.customized_program_id);
  return new;
end;
$$;

create trigger lock_program_after_assignment
after insert on public.program_assignments
for each row execute function private.lock_program_from_assignment();

create function private.lock_program_from_version_use()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.programs program
  set locked_at = coalesce(program.locked_at, now())
  from public.program_versions version
  where version.id = new.program_version_id
    and program.id = version.program_id;
  return new;
end;
$$;

-- Used content is a durable record. It can be duplicated, but never removed
-- from underneath assignments, calendar entries or training history.
create or replace function public.delete_own_program(target_program_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  deletable_program_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select program.id
  into deletable_program_id
  from public.programs program
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and program.created_by_id = current_user_id
    and program.source_type = 'self'
    and program.archived_at is null
    and program.locked_at is null
  for update;

  if deletable_program_id is null then
    raise exception 'Only unused editable content can be deleted';
  end if;

  update public.programs
  set archived_at = now(), is_current = false
  where id = target_program_id;

  delete from public.program_availability
  where athlete_id = current_user_id
    and program_id = target_program_id;

  return jsonb_build_object(
    'programId', target_program_id,
    'removedPlannedWorkouts', 0,
    'retainedScheduledHistory', 0,
    'retainedSessions', 0
  );
end;
$$;

create trigger lock_program_after_schedule
after insert on public.scheduled_workouts
for each row execute function private.lock_program_from_version_use();

create trigger lock_program_after_session
after insert on public.workout_sessions
for each row execute function private.lock_program_from_version_use();

-- Duplicate any readable immutable program into a new editable Own item.
create or replace function public.copy_program_to_own(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_program public.programs%rowtype;
  source_version public.program_versions%rowtype;
  new_program_id uuid;
  new_version_id uuid;
  copy_title text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select program.* into source_program
  from public.programs program
  where program.id = target_program_id
    and program.archived_at is null;

  select version.* into source_version
  from public.program_versions version
  where version.program_id = target_program_id
    and version.status in ('published', 'superseded')
    and public.can_read_version(version.id)
  order by
    case version.status when 'published' then 0 else 1 end,
    version.version_number desc,
    version.id
  limit 1;

  if source_program.id is null or source_version.id is null then
    raise exception 'Locked content was not found';
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

  -- Canonical lineage initially copies the old title; apply the visible copy
  -- name after the new draft exists so metadata stays synchronized.
  update public.programs
  set title = copy_title
  where id = new_program_id;

  return new_program_id;
end;
$$;

-- One summary per content item: editable working version while unlocked,
-- immutable used version after lock.
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
          when program.locked_at is null and candidate.status = 'draft' then 0
          when program.locked_at is not null and candidate.status = 'published' then 0
          when candidate.status = 'published' then 1
          when candidate.status = 'draft' then 2
          else 3
        end,
        candidate.version_number desc,
        candidate.id
      limit 1
    ) version on true
    where program.athlete_id = current_user_id
      and program.archived_at is null
      and not exists (
        select 1 from public.program_assignments assignment
        where assignment.customized_program_id = program.id
      )

    union all

    select
      'assignment'::text, assignment.id, content_program.id, assignment.id,
      assignment.customized_program_id, assignment.athlete_id, version.id,
      version.status, version.title, version.description, 'coach'::text,
      content_program.content_type, assignment.assigned_by_id,
      assignment.assigned_at
    from public.program_assignments assignment
    join public.program_versions version
      on version.id = private.assignment_content_version(assignment.id)
    join public.programs content_program on content_program.id = version.program_id
    where assignment.athlete_id = current_user_id
      and assignment.status = 'active'
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

revoke all on function private.program_version_semantic_payload(uuid)
  from public, anon, authenticated;
revoke all on function private.lock_program_from_assignment()
  from public, anon, authenticated;
revoke all on function private.lock_program_from_version_use()
  from public, anon, authenticated;
revoke all on function public.lock_program_for_use(uuid) from public, anon;
revoke all on function public.publish_program_version(uuid, date)
  from public, anon, authenticated;
revoke all on function public.copy_program_to_own(uuid) from public, anon;
revoke all on function public.create_scheduled_occurrence_for_use(uuid, date, uuid, uuid, uuid)
  from public, anon;
revoke all on function public.assign_program_for_use(uuid, uuid[], uuid)
  from public, anon;
revoke all on function public.create_coach_scheduled_occurrence(uuid, uuid, date, uuid)
  from public, anon;
revoke all on function public.unassign_program_assignment(uuid)
  from public, anon;
revoke all on function public.assign_quick_workout_for_use(uuid, uuid[], date, uuid)
  from public, anon;
revoke all on function public.delete_own_program(uuid) from public, anon;
revoke all on function public.list_program_summaries(integer, timestamptz, uuid)
  from public, anon;

grant execute on function public.copy_program_to_own(uuid) to authenticated;
grant execute on function public.create_scheduled_occurrence_for_use(uuid, date, uuid, uuid, uuid)
  to authenticated;
grant execute on function public.assign_program_for_use(uuid, uuid[], uuid)
  to authenticated;
grant execute on function public.create_coach_scheduled_occurrence(uuid, uuid, date, uuid)
  to authenticated;
grant execute on function public.unassign_program_assignment(uuid)
  to authenticated;
grant execute on function public.assign_quick_workout_for_use(uuid, uuid[], date, uuid)
  to authenticated;
grant execute on function public.delete_own_program(uuid) to authenticated;
grant execute on function public.list_program_summaries(integer, timestamptz, uuid)
  to authenticated;

commit;
