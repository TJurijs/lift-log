-- Complete dense calendar viewports using bounded keyset pages. The previous
-- three-argument contract silently omitted completions after its first page.
drop function public.list_calendar_session_summaries(date, date, integer);
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
  if (after_completed_for_date is null) <> (after_id is null) then
    raise exception 'Calendar history cursor is incomplete';
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
    and (
      after_completed_for_date is null
      or (session.completed_for_date, session.id) > (after_completed_for_date, after_id)
    )
  order by session.completed_for_date, session.id
  limit least(greatest(coalesce(page_limit, 100), 1), 200);
end;
$$;

-- idx_workout_sessions_athlete_calendar already covers this exact cursor;
-- reuse it rather than adding another index to every completed-session write.

revoke all on function public.list_calendar_session_summaries(date, date, integer, date, uuid)
  from public, anon;
grant execute on function public.list_calendar_session_summaries(date, date, integer, date, uuid)
  to authenticated;
