-- Keep the coaching landing page independent of the size of an athlete's
-- complete training history. The public projection is author-scoped, omits
-- every private note column, and has hard server-side cardinality limits.

create or replace function private.authored_coach_program_summaries(
  target_coach_id uuid,
  target_athlete_id uuid,
  target_today date,
  target_limit integer,
  target_progress_limit integer
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(program_row.payload order by program_row.created_at desc, program_row.id),
    '[]'::jsonb
  )
  from (
    select
      program.id,
      program.created_at,
      jsonb_build_object(
        'id', program.id,
        'versionId', version.id,
        'title', version.title,
        'assignedAt', program.created_at::date,
        'status', case
          when workout_totals.total_workouts > 0
            and cycle_stats.cycle_size >= workout_totals.total_workouts
            and cycle_stats.all_terminal
            then 'completed'
          when cycle_stats.has_started then 'in_progress'
          when cycle_stats.has_scheduled_date then 'scheduled'
          else 'awaiting_schedule'
        end,
        'totalWorkouts', workout_totals.total_workouts,
        'scheduledWorkouts', cycle_stats.scheduled_workouts,
        'scheduledPercent', case
          when workout_totals.total_workouts = 0 then 0
          else least(
            100,
            round(
              cycle_stats.scheduled_workouts::numeric
              / workout_totals.total_workouts::numeric
              * 100
            )::integer
          )
        end,
        'completedWorkouts', cycle_stats.completed_workouts,
        'completionPercent', case
          when workout_totals.total_workouts = 0 then 0
          else least(
            100,
            round(
              cycle_stats.completed_workouts::numeric
              / workout_totals.total_workouts::numeric
              * 100
            )::integer
          )
        end,
        'workoutProgress', workout_progress.items,
        'hiddenWorkoutCount', greatest(
          workout_totals.total_workouts - jsonb_array_length(workout_progress.items),
          0
        ),
        'nextWorkout', next_workout.payload
      ) as payload
    from public.programs program
    join lateral (
      select candidate.id, candidate.title
      from public.program_versions candidate
      where candidate.program_id = program.id
        and candidate.status = 'published'
      order by candidate.version_number desc, candidate.id
      limit 1
    ) version on true
    cross join lateral (
      select count(*)::integer as total_workouts
      from public.workouts workout
      join public.program_weeks week
        on week.id = workout.program_week_id
      where week.program_version_id = version.id
    ) workout_totals
    cross join lateral (
      select max(schedule.sequence_number) as maximum_sequence
      from public.scheduled_workouts schedule
      where schedule.athlete_id = target_athlete_id
        and schedule.program_version_id = version.id
        and schedule.sequence_number is not null
    ) cycle_bound
    cross join lateral (
      select
        count(*)::integer as cycle_size,
        count(*) filter (
          where schedule.planned_date is not null
        )::integer as scheduled_workouts,
        count(*) filter (
          where schedule.status = 'completed'
        )::integer as completed_workouts,
        coalesce(bool_and(
          schedule.status in ('completed', 'skipped')
        ), false) as all_terminal,
        coalesce(bool_or(
          schedule.status in ('in_progress', 'completed', 'skipped')
        ), false) as has_started,
        coalesce(bool_or(
          schedule.status = 'planned'
          and schedule.planned_date is not null
        ), false) as has_scheduled_date
      from public.scheduled_workouts schedule
      where schedule.athlete_id = target_athlete_id
        and schedule.program_version_id = version.id
        and (
          cycle_bound.maximum_sequence is null
          or (
            workout_totals.total_workouts > 0
            and schedule.sequence_number >
              floor(
                (cycle_bound.maximum_sequence - 1)::numeric
                / workout_totals.total_workouts::numeric
              )::integer * workout_totals.total_workouts
            and schedule.sequence_number <=
              floor(
                (cycle_bound.maximum_sequence - 1)::numeric
                / workout_totals.total_workouts::numeric
              )::integer * workout_totals.total_workouts
              + workout_totals.total_workouts
          )
        )
    ) cycle_stats
    cross join lateral (
      select coalesce(
        jsonb_agg(progress.state order by progress.week_index, progress.position, progress.workout_id),
        '[]'::jsonb
      ) as items
      from (
        select
          week.week_index,
          workout.position,
          workout.id as workout_id,
          case
            when latest_schedule.id is null
              or latest_schedule.planned_date is null
              or latest_schedule.status = 'skipped'
              then 'unscheduled'
            when latest_schedule.status = 'completed' then 'completed'
            else 'scheduled'
          end as state
        from public.program_weeks week
        join public.workouts workout
          on workout.program_week_id = week.id
        left join lateral (
          select schedule.id, schedule.planned_date, schedule.status
          from public.scheduled_workouts schedule
          where schedule.athlete_id = target_athlete_id
            and schedule.program_version_id = version.id
            and schedule.workout_id = workout.id
            and (
              cycle_bound.maximum_sequence is null
              or (
                workout_totals.total_workouts > 0
                and schedule.sequence_number >
                  floor(
                    (cycle_bound.maximum_sequence - 1)::numeric
                    / workout_totals.total_workouts::numeric
                  )::integer * workout_totals.total_workouts
                and schedule.sequence_number <=
                  floor(
                    (cycle_bound.maximum_sequence - 1)::numeric
                    / workout_totals.total_workouts::numeric
                  )::integer * workout_totals.total_workouts
                  + workout_totals.total_workouts
              )
            )
          order by schedule.sequence_number desc nulls last, schedule.id
          limit 1
        ) latest_schedule on true
        where week.program_version_id = version.id
        order by week.week_index, workout.position, workout.id
        limit least(greatest(coalesce(target_progress_limit, 104), 1), 104)
      ) progress
    ) workout_progress
    left join lateral (
      select jsonb_build_object(
        'id', schedule.id,
        'title', workout.title,
        'date', schedule.planned_date
      ) as payload
      from public.scheduled_workouts schedule
      join public.workouts workout on workout.id = schedule.workout_id
      where schedule.athlete_id = target_athlete_id
        and schedule.program_version_id = version.id
        and schedule.status = 'planned'
        and schedule.planned_date >= target_today
        and (
          cycle_bound.maximum_sequence is null
          or (
            workout_totals.total_workouts > 0
            and schedule.sequence_number >
              floor(
                (cycle_bound.maximum_sequence - 1)::numeric
                / workout_totals.total_workouts::numeric
              )::integer * workout_totals.total_workouts
            and schedule.sequence_number <=
              floor(
                (cycle_bound.maximum_sequence - 1)::numeric
                / workout_totals.total_workouts::numeric
              )::integer * workout_totals.total_workouts
              + workout_totals.total_workouts
          )
        )
      order by schedule.planned_date, schedule.sequence_number, schedule.id
      limit 1
    ) next_workout on true
    where program.athlete_id = target_athlete_id
      and program.created_by_id = target_coach_id
      and program.source_type = 'coach'
      and program.is_current = true
      and program.archived_at is null
    order by program.created_at desc, program.id
    limit least(greatest(coalesce(target_limit, 250), 1), 250)
  ) program_row;
