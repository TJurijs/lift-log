-- Keep the first scheduling choices useful without changing the alphabetical
-- keyset contract used to browse the complete candidate list. A quick workout
-- is reusable, and its program/assignment identity remains stable when a new
-- published version gives the underlying workout a new UUID.

begin;

create function public.list_frequent_schedulable_workouts(
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
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
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
  ),
  quick_candidates as materialized (
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
  ),
  completed_usage as materialized (
    select
      case
        when session.assignment_id is null then 'program'::text
        else 'assignment'::text
      end as identity_kind,
      coalesce(session.assignment_id, historical_version.program_id)
        as identity_id,
      count(*) as usage_count,
      max(session.completed_at) as last_used_at
    from public.workout_sessions session
    join public.program_versions historical_version
      on historical_version.id = session.program_version_id
    where session.athlete_id = current_user_id
      and session.status = 'completed'
    group by
      case
        when session.assignment_id is null then 'program'::text
        else 'assignment'::text
      end,
      coalesce(session.assignment_id, historical_version.program_id)
  ),
  frequent_page as materialized (
    select
      candidate.*,
      usage.usage_count,
      usage.last_used_at
    from quick_candidates candidate
    join completed_usage usage
      on usage.identity_kind = candidate.kind
     and usage.identity_id = coalesce(
       candidate.assignment_id,
       candidate.program_id
     )
    order by
      usage.usage_count desc,
      usage.last_used_at desc,
      lower(candidate.workout_title),
      candidate.kind,
      coalesce(candidate.assignment_id, candidate.program_id),
      candidate.workout_id
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
    true as is_quick_workout,
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
    candidate.usage_count desc,
    candidate.last_used_at desc,
    lower(candidate.workout_title),
    candidate.kind,
    coalesce(candidate.assignment_id, candidate.program_id),
    candidate.workout_id;
end;
$$;

revoke all on function public.list_frequent_schedulable_workouts(integer)
  from public, anon, authenticated;
grant execute on function public.list_frequent_schedulable_workouts(integer)
  to authenticated;

commit;
