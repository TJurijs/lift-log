-- Contract phase for the coordinated development rollout.
--
-- The policy statements are intentionally idempotent. They both close the
-- compatibility window after a normal expand/deploy rollout and reconcile the
-- development-only emergency rollback if that path was exercised during smoke.

begin;

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

drop policy if exists profiles_read_connected on public.profiles;
drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self
on public.profiles for select to authenticated
using (id = (select auth.uid()));

drop policy if exists programs_read_authorized on public.programs;
create policy programs_read_authorized
on public.programs for select to authenticated
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

drop policy if exists workout_sessions_read_authorized
  on public.workout_sessions;
drop policy if exists workout_sessions_read_owner
  on public.workout_sessions;
create policy workout_sessions_read_owner
on public.workout_sessions for select to authenticated
using (athlete_id = (select auth.uid()));

drop policy if exists session_item_logs_read_authorized
  on public.session_item_logs;
drop policy if exists session_item_logs_read_owner
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
drop policy if exists session_entries_read_owner
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

drop policy if exists coach_feedback_read_authorized
  on public.coach_feedback;
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

drop policy if exists coach_feedback_update_author
  on public.coach_feedback;
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

drop policy if exists coach_feedback_delete_author
  on public.coach_feedback;
create policy coach_feedback_delete_author
on public.coach_feedback for delete to authenticated
using (
  coach_id = (select auth.uid())
  and public.is_active_coach(athlete_id)
  and workout_session_id is not null
  and public.can_read_authored_session(workout_session_id)
);

-- Close both direct-write bypasses. Revision-guarded snapshot RPCs are now the
-- only authenticated mutation surface for an in-progress workout session.
revoke insert, update, delete on public.session_item_logs
  from public, anon, authenticated;
revoke insert, update, delete on public.session_entries
  from public, anon, authenticated;
revoke execute on function public.complete_workout_session(uuid, numeric, text)
  from public, anon, authenticated;

commit;