$$;

create or replace function private.authored_coach_agenda_summaries(
  target_coach_id uuid,
  target_athlete_id uuid,
  target_today date,
  target_upcoming_limit integer,
  target_completed_limit integer
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with authored_versions as materialized (
    select
      program.id as program_id,
      version.id as version_id,
      version.title as program_title,
      program.is_current,
      program.archived_at
    from public.programs program
    join public.program_versions version
      on version.program_id = program.id
     and version.status in ('published', 'superseded')
    where program.athlete_id = target_athlete_id
      and program.created_by_id = target_coach_id
      and program.source_type = 'coach'
  ),
  upcoming as (
    select jsonb_build_object(
      'id', 'schedule:' || schedule.id::text,
      'kind', 'upcoming',
      'status', case
        when schedule.status = 'in_progress' then 'in_progress'
        when schedule.planned_date < target_today then 'overdue'
        else 'planned'
      end,
      'programId', authored.program_id,
      'programVersionId', authored.version_id,
      'programTitle', authored.program_title,
      'workoutId', schedule.workout_id,
      'workoutTitle', workout.title,
      'date', schedule.planned_date,
      'scheduleId', schedule.id
    ) as payload,
    case
      when schedule.status = 'in_progress' then 0
      when schedule.planned_date < target_today then 1
      else 2
    end as priority,
    schedule.planned_date,
    schedule.id
    from public.scheduled_workouts schedule
    join authored_versions authored
      on authored.version_id = schedule.program_version_id
    join public.workouts workout on workout.id = schedule.workout_id
    where schedule.athlete_id = target_athlete_id
      and authored.is_current = true
      and authored.archived_at is null
      and schedule.status in ('planned', 'in_progress')
      and schedule.planned_date is not null
    order by priority, schedule.planned_date, schedule.id
    limit least(greatest(coalesce(target_upcoming_limit, 6), 1), 6)
  ),
  completed as (
    select jsonb_build_object(
      'id', 'session:' || session.id::text,
      'kind', 'completed',
      'status', 'completed',
      'programId', authored.program_id,
      'programVersionId', authored.version_id,
      'programTitle', authored.program_title,
      'workoutId', session.workout_id,
      'workoutTitle', session.workout_title,
      'date', coalesce(session.completed_for_date, session.started_at::date),
      'rpe', session.session_rpe,
      'scheduleId', session.scheduled_workout_id,
      'sessionId', session.id
    ) as payload,
    coalesce(session.completed_for_date, session.started_at::date) as completed_date,
    session.started_at,
    session.id
    from public.workout_sessions session
    join authored_versions authored
      on authored.version_id = session.program_version_id
    where session.athlete_id = target_athlete_id
      and session.status = 'completed'
    order by completed_date desc, session.started_at desc, session.id desc
    limit least(greatest(coalesce(target_completed_limit, 6), 1), 6)
  )
  select
    coalesce((
      select jsonb_agg(upcoming.payload order by upcoming.priority, upcoming.planned_date, upcoming.id)
      from upcoming
    ), '[]'::jsonb)
    ||
    coalesce((
      select jsonb_agg(completed.payload order by completed.completed_date desc, completed.started_at desc, completed.id desc)
      from completed
    ), '[]'::jsonb);
$$;

create or replace function public.list_authored_coach_athlete_overviews(
  target_limit integer default 250
)
returns table (
  id uuid,
  relationship_id uuid,
  display_name text,
  assigned_program_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    athlete.id,
    relationship.id as relationship_id,
    athlete.display_name,
    (
      select count(*)
      from public.programs program
      where program.athlete_id = athlete.id
        and program.created_by_id = (select auth.uid())
        and program.source_type = 'coach'
        and program.is_current = true
        and program.archived_at is null
        and exists (
          select 1
          from public.program_versions version
          where version.program_id = program.id
            and version.status = 'published'
        )
    ) as assigned_program_count
  from public.coach_relationships relationship
  join public.profiles athlete on athlete.id = relationship.athlete_id
  where (select auth.uid()) is not null
    and relationship.coach_id = (select auth.uid())
    and relationship.ended_at is null
  order by athlete.display_name, athlete.id, relationship.id
  limit least(greatest(coalesce(target_limit, 250), 1), 250);
$$;

create or replace function public.get_authored_coach_athlete_detail(
  target_athlete_id uuid,
  target_program_limit integer default 250,
  target_upcoming_limit integer default 6,
  target_completed_limit integer default 6,
  target_progress_limit integer default 104
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', athlete.id,
    'relationshipId', relationship.id,
    'displayName', athlete.display_name,
    'assignedProgramCount', (
      select count(*)
      from public.programs program
      where program.athlete_id = athlete.id
        and program.created_by_id = (select auth.uid())
        and program.source_type = 'coach'
        and program.is_current = true
        and program.archived_at is null
        and exists (
          select 1
          from public.program_versions version
          where version.program_id = program.id
            and version.status = 'published'
        )
    ),
    'assignedPrograms', private.authored_coach_program_summaries(
      (select auth.uid()),
      athlete.id,
      athlete_date.today,
      least(greatest(coalesce(target_program_limit, 250), 1), 250),
      least(greatest(coalesce(target_progress_limit, 104), 1), 104)
    ),
    'agenda', private.authored_coach_agenda_summaries(
      (select auth.uid()),
      athlete.id,
      athlete_date.today,
      least(greatest(coalesce(target_upcoming_limit, 6), 1), 6),
      least(greatest(coalesce(target_completed_limit, 6), 1), 6)
    )
  )
  from public.coach_relationships relationship
  join public.profiles athlete on athlete.id = relationship.athlete_id
  cross join lateral (
    select case
      when exists (
        select 1
        from pg_catalog.pg_timezone_names timezone_name
        where timezone_name.name = athlete.timezone
      ) then (current_timestamp at time zone athlete.timezone)::date
      else current_date
    end as today
  ) athlete_date
  where (select auth.uid()) is not null
    and relationship.coach_id = (select auth.uid())
    and relationship.athlete_id = target_athlete_id
    and relationship.ended_at is null;
$$;

revoke all on function private.authored_coach_program_summaries(
  uuid,
  uuid,
  date,
  integer,
  integer
) from public, anon, authenticated;
revoke all on function private.authored_coach_agenda_summaries(
  uuid,
  uuid,
  date,
  integer,
  integer
) from public, anon, authenticated;

revoke all on function public.list_authored_coach_athlete_overviews(integer)
  from public, anon, authenticated;
revoke all on function public.get_authored_coach_athlete_detail(
  uuid,
  integer,
  integer,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.list_authored_coach_athlete_overviews(integer)
  to authenticated;
grant execute on function public.get_authored_coach_athlete_detail(
  uuid,
  integer,
  integer,
  integer,
  integer
) to authenticated;

select pg_catalog.set_config('search_path', 'public', false);
