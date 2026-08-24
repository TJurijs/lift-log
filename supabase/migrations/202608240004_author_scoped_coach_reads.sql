-- An active coaching relationship grants basic identity plus access to content
-- authored by that coach. It does not grant the athlete's unrelated programs,
-- calendar, history, or private notes.

create or replace function public.can_read_program(target_program_id uuid)
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
      and (
        program.athlete_id = (select auth.uid())
        or (
          program.created_by_id = (select auth.uid())
          and program.source_type = 'coach'
          and public.is_active_coach(program.athlete_id)
        )
      )
  );
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
    join public.program_versions version
      on version.id = session.program_version_id
    join public.programs program
      on program.id = version.program_id
    join public.coach_relationships relationship
      on relationship.athlete_id = session.athlete_id
     and relationship.coach_id = (select auth.uid())
     and relationship.ended_at is null
    where session.id = target_session_id
      and program.athlete_id = session.athlete_id
      and program.created_by_id = (select auth.uid())
      and program.source_type = 'coach'
  );
$$;

drop policy if exists profiles_read_connected on public.profiles;
create policy profiles_read_self on public.profiles for select to authenticated
using (id = (select auth.uid()));

drop policy if exists programs_read_authorized on public.programs;
create policy programs_read_authorized on public.programs for select to authenticated
using (public.can_read_program(id));

drop policy if exists program_availability_read_authorized
  on public.program_availability;
create policy program_availability_read_authorized
on public.program_availability for select to authenticated
using (
  athlete_id = (select auth.uid())
  or public.can_read_program(program_id)
);

drop policy if exists scheduled_workouts_read_authorized
  on public.scheduled_workouts;
create policy scheduled_workouts_read_authorized
on public.scheduled_workouts for select to authenticated
using (
  athlete_id = (select auth.uid())
  or public.can_read_version(program_version_id)
);

-- Session base tables remain fully available to their athlete owner. Coaches
-- receive a deliberately note-free projection from the RPCs below.
drop policy if exists workout_sessions_read_authorized
  on public.workout_sessions;
create policy workout_sessions_read_owner
on public.workout_sessions for select to authenticated
using (athlete_id = (select auth.uid()));

drop policy if exists session_item_logs_read_authorized
  on public.session_item_logs;
create policy session_item_logs_read_owner
on public.session_item_logs for select to authenticated
using (
  exists (
    select 1
    from public.workout_sessions session
    where session.id = session_item_logs.workout_session_id
      and session.athlete_id = (select auth.uid())
  )
);

drop policy if exists session_entries_read_authorized
  on public.session_entries;
create policy session_entries_read_owner
on public.session_entries for select to authenticated
using (
  exists (
    select 1
    from public.session_item_logs item
    join public.workout_sessions session
      on session.id = item.workout_session_id
    where item.id = session_entries.session_item_log_id
      and session.athlete_id = (select auth.uid())
  )
);

-- Feedback remains visible to its athlete and its own author, but feedback tied
-- to coaching access must be attached to content authored by that coach. The
-- dormant generic-feedback shape fails closed until a product surface defines
-- a narrower projection for it.
drop policy if exists coach_feedback_read_authorized on public.coach_feedback;
create policy coach_feedback_read_authorized
on public.coach_feedback for select to authenticated
using (
  athlete_id = (select auth.uid())
  or (
    coach_id = (select auth.uid())
    and public.is_active_coach(athlete_id)
    and workout_session_id is not null
    and public.can_read_authored_session(workout_session_id)
  )
);

drop policy if exists coach_feedback_create_active_coach
  on public.coach_feedback;
create policy coach_feedback_create_active_coach
on public.coach_feedback for insert to authenticated
with check (
  coach_id = (select auth.uid())
  and public.is_active_coach(athlete_id)
  and workout_session_id is not null
  and public.can_read_authored_session(workout_session_id)
);

drop policy if exists coach_feedback_update_author on public.coach_feedback;
create policy coach_feedback_update_author
on public.coach_feedback for update to authenticated
using (
  coach_id = (select auth.uid())
  and public.is_active_coach(athlete_id)
  and workout_session_id is not null
  and public.can_read_authored_session(workout_session_id)
)
with check (
  coach_id = (select auth.uid())
  and public.is_active_coach(athlete_id)
  and workout_session_id is not null
  and public.can_read_authored_session(workout_session_id)
);

drop policy if exists coach_feedback_delete_author on public.coach_feedback;
create policy coach_feedback_delete_author
on public.coach_feedback for delete to authenticated
using (
  coach_id = (select auth.uid())
  and public.is_active_coach(athlete_id)
  and workout_session_id is not null
  and public.can_read_authored_session(workout_session_id)
);

