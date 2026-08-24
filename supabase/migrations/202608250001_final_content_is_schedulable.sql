-- Scheduling is determined by the immutable content lifecycle: any published
-- Own or Coach program belongs to its athlete and can be prepared for Calendar.
-- program_availability is intentionally left in place for historical rollback
-- compatibility, but it is no longer consulted by the application or this RPC.

create or replace function public.prepare_program_schedule(target_program_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_athlete_id uuid;
  workout_row record;
  workout_count integer := 0;
  present_count integer := 0;
  maximum_sequence integer := 0;
  cycle_start integer := 0;
  sequence_value integer := 0;
  inserted_count integer := 0;
  affected_count integer := 0;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select program.athlete_id
  into target_athlete_id
  from public.program_versions version
  join public.programs program on program.id = version.program_id
  where version.id = target_program_version_id
    and version.status = 'published'
    and program.archived_at is null
    and program.source_type in ('self', 'coach')
  for update of version;

  if target_athlete_id is null then raise exception 'Final program not found'; end if;
  if target_athlete_id <> current_user_id then
    raise exception 'Only the athlete can prepare calendar workouts';
  end if;

  select count(*)::integer into workout_count
  from public.program_weeks week
  join public.workouts workout on workout.program_week_id = week.id
  where week.program_version_id = target_program_version_id;
  if workout_count = 0 then return 0; end if;

  select coalesce(max(scheduled.sequence_number), 0)
  into maximum_sequence
  from public.scheduled_workouts scheduled
  where scheduled.program_version_id = target_program_version_id;

  if maximum_sequence > 0 then
    cycle_start := ((maximum_sequence - 1) / workout_count) * workout_count;
    select count(distinct scheduled.sequence_number)::integer into present_count
    from public.scheduled_workouts scheduled
    where scheduled.program_version_id = target_program_version_id
      and scheduled.sequence_number > cycle_start
      and scheduled.sequence_number <= cycle_start + workout_count;
  end if;

  if maximum_sequence > 0 and present_count = workout_count and not exists (
    select 1 from public.scheduled_workouts scheduled
    where scheduled.program_version_id = target_program_version_id
      and scheduled.sequence_number > cycle_start
      and scheduled.sequence_number <= cycle_start + workout_count
      and scheduled.status in ('planned', 'in_progress')
  ) then
    cycle_start := cycle_start + workout_count;
  end if;
  sequence_value := cycle_start;

  for workout_row in
    select workout.id
    from public.program_weeks week
    join public.workouts workout on workout.program_week_id = week.id
    where week.program_version_id = target_program_version_id
    order by week.week_index, workout.position
  loop
    sequence_value := sequence_value + 1;
    insert into public.scheduled_workouts (
      athlete_id, scheduled_by_id, program_version_id, workout_id,
      planned_date, sequence_number, status
    ) values (
      current_user_id, current_user_id, target_program_version_id, workout_row.id,
      null, sequence_value, 'planned'
    ) on conflict do nothing;
    get diagnostics affected_count = row_count;
    inserted_count := inserted_count + affected_count;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.prepare_program_schedule(uuid) from public;
grant execute on function public.prepare_program_schedule(uuid) to authenticated;
