-- Training exists as soon as it is authored. Materialize one own occurrence
-- only when dates or a session are needed, and reuse it on concurrent requests.
begin;

create index idx_program_runs_own_source_activity
  on public.program_runs(source_program_id, athlete_id, created_at desc, id desc)
  where created_by_id = athlete_id;

create or replace function private.training_run_workout_id(target_run_id uuid, target_workout_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select slot.workout_id
  from public.program_run_workouts slot
  join public.program_runs run on run.id = slot.program_run_id
  join public.workouts original on original.id = slot.workout_id
  where slot.program_run_id = target_run_id and (
    target_workout_id in (slot.workout_id, slot.edited_workout_id)
    or exists (
      select 1 from public.workouts requested
      join public.program_weeks week on week.id = requested.program_week_id
      join public.program_versions version on version.id = week.program_version_id
      where requested.id = target_workout_id and version.program_id = run.source_program_id
        and requested.history_lineage_id = original.history_lineage_id
    )
  ) order by (slot.workout_id = target_workout_id) desc, slot.position limit 1;
$$;
revoke all on function private.training_run_workout_id(uuid,uuid) from public, anon, authenticated;

create or replace function public.ensure_own_training_run(
  target_program_id uuid,
  target_workout_dates jsonb default '[]'::jsonb,
  target_idempotency_key uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := (select auth.uid()); own_run public.program_runs%rowtype;
  created_run record; was_created boolean := false; mapped_dates jsonb;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  if target_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  if jsonb_typeof(coalesce(target_workout_dates, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(target_workout_dates, '[]'::jsonb)) > 200 then
    raise exception 'Workout dates must be an array of at most 200 items';
  end if;
  perform program.id from public.programs program
  where program.id = target_program_id and program.athlete_id = viewer
    and program.created_by_id = viewer and program.source_type = 'self'
    and program.archived_at is null and program.run_workout_id is null
  for update;
  if not found then raise exception 'Training was not found'; end if;

  select run.* into own_run from public.program_runs run
  where run.source_program_id = target_program_id and run.athlete_id = viewer
    and run.created_by_id = viewer and run.status in ('not_started','in_progress')
  order by run.created_at desc, run.id desc limit 1 for update;
  if not found then
    if exists(select 1 from public.program_runs run
      where run.source_program_id = target_program_id and run.athlete_id = viewer
        and run.created_by_id = viewer) then
      raise exception 'Repeat completed training to start a fresh copy';
    end if;
    select * into created_run from public.create_program_runs(target_program_id,
      array[viewer], '[]'::jsonb, target_idempotency_key);
    select * into own_run from public.program_runs where id = created_run.run_id;
    was_created := true;
  end if;

  if jsonb_array_length(coalesce(target_workout_dates, '[]'::jsonb)) > 0 then
    select jsonb_agg(jsonb_build_object(
      'workoutId', private.training_run_workout_id(own_run.id, (entry->>'workoutId')::uuid),
      'plannedDate', entry->>'plannedDate')) into mapped_dates
    from jsonb_array_elements(target_workout_dates) entry;
    if exists(select 1 from jsonb_array_elements(mapped_dates) entry where entry->>'workoutId' is null) then
      raise exception 'A selected workout does not belong to this training';
    end if;
    perform public.schedule_program_run_workouts(own_run.id, mapped_dates, target_idempotency_key);
  end if;
  return jsonb_build_object('athleteId', viewer, 'runId', own_run.id,
    'programId', own_run.source_program_id, 'programVersionId', own_run.program_version_id,
    'created', was_created);
end;
$$;
revoke all on function public.ensure_own_training_run(uuid,jsonb,uuid) from public, anon;
grant execute on function public.ensure_own_training_run(uuid,jsonb,uuid) to authenticated;

create or replace function public.start_training_workout(
  target_program_id uuid default null,
  target_workout_id uuid default null,
  target_run_workout_id uuid default null,
  target_planned_date date default current_date
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare viewer uuid := (select auth.uid()); own_run public.program_runs%rowtype;
  selected_slot public.program_run_workouts%rowtype; run_payload jsonb;
  selected_workout_id uuid; occurrence_id uuid; next_sequence integer;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  if target_run_workout_id is not null then
    if target_program_id is not null or target_workout_id is not null then
      raise exception 'Choose a training workout or a program workout';
    end if;
    select run.* into own_run from public.program_runs run
    join public.program_run_workouts slot on slot.program_run_id = run.id
    where slot.id = target_run_workout_id and run.athlete_id = viewer for update of run;
    if not found then raise exception 'Training workout was not found'; end if;
    select * into selected_slot from public.program_run_workouts
    where id = target_run_workout_id for update;
  else
    if target_program_id is null or target_workout_id is null then
      raise exception 'Choose a workout to start';
    end if;
    run_payload := public.ensure_own_training_run(target_program_id);
    select * into own_run from public.program_runs where id = (run_payload->>'runId')::uuid for update;
    selected_workout_id := private.training_run_workout_id(own_run.id, target_workout_id);
    select * into selected_slot from public.program_run_workouts
    where program_run_id = own_run.id and workout_id = selected_workout_id for update;
    if not found then raise exception 'A selected workout does not belong to this training'; end if;
  end if;
  if own_run.status not in ('not_started','in_progress')
    or selected_slot.status not in ('unscheduled','scheduled','in_progress') then
    raise exception 'Only unfinished training can be started';
  end if;
  occurrence_id := selected_slot.scheduled_workout_id;
  if selected_slot.planned_date is null then
    if target_planned_date is null then raise exception 'The current date is required'; end if;
    perform profile.id from public.profiles profile where profile.id = viewer for update;
    if occurrence_id is null then
      select coalesce(max(occurrence.sequence_number), 0) + 1 into next_sequence
      from public.scheduled_workouts occurrence where occurrence.athlete_id = viewer
        and occurrence.program_version_id = own_run.program_version_id;
      -- Starting is an actual action: it may happen out of program order.
      -- The ordinary date editor still validates planned sequence changes.
      insert into public.scheduled_workouts(athlete_id, scheduled_by_id, assignment_id,
        program_version_id, workout_id, planned_date, sequence_number, status,
        request_key, program_run_id, program_run_workout_id)
      values(viewer, viewer, own_run.legacy_assignment_id,
        coalesce((select week.program_version_id from public.workouts edited
          join public.program_weeks week on week.id = edited.program_week_id
          where edited.id = selected_slot.edited_workout_id), own_run.program_version_id),
        coalesce(selected_slot.edited_workout_id, selected_slot.workout_id),
        target_planned_date, next_sequence, 'planned', gen_random_uuid(), own_run.id,
        selected_slot.id) returning id into occurrence_id;
    else
      update public.scheduled_workouts set planned_date = target_planned_date
      where id = occurrence_id and status = 'planned';
    end if;
  end if;
  return public.start_scheduled_workout(occurrence_id);
end;
$$;
revoke all on function public.start_training_workout(uuid,uuid,uuid,date) from public, anon;
grant execute on function public.start_training_workout(uuid,uuid,uuid,date) to authenticated;

-- Active training is paged by its nearest unfinished date; history retains
-- its stable newest-first cursor. An older active program cannot be hidden by
-- newer completed runs. Each response is capped before full slot aggregation.
create index idx_program_run_workouts_next_date
  on public.program_run_workouts(program_run_id, planned_date, position, id)
  where status not in ('completed','skipped','cancelled');
drop function public.list_program_run_summaries(uuid,integer,timestamptz,uuid,text);
create or replace function public.list_program_run_summaries(
  target_athlete_id uuid default null,
  page_limit integer default 26,
  after_created_at timestamptz default null,
  after_id uuid default null,
  creator_scope text default 'all',
  status_scope text default 'all',
  after_sort_date date default null
)
returns table (
  id uuid, athlete_id uuid, created_by_id uuid, program_id uuid,
  program_version_id uuid, title text, content_type text, status text,
  total_workouts bigint, scheduled_workouts bigint, completed_workouts bigint,
  completion_percent integer, next_workout_id uuid, next_workout_title text,
  next_workout_date date, next_workout_status text,
  repeated_from_run_id uuid, created_at timestamptz, ended_at timestamptz,
  finished_at timestamptz, sort_date date
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

  if status_scope is null or status_scope not in ('all','active','history') then
    raise exception 'Training status scope is invalid';
  end if;
  if (status_scope = 'active' and (after_created_at is null) <> (after_sort_date is null))
    or (status_scope <> 'active' and after_sort_date is not null) then
    raise exception 'Training cursor is incomplete';
  end if;

  return query
  with run_page as materialized (
    -- Keep each creator scope in its own branch. Besides making the access
    -- semantics auditable, the direct coach predicate lets a generic cached
    -- PL/pgSQL plan use idx_program_runs_athlete_coach_summary_page.
    (
      select candidate.*
      from public.program_runs candidate
      where status_scope <> 'active'
        and (status_scope <> 'history' or candidate.status in ('completed','ended'))
        and creator_scope = 'all'
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
      where status_scope <> 'active'
        and (status_scope <> 'history' or candidate.status in ('completed','ended'))
        and creator_scope = 'self'
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
      where status_scope <> 'active'
        and (status_scope <> 'history' or candidate.status in ('completed','ended'))
        and creator_scope = 'coach'
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
    union all
    (
      select candidate.*
      from public.program_runs candidate
      left join lateral (
        select slot.planned_date from public.program_run_workouts slot
        where slot.program_run_id = candidate.id
          and slot.status not in ('completed','skipped','cancelled')
        order by slot.planned_date nulls last, slot.position, slot.id limit 1
      ) next_date on true
      where status_scope = 'active'
        and candidate.athlete_id = resolved_athlete_id
        and candidate.status in ('not_started','in_progress')
        and (resolved_athlete_id = current_user_id or candidate.created_by_id = current_user_id)
        and (creator_scope = 'all'
          or (creator_scope = 'self' and candidate.created_by_id = candidate.athlete_id)
          or (creator_scope = 'coach' and candidate.created_by_id <> candidate.athlete_id))
        and (after_created_at is null
          or coalesce(next_date.planned_date, '9999-12-31'::date) > after_sort_date
          or (coalesce(next_date.planned_date, '9999-12-31'::date) = after_sort_date
            and (candidate.created_at, candidate.id) < (after_created_at, after_id)))
      order by coalesce(next_date.planned_date, '9999-12-31'::date), candidate.created_at desc, candidate.id desc
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
    coalesce(run.completed_at, run.ended_at),
    coalesce(next_slot.planned_date, '9999-12-31'::date)
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
  left join public.workouts next_workout on next_workout.id = coalesce(next_slot.edited_workout_id, next_slot.workout_id)
  group by run.id, run.athlete_id, run.created_by_id, run.source_program_id,
    run.program_version_id, run.status, run.repeated_from_run_id,
    run.created_at, run.completed_at, run.ended_at, version.title,
    program.content_type, next_slot.id,
    next_slot.planned_date, next_slot.status, next_workout.title
  order by case when status_scope = 'active' then coalesce(next_slot.planned_date, '9999-12-31'::date) end,
    run.created_at desc, run.id desc;
end;
$$;

revoke all on function public.list_program_run_summaries(uuid,integer,timestamptz,uuid,text,text,date) from public, anon;
grant execute on function public.list_program_run_summaries(uuid,integer,timestamptz,uuid,text,text,date) to authenticated;

drop function public.list_completed_session_summaries(integer,timestamptz,uuid);
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
  completed_for_date date, session_rpe numeric, source_type text
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
    session.session_rpe, case when coalesce(run.created_by_id, occurrence.scheduled_by_id, session.athlete_id)
      = session.athlete_id then 'self' else 'coach' end
  from public.workout_sessions session
  left join public.program_runs run on run.id = session.program_run_id
  left join public.scheduled_workouts occurrence on occurrence.id = session.scheduled_workout_id
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
revoke all on function public.list_completed_session_summaries(integer,timestamptz,uuid) from public, anon;
grant execute on function public.list_completed_session_summaries(integer,timestamptz,uuid) to authenticated;

drop function public.list_calendar_session_summaries(date,date,integer,date,uuid);
create function public.list_calendar_session_summaries(
  range_start date,
  range_end date,
  page_limit integer default 100,
  after_completed_for_date date default null,
  after_id uuid default null
)
returns table (
  id uuid, assignment_id uuid, program_run_id uuid,
  program_run_workout_id uuid, scheduled_workout_id uuid,
  program_version_id uuid, workout_id uuid, workout_title text,
  started_at timestamptz, completed_at timestamptz,
  completed_for_date date, session_rpe numeric, source_type text
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
  if (after_completed_for_date is null) <> (after_id is null) then
    raise exception 'Calendar history cursor is incomplete';
  end if;

  return query
  select session.id, session.assignment_id, session.program_run_id,
    session.program_run_workout_id, session.scheduled_workout_id,
    session.program_version_id, session.workout_id, session.workout_title,
    session.started_at, session.completed_at, session.completed_for_date,
    session.session_rpe, case when coalesce(run.created_by_id, occurrence.scheduled_by_id, session.athlete_id)
      = session.athlete_id then 'self' else 'coach' end
  from public.workout_sessions session
  left join public.program_runs run on run.id = session.program_run_id
  left join public.scheduled_workouts occurrence on occurrence.id = session.scheduled_workout_id
  where session.athlete_id = current_user_id
    and session.status = 'completed'
    and session.completed_for_date between range_start and range_end
    and (
      after_completed_for_date is null
      or (session.completed_for_date, session.id) > (after_completed_for_date, after_id)
    )
  order by session.completed_for_date, session.id
  limit least(greatest(coalesce(page_limit, 100), 1), 200);
end;
$$;
revoke all on function public.list_calendar_session_summaries(date,date,integer,date,uuid) from public, anon;
grant execute on function public.list_calendar_session_summaries(date,date,integer,date,uuid) to authenticated;

commit;