create or replace function public.get_own_profile()
returns table (
  id uuid,
  display_name text,
  first_name text,
  last_name text,
  liftlog_id text,
  week_starts_on_sunday boolean,
  weight_unit text,
  distance_unit text,
  timezone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.display_name,
    profile.first_name,
    profile.last_name,
    profile.liftlog_id,
    profile.week_starts_on_sunday,
    profile.weight_unit,
    profile.distance_unit,
    profile.timezone
  from public.profiles profile
  where profile.id = (select auth.uid());
$$;

create or replace function public.list_connected_profile_summaries()
returns table (
  id uuid,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.display_name
  from public.profiles profile
  where (select auth.uid()) is not null
    and (
      profile.id = (select auth.uid())
      or exists (
        select 1
        from public.coach_relationships relationship
        where relationship.ended_at is null
          and (
            (
              relationship.athlete_id = (select auth.uid())
              and relationship.coach_id = profile.id
            )
            or (
              relationship.coach_id = (select auth.uid())
              and relationship.athlete_id = profile.id
            )
          )
      )
    )
  order by profile.id;
$$;

create or replace function public.list_authored_coach_session_summaries(
  target_athlete_id uuid default null,
  target_limit integer default 100,
  target_before_started_at timestamptz default null,
  target_before_id uuid default null
)
returns table (
  id uuid,
  athlete_id uuid,
  program_version_id uuid,
  workout_id uuid,
  scheduled_workout_id uuid,
  workout_title text,
  started_at timestamptz,
  completed_at timestamptz,
  completed_for_date date,
  session_rpe numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    session.id,
    session.athlete_id,
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
  where (select auth.uid()) is not null
    and session.status = 'completed'
    and program.athlete_id = session.athlete_id
    and program.created_by_id = (select auth.uid())
    and program.source_type = 'coach'
    and (
      target_athlete_id is null
      or session.athlete_id = target_athlete_id
    )
    and (
      (
        target_before_started_at is null
        and target_before_id is null
      )
      or (
        target_before_started_at is not null
        and target_before_id is not null
        and (session.started_at, session.id)
          < (target_before_started_at, target_before_id)
      )
    )
  order by session.started_at desc, session.id desc
  limit least(greatest(coalesce(target_limit, 100), 1), 250);
$$;

create or replace function public.get_authored_coach_session_detail(
  target_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_payload jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'id', session.id,
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
        select
          item.id,
          item.position,
          jsonb_build_object(
            'id', item.id,
            'title', item.snapshot_name,
            'cue', item.snapshot_cue,
            'mode', item.entry_mode,
            'fields', item.tracking_fields,
            'position', item.position,
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
                  'rpe', entry.rpe
                )
                order by entry.position, entry.id
              )
              from public.session_entries entry
              where entry.session_item_log_id = item.id
            ), '[]'::jsonb)
          ) as payload
        from public.session_item_logs item
        where item.workout_session_id = session.id
      ) item_payload
    ), '[]'::jsonb)
  )
  into result_payload
  from public.workout_sessions session
  join public.program_versions version
    on version.id = session.program_version_id
  join public.programs program
    on program.id = version.program_id
  join public.coach_relationships relationship
    on relationship.athlete_id = session.athlete_id
   and relationship.coach_id = (select auth.uid())
   and relationship.ended_at is null
  where session.id = target_session_id
    and session.status = 'completed'
    and program.athlete_id = session.athlete_id
    and program.created_by_id = (select auth.uid())
    and program.source_type = 'coach';

  return result_payload;
end;
$$;

create or replace function public.get_own_session_notes(
  target_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_payload jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'sessionNote', session.athlete_note,
    'itemNotes', coalesce((
      select jsonb_object_agg(
        item.id::text,
        item.athlete_note
        order by item.id
      )
      from public.session_item_logs item
      where item.workout_session_id = session.id
    ), '{}'::jsonb),
    'entryNotes', coalesce((
      select jsonb_object_agg(
        entry.id::text,
        entry.note
        order by entry.id
      )
      from public.session_entries entry
      join public.session_item_logs item
        on item.id = entry.session_item_log_id
      where item.workout_session_id = session.id
    ), '{}'::jsonb)
  )
  into result_payload
  from public.workout_sessions session
  where session.id = target_session_id
    and session.athlete_id = (select auth.uid());

  return result_payload;
end;
$$;

create index if not exists idx_programs_coach_authored_athlete
  on public.programs (created_by_id, athlete_id, id)
  where source_type = 'coach';

create index if not exists idx_workout_sessions_version_completed_started
  on public.workout_sessions (program_version_id, started_at desc, id)
  where status = 'completed';

revoke all on function public.can_read_authored_session(uuid)
  from public, anon, authenticated;
revoke all on function public.get_own_profile()
  from public, anon, authenticated;
revoke all on function public.list_connected_profile_summaries()
  from public, anon, authenticated;
revoke all on function public.list_authored_coach_session_summaries(
  uuid,
  integer,
  timestamptz,
  uuid
)
  from public, anon, authenticated;
revoke all on function public.get_authored_coach_session_detail(uuid)
  from public, anon, authenticated;
revoke all on function public.get_own_session_notes(uuid)
  from public, anon, authenticated;

grant execute on function public.can_read_authored_session(uuid)
  to authenticated;
grant execute on function public.get_own_profile()
  to authenticated;
grant execute on function public.list_connected_profile_summaries()
  to authenticated;
grant execute on function public.list_authored_coach_session_summaries(
  uuid,
  integer,
  timestamptz,
  uuid
)
  to authenticated;
grant execute on function public.get_authored_coach_session_detail(uuid)
  to authenticated;
grant execute on function public.get_own_session_notes(uuid)
  to authenticated;

select pg_catalog.set_config('search_path', 'public', false);
