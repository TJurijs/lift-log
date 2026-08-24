-- Calendar provenance is factual: the actor who originally placed an occurrence
-- never changes. Coach placement is authorized only at insert time so an athlete
-- can still reschedule, skip, start, or complete that occurrence after coaching
-- access has ended.

do $$
declare
  duplicate_athlete_id uuid;
begin
  select session.athlete_id
  into duplicate_athlete_id
  from public.workout_sessions session
  where session.status = 'in_progress'
  group by session.athlete_id
  having count(*) > 1
  order by session.athlete_id
  limit 1;

  if duplicate_athlete_id is not null then
    raise exception
      'Cannot enforce one in-progress workout per athlete: athlete % has duplicate sessions',
      duplicate_athlete_id;
  end if;
end;
$$;

create unique index idx_workout_sessions_one_in_progress_per_athlete
  on public.workout_sessions (athlete_id)
  where status = 'in_progress';

create or replace function private.protect_schedule_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    if new.athlete_id is distinct from old.athlete_id
      or new.program_version_id is distinct from old.program_version_id
      or new.workout_id is distinct from old.workout_id
      or new.scheduled_by_id is distinct from old.scheduled_by_id then
      raise exception 'Scheduled workout identity and scheduler cannot be changed';
    end if;

    -- Do not re-authorize the historical scheduler. Athlete-owned RPCs may
    -- update date/status after the coaching relationship has ended.
    return new;
  end if;

  if not exists (
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
    raise exception 'Scheduled workout must belong to a published version owned by the athlete';
  end if;

  if new.scheduled_by_id = new.athlete_id then
    if current_user_id is not null
      and current_user_id is distinct from new.athlete_id then
      raise exception 'Athlete-scheduled workout must record the authenticated athlete';
    end if;
    return new;
  end if;

  if current_user_id is null
    or new.scheduled_by_id is distinct from current_user_id then
    raise exception 'Coach-scheduled workout must record the authenticated scheduler';
  end if;

  if new.status is distinct from 'planned' or new.planned_date is null then
    raise exception 'Coach-scheduled workout must be planned for a calendar date';
  end if;

  perform relationship.id
  from public.coach_relationships relationship
  where relationship.athlete_id = new.athlete_id
    and relationship.coach_id = current_user_id
    and relationship.ended_at is null
  for share;
  if not found then
    raise exception 'Coach can only schedule workouts for an actively coached athlete';
  end if;

  if not exists (
    select 1
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    join public.program_versions version on version.id = week.program_version_id
    join public.programs program on program.id = version.program_id
    where workout.id = new.workout_id
      and version.id = new.program_version_id
      and version.status = 'published'
      and version.authored_by_id = current_user_id
      and program.athlete_id = new.athlete_id
      and program.created_by_id = current_user_id
      and program.source_type = 'coach'
      and program.content_type = 'quick_workout'
      and program.assigned_from_program_id is not null
  ) then
    raise exception 'Coach can only schedule their published quick-workout assignment';
  end if;

  return new;
end;
$$;

create or replace function public.start_or_resume_workout(
  target_workout_id uuid,
  target_program_version_id uuid,
  target_scheduled_workout_id uuid default null
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
  session_item_id uuid;
  workout_title_value text;
  item record;
  prescribed record;
  item_position integer := 0;
  entry_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if target_scheduled_workout_id is null then
    raise exception 'A scheduled workout is required';
  end if;

  select occurrence.*
  into scheduled_occurrence
  from public.scheduled_workouts occurrence
  where occurrence.id = target_scheduled_workout_id
    and occurrence.athlete_id = current_user_id
  for update;
  if not found
    or scheduled_occurrence.workout_id is distinct from target_workout_id
    or scheduled_occurrence.program_version_id is distinct from target_program_version_id then
    raise exception 'Scheduled workout is invalid';
  end if;

  -- Serialize starts for different occurrences owned by the same athlete. The
  -- partial unique index remains the final invariant and migration-time guard.
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
    select workout_session.id
    into existing_session_id
    from public.workout_sessions workout_session
    where workout_session.scheduled_workout_id = scheduled_occurrence.id
      and workout_session.athlete_id = current_user_id
      and workout_session.program_version_id = scheduled_occurrence.program_version_id
      and workout_session.workout_id = scheduled_occurrence.workout_id
      and workout_session.status = 'in_progress';
    if existing_session_id is null then
      raise exception 'In-progress scheduled workout is missing its session';
    end if;
    return existing_session_id;
  end if;
  if scheduled_occurrence.status is distinct from 'planned' then
    raise exception 'Only a planned workout can be started';
  end if;

  select workout_session.id
  into existing_session_id
  from public.workout_sessions workout_session
  where workout_session.athlete_id = current_user_id
    and workout_session.status = 'in_progress'
  order by workout_session.started_at desc, workout_session.id
  limit 1
  for update;
  if existing_session_id is not null then
    raise exception 'Finish the in-progress workout before starting another';
  end if;

  select workout.title
  into workout_title_value
  from public.workouts workout
  join public.program_weeks week on week.id = workout.program_week_id
  join public.program_versions version on version.id = week.program_version_id
  join public.programs program on program.id = version.program_id
  where workout.id = scheduled_occurrence.workout_id
    and version.id = scheduled_occurrence.program_version_id
    and program.athlete_id = current_user_id;
  if workout_title_value is null then
    raise exception 'Workout is not available to this athlete';
  end if;

  insert into public.workout_sessions (
    athlete_id,
    scheduled_workout_id,
    program_version_id,
    workout_id,
    workout_title,
    status
  ) values (
    current_user_id,
    scheduled_occurrence.id,
    scheduled_occurrence.program_version_id,
    scheduled_occurrence.workout_id,
    workout_title_value,
    'in_progress'
  ) returning id into session_id;

  for item in
    select workout_item.*
    from public.workout_sections section
    join public.workout_items workout_item on workout_item.section_id = section.id
    where section.workout_id = scheduled_occurrence.workout_id
    order by section.position, workout_item.position
  loop
    insert into public.session_item_logs (
      workout_session_id,
      source_workout_item_id,
      snapshot_name,
      snapshot_cue,
      entry_mode,
      tracking_fields,
      position
    ) values (
      session_id,
      item.id,
      item.snapshot_name,
      item.snapshot_cue,
      item.entry_mode,
      item.tracking_fields,
      item_position
    ) returning id into session_item_id;
    item_position := item_position + 1;
    entry_count := 0;

    for prescribed in
      select entry.*
      from public.prescribed_entries entry
      where entry.workout_item_id = item.id
      order by entry.position
    loop
      insert into public.session_entries (
        session_item_log_id,
        position,
        reps,
        load_kg,
        duration_seconds,
        distance_metres,
        rounds,
        rpe
      ) values (
        session_item_id,
        prescribed.position,
        prescribed.reps_min,
        prescribed.load_kg,
        prescribed.duration_seconds,
        prescribed.distance_metres,
        prescribed.rounds,
        null
      );
      entry_count := entry_count + 1;
    end loop;

    if entry_count = 0 and item.entry_mode <> 'none' then
      insert into public.session_entries (session_item_log_id, position)
      values (session_item_id, 0);
    end if;
  end loop;

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

-- Deactivation is the athlete-owned archival path. Removing availability in the
-- same transaction prevents an archived program from remaining selectable while
-- retaining completed/in-progress history and any occurrence with a session.
create or replace function public.deactivate_current_program(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_athlete_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select program.athlete_id
  into target_athlete_id
  from public.programs program
  where program.id = target_program_id
    and program.is_current
    and program.archived_at is null
  for update;

  if target_athlete_id is null then
    raise exception 'Current program not found';
  end if;
  if target_athlete_id <> current_user_id then
    raise exception 'Only the athlete can deactivate their current program';
  end if;
  if exists (
    select 1
    from public.workout_sessions session
    join public.program_versions version on version.id = session.program_version_id
    where version.program_id = target_program_id
      and session.status = 'in_progress'
  ) then
    raise exception 'Finish or abandon the active workout before changing programs';
  end if;

  delete from public.program_availability availability
  where availability.program_id = target_program_id
    and availability.athlete_id = current_user_id;

  delete from public.scheduled_workouts scheduled
  using public.program_versions version
  where version.id = scheduled.program_version_id
    and version.program_id = target_program_id
    and scheduled.athlete_id = current_user_id
    and scheduled.status = 'planned'
    and not exists (
      select 1
      from public.workout_sessions session
      where session.scheduled_workout_id = scheduled.id
    );

  update public.programs
  set is_current = false,
      archived_at = now()
  where id = target_program_id
    and athlete_id = current_user_id;

  return target_program_id;
end;
$$;

-- These mutations stay behind authenticated security-definer RPCs. Session
-- entries remain directly writable for the existing draft/autosave path.
revoke insert, update, delete on public.scheduled_workouts from anon;
revoke insert, update, delete on public.scheduled_workouts from authenticated;
revoke insert, update, delete on public.workout_sessions from anon;
revoke insert, update, delete on public.workout_sessions from authenticated;

revoke all on function private.protect_schedule_identity() from public, anon, authenticated;
revoke all on function public.start_or_resume_workout(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.deactivate_current_program(uuid) from public, anon, authenticated;
grant execute on function public.start_or_resume_workout(uuid, uuid, uuid) to authenticated;
grant execute on function public.deactivate_current_program(uuid) to authenticated;

select pg_catalog.set_config('search_path', 'public', false);
