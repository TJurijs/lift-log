-- A scheduled workout can be edited independently of its source and of other
-- athletes' copies. Keep the original slot identity for ordering/repetition,
-- and attach a private, single-workout draft only when somebody edits it.
-- Starting the workout publishes that private draft in the same transaction.
begin;

alter table public.program_run_workouts
  add column edited_workout_id uuid references public.workouts(id) on delete restrict;
alter table public.programs
  add column run_workout_id uuid unique references public.program_run_workouts(id) on delete restrict;

create or replace function private.can_adjust_run_workout(target_slot_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.program_run_workouts slot
    join public.program_runs run on run.id = slot.program_run_id
    where slot.id = target_slot_id
      and slot.status in ('unscheduled', 'scheduled')
      and run.status in ('not_started', 'in_progress')
      and (run.athlete_id = (select auth.uid()) or (
        run.created_by_id = (select auth.uid()) and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = run.athlete_id
            and relationship.coach_id = (select auth.uid())
            and relationship.ended_at is null
        )
      ))
      and not exists (select 1 from public.workout_sessions session
        where session.program_run_workout_id = slot.id)
  );
$$;

create or replace function public.can_edit_program(target_program_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.programs program
    where program.id = target_program_id and (
      (program.run_workout_id is not null and private.can_adjust_run_workout(program.run_workout_id))
      or (program.run_workout_id is null and program.archived_at is null
        and program.created_by_id = (select auth.uid()) and (
          (program.source_type = 'self' and program.athlete_id = (select auth.uid()))
          or (program.source_type = 'coach' and public.is_active_coach(program.athlete_id))
        ))
    )
  );
$$;

-- Unlike a week clone this helper also preserves section notes/order. The
-- lineage IDs are copied, while prescription IDs are always newly allocated.
create or replace function private.clone_single_workout(
  source_workout_id uuid, target_week_id uuid, target_position integer
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare source_workout public.workouts%rowtype; source_section record; source_item record;
  new_workout_id uuid; new_section_id uuid; new_item_id uuid;
begin
  select * into source_workout from public.workouts where id = source_workout_id;
  if not found then raise exception 'Workout content is unavailable'; end if;
  insert into public.workouts(program_week_id, title, day_of_week, schedule_label,
    position, estimated_minutes, history_lineage_id)
  values(target_week_id, source_workout.title, source_workout.day_of_week,
    source_workout.schedule_label, target_position, source_workout.estimated_minutes,
    source_workout.history_lineage_id) returning id into new_workout_id;
  for source_section in select * from public.workout_sections
    where workout_id = source_workout_id order by position, id
  loop
    insert into public.workout_sections(workout_id, title, section_kind, notes, position)
    values(new_workout_id, source_section.title, source_section.section_kind,
      source_section.notes, source_section.position) returning id into new_section_id;
    for source_item in select * from public.workout_items
      where section_id = source_section.id order by position, id
    loop
      insert into public.workout_items(section_id, source_exercise_id, snapshot_name,
        snapshot_cue, entry_mode, tracking_fields, position, history_lineage_id)
      values(new_section_id, source_item.source_exercise_id, source_item.snapshot_name,
        source_item.snapshot_cue, source_item.entry_mode, source_item.tracking_fields,
        source_item.position, source_item.history_lineage_id) returning id into new_item_id;
      insert into public.prescribed_entries(workout_item_id, position, reps_min, reps_max,
        load_kg, duration_seconds, distance_metres, rounds, work_seconds, rest_seconds,
        target_rpe_min, target_rpe_max, target_text)
      select new_item_id, position, reps_min, reps_max, load_kg, duration_seconds,
        distance_metres, rounds, work_seconds, rest_seconds, target_rpe_min,
        target_rpe_max, target_text from public.prescribed_entries
      where workout_item_id = source_item.id order by position;
    end loop;
  end loop;
  return new_workout_id;
end;
$$;

create or replace function public.prepare_program_run_workout_edit(target_run_workout_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_slot public.program_run_workouts%rowtype; target_run public.program_runs%rowtype;
  new_program_id uuid; new_version_id uuid; new_week_id uuid; new_workout_id uuid;
  source_title text; viewer uuid := (select auth.uid());
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  select run.* into target_run from public.program_runs run
  join public.program_run_workouts slot on slot.program_run_id = run.id
  where slot.id = target_run_workout_id for update of run;
  select * into target_slot from public.program_run_workouts
  where id = target_run_workout_id for update;
  if not found or not private.can_adjust_run_workout(target_run_workout_id) then
    raise exception 'Only an upcoming workout can be edited';
  end if;
  if target_slot.scheduled_workout_id is not null then
    perform occurrence.id from public.scheduled_workouts occurrence
    where occurrence.id = target_slot.scheduled_workout_id for update;
    -- Recheck after a concurrent start has released its schedule lock.
    if not private.can_adjust_run_workout(target_run_workout_id) then
      raise exception 'Only an upcoming workout can be edited';
    end if;
  end if;
  if target_slot.edited_workout_id is not null then
    select version.program_id, version.id into new_program_id, new_version_id
    from public.workouts workout join public.program_weeks week on week.id = workout.program_week_id
    join public.program_versions version on version.id = week.program_version_id
    where workout.id = target_slot.edited_workout_id and version.status = 'draft';
    if not found then raise exception 'Only an upcoming workout can be edited'; end if;
    new_workout_id := target_slot.edited_workout_id;
  else
    select title into source_title from public.workouts where id = target_slot.workout_id;
    -- archived_at keeps the implementation container out of every library and
    -- picker. Its edit/read capability is governed by the linked slot instead.
    insert into public.programs(athlete_id, created_by_id, title, description,
      planning_mode, is_current, source_type, source_label, content_type, archived_at, run_workout_id)
    values(target_run.athlete_id, target_run.created_by_id, source_title, '', 'fixed_weeks', false,
      case when target_run.athlete_id = target_run.created_by_id then 'self' else 'coach' end,
      'Workout copy', 'quick_workout', now(), target_slot.id) returning id into new_program_id;
    insert into public.program_versions(program_id, authored_by_id, version_number, status)
    values(new_program_id, viewer, 1, 'draft') returning id into new_version_id;
    insert into public.program_weeks(program_version_id, week_index, label)
    values(new_version_id, 1, 'Workout') returning id into new_week_id;
    new_workout_id := private.clone_single_workout(target_slot.workout_id, new_week_id, 0);
    update public.program_run_workouts set edited_workout_id = new_workout_id where id = target_slot.id;
    update public.scheduled_workouts set workout_id = new_workout_id, program_version_id = new_version_id
    where id = target_slot.scheduled_workout_id;
  end if;
  return jsonb_build_object('programId', new_program_id, 'programVersionId', new_version_id,
    'workoutId', new_workout_id, 'runId', target_run.id, 'runWorkoutId', target_slot.id);
end;
$$;

revoke all on function private.can_adjust_run_workout(uuid) from public, anon, authenticated;
revoke all on function private.clone_single_workout(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.prepare_program_run_workout_edit(uuid) from public, anon;
grant execute on function public.prepare_program_run_workout_edit(uuid) to authenticated;

create or replace function private.replace_draft_workout_contents(source_workout_id uuid, target_workout_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare source_section record; source_item record; new_section_id uuid; new_item_id uuid;
begin
  update public.workouts target set title = source.title, estimated_minutes = source.estimated_minutes,
    schedule_label = source.schedule_label, day_of_week = source.day_of_week
  from public.workouts source where target.id = target_workout_id and source.id = source_workout_id;
  delete from public.prescribed_entries entry using public.workout_items item, public.workout_sections section
  where entry.workout_item_id = item.id and item.section_id = section.id and section.workout_id = target_workout_id;
  delete from public.workout_items item using public.workout_sections section
  where item.section_id = section.id and section.workout_id = target_workout_id;
  delete from public.workout_sections where workout_id = target_workout_id;
  for source_section in select * from public.workout_sections
    where workout_id = source_workout_id order by position, id
  loop
    insert into public.workout_sections(workout_id, title, section_kind, notes, position)
    values(target_workout_id, source_section.title, source_section.section_kind,
      source_section.notes, source_section.position) returning id into new_section_id;
    for source_item in select * from public.workout_items
      where section_id = source_section.id order by position, id
    loop
      insert into public.workout_items(section_id, source_exercise_id, snapshot_name,
        snapshot_cue, entry_mode, tracking_fields, position, history_lineage_id)
      values(new_section_id, source_item.source_exercise_id, source_item.snapshot_name,
        source_item.snapshot_cue, source_item.entry_mode, source_item.tracking_fields,
        source_item.position, source_item.history_lineage_id) returning id into new_item_id;
      insert into public.prescribed_entries(workout_item_id, position, reps_min, reps_max,
        load_kg, duration_seconds, distance_metres, rounds, work_seconds, rest_seconds,
        target_rpe_min, target_rpe_max, target_text)
      select new_item_id, position, reps_min, reps_max, load_kg, duration_seconds,
        distance_metres, rounds, work_seconds, rest_seconds, target_rpe_min,
        target_rpe_max, target_text from public.prescribed_entries
      where workout_item_id = source_item.id order by position;
    end loop;
  end loop;
end;
$$;
revoke all on function private.replace_draft_workout_contents(uuid, uuid) from public, anon, authenticated;

-- Callers cannot turn a private occurrence copy into a library entry or move
-- its identity to a different run. Copies for reuse go through the copy RPC.
create or replace function private.guard_run_workout_container()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('liftlog.test_reset', true) = 'on'
    and coalesce((select auth.role()), '') = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    if new.run_workout_id is not null and (
      not private.can_adjust_run_workout(new.run_workout_id)
      or new.archived_at is null or new.is_current or new.content_type <> 'quick_workout'
      or not exists (select 1 from public.program_run_workouts slot
        join public.program_runs run on run.id = slot.program_run_id
        where slot.id = new.run_workout_id and run.athlete_id = new.athlete_id
          and run.created_by_id = new.created_by_id)
    ) then raise exception 'Workout copy must belong to an editable upcoming workout'; end if;
    return new;
  end if;
  if new.run_workout_id is distinct from old.run_workout_id then
    raise exception 'Workout copy identity cannot be changed';
  end if;
  if old.run_workout_id is not null and (new.archived_at is null or new.is_current) then
    raise exception 'Workout copies remain attached to their program';
  end if;
  return new;
end;
$$;
create trigger guard_run_workout_container before insert or update on public.programs
for each row execute function private.guard_run_workout_container();
revoke all on function private.guard_run_workout_container() from public, anon, authenticated;

-- Lifecycle function implementations.

create or replace function private.validate_program_run_workout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The service-only fixture reset must break the historical schedule/slot
  -- pointer before deleting the whole isolated test aggregate. No application
  -- caller can enable this path.
  if current_setting('liftlog.test_reset', true) = 'on'
    and coalesce((select auth.role()), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.edited_workout_id is distinct from old.edited_workout_id then
    if old.edited_workout_id is not null or new.edited_workout_id is null
      or not private.can_adjust_run_workout(old.id) or not exists (
        select 1 from public.workouts workout
        join public.program_weeks week on week.id = workout.program_week_id
        join public.program_versions version on version.id = week.program_version_id
        join public.programs program on program.id = version.program_id
        where workout.id = new.edited_workout_id and program.run_workout_id = old.id
          and version.status = 'draft'
      ) then raise exception 'Workout copy identity cannot be changed'; end if;
  end if;
  if tg_op = 'UPDATE' and (
    new.program_run_id is distinct from old.program_run_id
    or new.workout_id is distinct from old.workout_id
    or new.position is distinct from old.position
    or (
      old.scheduled_workout_id is not null
      and new.scheduled_workout_id is distinct from old.scheduled_workout_id
    )
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Program run workout identity is immutable';
  end if;

  if not exists (
    select 1
    from public.program_runs run
    join public.program_weeks week
      on week.program_version_id = run.program_version_id
    join public.workouts workout on workout.program_week_id = week.id
    where run.id = new.program_run_id
      and workout.id = new.workout_id
  ) then
    raise exception 'Run workout is not part of the immutable program revision';
  end if;
  return new;
end;
$$;

create or replace function private.protect_schedule_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  assignment public.program_assignments%rowtype;
  linked_run public.program_runs%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.program_version_id is distinct from old.program_version_id
      or new.workout_id is distinct from old.workout_id then
      if old.status <> 'planned' or new.status <> 'planned'
        or not private.can_adjust_run_workout(old.program_run_workout_id)
        or not exists (
          select 1 from public.program_run_workouts slot
          join public.workouts workout on workout.id = slot.edited_workout_id
          join public.program_weeks week on week.id = workout.program_week_id
          join public.program_versions version on version.id = week.program_version_id
          join public.programs program on program.id = version.program_id
          where slot.id = old.program_run_workout_id
            and slot.program_run_id = old.program_run_id
            and workout.id = new.workout_id and version.id = new.program_version_id
            and program.run_workout_id = slot.id and version.status = 'draft'
        ) then raise exception 'Only an upcoming workout can be edited'; end if;
    end if;
    if new.athlete_id is distinct from old.athlete_id
      or new.scheduled_by_id is distinct from old.scheduled_by_id
      or new.assignment_id is distinct from old.assignment_id
      or new.request_key is distinct from old.request_key
      or new.program_run_id is distinct from old.program_run_id
      or new.program_run_workout_id is distinct from old.program_run_workout_id then
      raise exception 'Scheduled workout identity and scheduler cannot be changed';
    end if;
    return new;
  end if;

  if new.program_run_workout_id is not null then
    select run.* into linked_run
    from public.program_run_workouts slot
    join public.program_runs run on run.id = slot.program_run_id
    where slot.id = new.program_run_workout_id
      and slot.program_run_id = new.program_run_id
      and coalesce(slot.edited_workout_id, slot.workout_id) = new.workout_id
      and run.athlete_id = new.athlete_id
      and (run.program_version_id = new.program_version_id or exists (
        select 1 from public.workouts edited
        join public.program_weeks week on week.id = edited.program_week_id
        where edited.id = slot.edited_workout_id and week.program_version_id = new.program_version_id
      ))
      and run.status <> 'ended';
    if not found then raise exception 'Scheduled workout run lineage is invalid'; end if;
    if new.assignment_id is distinct from linked_run.legacy_assignment_id then
      raise exception 'Scheduled workout assignment/run lineage is invalid';
    end if;
    if new.scheduled_by_id = new.athlete_id then
      if current_user_id is not null and current_user_id is distinct from new.athlete_id then
        raise exception 'Athlete-scheduled workout must record the authenticated athlete';
      end if;
    elsif current_user_id is null
      or new.scheduled_by_id is distinct from current_user_id
      or linked_run.created_by_id is distinct from current_user_id
      or not exists (
        select 1 from public.coach_relationships relationship
        where relationship.athlete_id = new.athlete_id
          and relationship.coach_id = current_user_id
          and relationship.ended_at is null
      ) then
      raise exception 'Coach-scheduled workout provenance is invalid';
    end if;
    return new;
  end if;

  if new.program_run_id is not null then
    raise exception 'Scheduled workout run slot is required';
  end if;

  if new.assignment_id is not null then
    select candidate.* into assignment
    from public.program_assignments candidate
    where candidate.id = new.assignment_id;
    if not found or assignment.status <> 'active'
      or assignment.athlete_id is distinct from new.athlete_id
      or private.assignment_content_version(assignment.id) is distinct from new.program_version_id
      or not exists (
        select 1 from public.workouts workout
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
    if current_user_id is not null and current_user_id is distinct from new.athlete_id then
      raise exception 'Athlete-scheduled workout must record the authenticated athlete';
    end if;
    return new;
  end if;
  if current_user_id is null or new.scheduled_by_id is distinct from current_user_id
    or new.status is distinct from 'planned' or new.planned_date is null then
    raise exception 'Coach-scheduled workout provenance is invalid';
  end if;
  perform relationship.id
  from public.coach_relationships relationship
  where relationship.athlete_id = new.athlete_id
    and relationship.coach_id = current_user_id
    and relationship.ended_at is null
  for share;
  if not found then raise exception 'Coach can only schedule for an actively coached athlete'; end if;

  if new.assignment_id is not null then
    if assignment.assigned_by_id is distinct from current_user_id
      or not exists (
        select 1 from public.programs program
        where program.id = coalesce(assignment.customized_program_id, assignment.source_program_id)
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
    or new.program_run_id is distinct from old.program_run_id
    or new.program_run_workout_id is distinct from old.program_run_workout_id
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
      and scheduled.program_run_id is not distinct from new.program_run_id
      and scheduled.program_run_workout_id is not distinct from new.program_run_workout_id
  ) then
    raise exception 'Workout session does not match its scheduled workout';
  end if;
  if tg_op <> 'DELETE'
    and new.program_run_id is not null
    and not exists (
      select 1
      from public.program_runs run
      join public.program_run_workouts slot on slot.program_run_id = run.id
      where run.id = new.program_run_id
        and slot.id = new.program_run_workout_id
        and run.athlete_id = new.athlete_id
        and coalesce(slot.edited_workout_id, slot.workout_id) = new.workout_id
        and (run.program_version_id = new.program_version_id or exists (
          select 1 from public.workouts edited
          join public.program_weeks week on week.id = edited.program_week_id
          join public.program_versions version on version.id = week.program_version_id
          where edited.id = slot.edited_workout_id and version.id = new.program_version_id
            and version.status in ('published', 'superseded')
        ))
    ) then
    raise exception 'Workout session run lineage is invalid';
  end if;
  if tg_op <> 'DELETE'
    and new.workout_id is not null
    and new.program_version_id is not null
    and new.assignment_id is not null
    and new.program_run_id is null
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
    and new.program_run_id is null
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

create or replace function public.can_read_version(target_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.program_versions version
    where version.id = target_version_id
      and (
        -- An athlete may consume immutable content addressed by their program,
        -- but a coach's working draft is private until it becomes a run
        -- snapshot. The author keeps normal draft access through can_edit.
        (version.status in ('published', 'superseded')
          and public.can_read_program(version.program_id))
        or public.can_edit_program(version.program_id)
      )
  ) or exists (
    select 1 from public.program_versions version
    join public.programs program on program.id = version.program_id
    join public.program_run_workouts slot on slot.id = program.run_workout_id
    where version.id = target_version_id and private.can_read_program_run(slot.program_run_id)
  ) or exists (
    select 1 from public.program_runs run
    where run.program_version_id = target_version_id
      and private.can_read_program_run(run.id)
  );
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
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if (target_program_id is null) = (target_assignment_id is null) then
    raise exception 'Choose exactly one program or assignment';
  end if;

  if target_assignment_id is not null then
    select assignment.* into selected_assignment
    from public.program_assignments assignment
    where assignment.id = target_assignment_id
      and assignment.status = 'active'
      and (
        assignment.athlete_id = current_user_id
        or (
          assignment.assigned_by_id = current_user_id
          and exists (
            select 1 from public.coach_relationships relationship
            where relationship.athlete_id = assignment.athlete_id
              and relationship.coach_id = current_user_id
              and relationship.ended_at is null
          )
        )
      );
    if not found then return null; end if;

    may_read_draft := selected_assignment.assigned_by_id = current_user_id
      and exists (
        select 1 from public.coach_relationships relationship
        where relationship.athlete_id = selected_assignment.athlete_id
          and relationship.coach_id = current_user_id
          and relationship.ended_at is null
      );

    if target_version_id is not null then
      select version.* into selected_version
      from public.program_versions version
      where version.id = target_version_id
        and (
          version.id = selected_assignment.source_version_id
          or version.program_id = selected_assignment.customized_program_id
        )
        and (version.status <> 'draft' or may_read_draft);
    elsif may_read_draft and selected_assignment.customized_program_id is not null then
      select version.* into selected_version
      from public.program_versions version
      where version.program_id = selected_assignment.customized_program_id
      order by
        case version.status when 'draft' then 0 when 'published' then 1 else 2 end,
        version.version_number desc, version.id
      limit 1;
    else
      select version.* into selected_version
      from public.program_versions version
      where version.id = private.assignment_content_version(selected_assignment.id);
    end if;
  else
    select program.* into selected_program
    from public.programs program
    where program.id = target_program_id
      and (
        program.athlete_id = current_user_id
        or (program.run_workout_id is not null and public.can_edit_program(program.id))
        or (
          program.created_by_id = current_user_id
          and program.source_type = 'coach'
          and exists (
            select 1 from public.coach_relationships relationship
            where relationship.athlete_id = program.athlete_id
              and relationship.coach_id = current_user_id
              and relationship.ended_at is null
          )
        )
      );
    if not found then return null; end if;

    may_read_draft := public.can_edit_program(selected_program.id);
    if target_version_id is not null then
      select version.* into selected_version
      from public.program_versions version
      where version.id = target_version_id
        and version.program_id = selected_program.id
        and (version.status <> 'draft' or may_read_draft);
    elsif may_read_draft then
      select version.* into selected_version
      from public.program_versions version
      where version.program_id = selected_program.id
      order by
        case version.status when 'draft' then 0 when 'published' then 1 else 2 end,
        version.version_number desc, version.id
      limit 1;
    else
      select version.* into selected_version
      from public.program_versions version
      where version.program_id = selected_program.id
        and version.status in ('published', 'superseded')
      order by
        case version.status when 'published' then 0 else 1 end,
        version.version_number desc, version.id
      limit 1;
    end if;
  end if;

  if selected_version.id is null then return null; end if;
  select program.* into selected_program
  from public.programs program
  where program.id = selected_version.program_id;

  return jsonb_build_object(
    'kind', case when target_assignment_id is null then 'program' else 'assignment' end,
    'id', coalesce(target_assignment_id, selected_program.id),
    'programId', selected_program.id,
    'assignmentId', target_assignment_id,
    'editableRunWorkoutId', selected_program.run_workout_id,
    'editableRunId', (select slot.program_run_id from public.program_run_workouts slot where slot.id = selected_program.run_workout_id),
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

  -- Editing, scheduling and starting use the same run -> occurrence lock
  -- order. Never hold a schedule while waiting for its run lock.
  perform run.id from public.program_runs run
  join public.scheduled_workouts occurrence on occurrence.program_run_id = run.id
  where occurrence.id = target_scheduled_workout_id and occurrence.athlete_id = current_user_id
  for update of run;

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

  -- Freeze the private copy before creating actuals. Direct draft writers
  -- acquire the same version lock, so a concurrent save either finishes first
  -- or fails once this publication commits.
  if exists (select 1 from public.programs program
    join public.program_versions version on version.program_id = program.id
    where version.id = scheduled_occurrence.program_version_id
      and program.run_workout_id = scheduled_occurrence.program_run_workout_id) then
    update public.program_versions set status = 'published', effective_from = current_date
    where id = scheduled_occurrence.program_version_id and status = 'draft';
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

  -- Session drafts support at most 250 rows per exercise. Reject an oversized
  -- legacy round count explicitly instead of truncating its completed work.
  if exists (
    select item.id
    from public.workout_sections section
    join public.workout_items item on item.section_id = section.id
    join public.prescribed_entries prescribed on prescribed.workout_item_id = item.id
    where section.workout_id = scheduled_occurrence.workout_id
      and item.entry_mode = 'intervals'
    group by item.id
    having count(*) = 1 and max(prescribed.rounds) > 250
  ) then
    raise exception 'An interval exercise cannot contain more than 250 rounds';
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
      concat_ws(E'\n',
        nullif(btrim(item.snapshot_cue), ''),
        nullif(target_notes.value, nullif(btrim(item.snapshot_cue), ''))
      ) as snapshot_cue,
      item.entry_mode,
      item.tracking_fields,
      row_number() over (
        order by section.position, item.position, item.id
      )::integer - 1 as session_position
    from public.workout_sections section
    join public.workout_items item on item.section_id = section.id
    cross join lateral (
      select case
        -- Old clients commonly repeat one shared target on every prescribed
        -- row. Keep that instruction once, also deduplicating it against cue.
        when count(distinct note.value) = 1 then min(note.value)
        -- Different row instructions must retain their original association;
        -- joining them as one unlabelled global note would change the plan.
        else string_agg(
          case item.entry_mode when 'sets' then 'Set '
            when 'intervals' then 'Round ' else 'Entry ' end
          || (note.position + 1)::text || ': ' || note.value,
          E'\n' order by note.position
        )
      end as value
      from (
        select prescribed.position, nullif(btrim(prescribed.target_text), '') as value
        from public.prescribed_entries prescribed
        where prescribed.workout_item_id = item.id
          and nullif(btrim(prescribed.target_text), '') is not null
      ) note
    ) target_notes
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
    returning id, source_workout_item_id, entry_mode, tracking_fields
  ),
  prescribed_seed as (
    select inserted.id as session_item_log_id, inserted.entry_mode,
      inserted.tracking_fields, prescribed.position as prescribed_position,
      prescribed.reps_min, prescribed.reps_max, prescribed.load_kg,
      prescribed.duration_seconds, prescribed.distance_metres,
      prescribed.rounds, prescribed.work_seconds,
      count(prescribed.id) over (partition by inserted.id) as prescribed_count,
      row_number() over (partition by inserted.id order by prescribed.position) as prescribed_index
    from inserted_items inserted
    left join public.prescribed_entries prescribed
      on prescribed.workout_item_id = inserted.source_workout_item_id
    where inserted.entry_mode <> 'none'
  ),
  entry_seed as (
    -- Repeated prescribed rows are individual sets/rounds. A legacy interval
    -- with one prescription and N rounds expands into N individual entries.
    -- A missing prescription retains one empty row, without inventing a dose.
    select seed.*, case
      when seed.entry_mode = 'intervals' and seed.prescribed_count <= 1 then round.position
      else coalesce(seed.prescribed_position, 0)
    end as position
    from prescribed_seed seed
    cross join lateral generate_series(0, case
      when seed.entry_mode = 'intervals' and seed.prescribed_count <= 1
        then greatest(1, coalesce(seed.rounds, 1))
      else 1 end - 1) as round(position)
    where seed.entry_mode <> 'result' or seed.prescribed_index = 1
  )
  insert into public.session_entries (
    session_item_log_id, position, reps, load_kg, duration_seconds,
    distance_metres, rounds
  )
  select entry.session_item_log_id, entry.position,
    case when 'reps' = any(entry.tracking_fields)
      and (entry.reps_min is null or entry.reps_max is null or entry.reps_min = entry.reps_max)
      and coalesce(entry.reps_min, entry.reps_max) = trunc(coalesce(entry.reps_min, entry.reps_max))
      then coalesce(entry.reps_min, entry.reps_max) end,
    case when 'load' = any(entry.tracking_fields) then entry.load_kg end,
    case when 'duration' = any(entry.tracking_fields) then
      case when entry.entry_mode = 'intervals' then coalesce(entry.work_seconds, entry.duration_seconds)
        else entry.duration_seconds end end,
    case when 'distance' = any(entry.tracking_fields) then entry.distance_metres end,
    case when entry.entry_mode = 'intervals' and 'rounds' = any(entry.tracking_fields) then 1 end
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

create or replace function public.get_program_run_detail(target_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result_payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not private.can_read_program_run(target_run_id) then
    raise exception 'Program run was not found';
  end if;
  select jsonb_build_object(
    'id', run.id,
    'athleteId', run.athlete_id,
    'createdById', run.created_by_id,
    'programId', run.source_program_id,
    'programVersionId', run.program_version_id,
    'title', version.title,
    'contentType', program.content_type,
    'status', run.status,
    'totalWorkouts', count(slot.id),
    'scheduledWorkouts', count(slot.id) filter (where slot.planned_date is not null),
    'completedWorkouts', count(slot.id) filter (where slot.status = 'completed'),
    'completionPercent', case when count(slot.id) = 0 then 0 else round(
      count(slot.id) filter (where slot.status = 'completed')::numeric
      * 100 / count(slot.id)
    )::integer end,
    'repeatedFromRunId', run.repeated_from_run_id,
    'createdAt', run.created_at,
    'endedAt', run.ended_at,
    'finishedAt', coalesce(run.completed_at, run.ended_at),
    'workouts', coalesce(jsonb_agg(jsonb_build_object(
      'id', slot.id,
      'runId', slot.program_run_id,
      'workoutId', slot.workout_id,
      'effectiveWorkoutId', coalesce(slot.edited_workout_id, slot.workout_id),
      'effectiveProgramId', effective_version.program_id,
      'effectiveProgramVersionId', effective_version.id,
      'canEdit', private.can_adjust_run_workout(slot.id),
      'title', workout.title,
      'position', slot.position,
      'estimatedMinutes', workout.estimated_minutes,
      'plannedDate', slot.planned_date,
      'status', slot.status,
      'scheduledWorkoutId', slot.scheduled_workout_id,
      'sessionId', completed_session.id,
      'completedAt', completed_session.completed_at,
      'completedForDate', completed_session.completed_for_date,
      'sessionRpe', completed_session.session_rpe,
      'prescriptionOverrides', slot.prescription_overrides
    ) order by slot.position, slot.id) filter (where slot.id is not null), '[]'::jsonb)
  ) into result_payload
  from public.program_runs run
  join public.program_versions version on version.id = run.program_version_id
  join public.programs program on program.id = run.source_program_id
  left join public.program_run_workouts slot on slot.program_run_id = run.id
  left join public.workouts workout on workout.id = coalesce(slot.edited_workout_id, slot.workout_id)
  left join public.program_weeks effective_week on effective_week.id = workout.program_week_id
  left join public.program_versions effective_version on effective_version.id = effective_week.program_version_id
  left join lateral (
    select session.id, session.completed_at,
      session.completed_for_date, session.session_rpe
    from public.workout_sessions session
    where session.program_run_workout_id = slot.id
      and session.status = 'completed'
    order by session.completed_at desc, session.id desc
    limit 1
  ) completed_session on true
  where run.id = target_run_id
  group by run.id, version.title, program.content_type;
  return result_payload;
end;
$$;

create or replace function public.list_program_run_summaries(
  target_athlete_id uuid default null,
  page_limit integer default 26,
  after_created_at timestamptz default null,
  after_id uuid default null,
  creator_scope text default 'all'
)
returns table (
  id uuid, athlete_id uuid, created_by_id uuid, program_id uuid,
  program_version_id uuid, title text, content_type text, status text,
  total_workouts bigint, scheduled_workouts bigint, completed_workouts bigint,
  completion_percent integer, next_workout_id uuid, next_workout_title text,
  next_workout_date date, next_workout_status text,
  repeated_from_run_id uuid, created_at timestamptz, ended_at timestamptz,
  finished_at timestamptz
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

  return query
  with run_page as materialized (
    -- Keep each creator scope in its own branch. Besides making the access
    -- semantics auditable, the direct coach predicate lets a generic cached
    -- PL/pgSQL plan use idx_program_runs_athlete_coach_summary_page.
    (
      select candidate.*
      from public.program_runs candidate
      where creator_scope = 'all'
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
      where creator_scope = 'self'
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
      where creator_scope = 'coach'
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
    coalesce(run.completed_at, run.ended_at)
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
  order by run.created_at desc, run.id desc;
end;
$$;

create or replace function public.get_program_run_program_detail(
  target_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_run public.program_runs%rowtype;
  version public.program_versions%rowtype;
  program public.programs%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not private.can_read_program_run(target_run_id) then
    raise exception 'Program run was not found';
  end if;
  select run.* into target_run
  from public.program_runs run where run.id = target_run_id;
  select candidate.* into version
  from public.program_versions candidate
  where candidate.id = target_run.program_version_id;
  select source.* into program
  from public.programs source where source.id = target_run.source_program_id;

  return jsonb_build_object(
    'kind', 'run',
    'id', target_run.id,
    'programRunId', target_run.id,
    'programId', program.id,
    'athleteId', target_run.athlete_id,
    'createdById', target_run.created_by_id,
    'versionId', version.id,
    'versionNumber', version.version_number,
    'versionStatus', version.status,
    'title', version.title,
    'description', version.description,
    'planningMode', program.planning_mode,
    'sourceType', case when target_run.created_by_id = target_run.athlete_id
      then 'self' else 'coach' end,
    'contentType', program.content_type,
    'effectiveFrom', version.effective_from,
    'publishedAt', version.published_at
  ) || jsonb_build_object('phases', '[]'::jsonb, 'weeks', jsonb_build_array(jsonb_build_object(
    'id', (select week.id from public.program_weeks week where week.program_version_id = version.id order by week.week_index limit 1),
    'weekIndex', 1, 'label', 'Program', 'workouts', coalesce((
      select jsonb_agg(private.workout_content_payload(effective.id) || jsonb_build_object(
        'runWorkoutId', slot.id, 'originalWorkoutId', slot.workout_id,
        'programVersionId', effective_week.program_version_id, 'position', slot.position
      ) order by slot.position, slot.id)
      from public.program_run_workouts slot
      join public.workouts effective on effective.id = coalesce(slot.edited_workout_id, slot.workout_id)
      join public.program_weeks effective_week on effective_week.id = effective.program_week_id
      where slot.program_run_id = target_run.id
    ), '[]'::jsonb)
  )));
end;
$$;

create or replace function public.copy_program_run_to_own(target_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_run public.program_runs%rowtype;
  source_program public.programs%rowtype;
  source_version public.program_versions%rowtype;
  new_program_id uuid;
  new_version_id uuid;
  copy_title text; target_week_id uuid; source_slot record;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select run.* into source_run
  from public.program_runs run
  where run.id = target_run_id
    and private.can_read_program_run(run.id)
  for share;
  if source_run.id is null then raise exception 'Program run was not found'; end if;

  select program.* into source_program
  from public.programs program
  where program.id = source_run.source_program_id;
  select version.* into source_version
  from public.program_versions version
  where version.id = source_run.program_version_id
    and version.program_id = source_run.source_program_id;
  if source_program.id is null or source_version.id is null then
    raise exception 'Program run content was not found';
  end if;

  -- Copy a coherent revision when an upcoming workout is being edited in
  -- another tab. Content writers take SHARE locks on these same versions.
  perform revision.id from public.program_versions revision
  where revision.id in (select week.program_version_id
    from public.program_run_workouts slot
    join public.workouts workout on workout.id = coalesce(slot.edited_workout_id, slot.workout_id)
    join public.program_weeks week on week.id = workout.program_week_id
    where slot.program_run_id = source_run.id)
  order by revision.id for update;
  copy_title := source_version.title;
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

  insert into public.program_weeks(program_version_id, week_index, label)
  values(new_version_id, 1, 'Program') returning id into target_week_id;
  for source_slot in select * from public.program_run_workouts
    where program_run_id = source_run.id order by position, id
  loop
    perform private.clone_single_workout(coalesce(source_slot.edited_workout_id, source_slot.workout_id), target_week_id, source_slot.position);
  end loop;
  update public.programs set title = copy_title where id = new_program_id;
  return new_program_id;
end;
$$;

create or replace function public.schedule_program_run_workouts(
  target_run_id uuid,
  target_workout_dates jsonb,
  target_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_run public.program_runs%rowtype;
  normalized_dates jsonb;
  requested record;
  slot public.program_run_workouts%rowtype;
  next_sequence integer;
  request_receipt public.program_run_schedule_requests%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  select run.* into target_run
  from public.program_runs run
  where run.id = target_run_id
    and (
      run.athlete_id = current_user_id
      or (
        run.created_by_id = current_user_id
        and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = run.athlete_id
            and relationship.coach_id = current_user_id
            and relationship.ended_at is null
        )
      )
    )
  for update;
  if not found then raise exception 'Active program run was not found'; end if;
  normalized_dates := private.canonical_program_run_dates(
    target_run.program_version_id, target_workout_dates
  );
  perform private.validate_program_run_date_order(
    target_run.id, normalized_dates
  );

  insert into public.program_run_schedule_requests (
    requested_by_id, request_key, program_run_id, canonical_schedule
  ) values (
    current_user_id, target_idempotency_key, target_run.id, normalized_dates
  )
  on conflict (requested_by_id, request_key) do nothing
  returning * into request_receipt;

  if not found then
    select receipt.* into request_receipt
    from public.program_run_schedule_requests receipt
    where receipt.requested_by_id = current_user_id
      and receipt.request_key = target_idempotency_key;
    if request_receipt.program_run_id is distinct from target_run.id
      or request_receipt.canonical_schedule is distinct from normalized_dates then
      raise exception 'Idempotency key was already used for another schedule change';
    end if;
    return jsonb_build_object('runId', target_run.id);
  end if;

  if target_run.status in ('completed', 'ended') then
    raise exception 'Active program run was not found';
  end if;

  perform profile.id from public.profiles profile
  where profile.id = target_run.athlete_id for update;
  select coalesce(max(occurrence.sequence_number), 0)
  into next_sequence
  from public.scheduled_workouts occurrence
  where occurrence.athlete_id = target_run.athlete_id
    and occurrence.program_version_id = target_run.program_version_id;

  perform pg_catalog.set_config('liftlog.program_run_bulk_sync', 'on', true);
  for requested in
    select
      (entry ->> 'workoutId')::uuid as workout_id,
      nullif(entry ->> 'plannedDate', '')::date as planned_date
    from jsonb_array_elements(normalized_dates) entry
  loop
    select candidate.* into slot
    from public.program_run_workouts candidate
    where candidate.program_run_id = target_run.id
      and candidate.workout_id = requested.workout_id
      and candidate.status in ('unscheduled', 'scheduled')
    order by candidate.position
    limit 1
    for update;
    if not found then raise exception 'Only future run workouts can be rescheduled'; end if;

    if slot.scheduled_workout_id is null and requested.planned_date is not null then
      next_sequence := next_sequence + 1;
      insert into public.scheduled_workouts (
        athlete_id, scheduled_by_id, assignment_id, program_version_id,
        workout_id, planned_date, sequence_number, status, request_key,
        program_run_id, program_run_workout_id
      ) values (
        target_run.athlete_id, current_user_id, target_run.legacy_assignment_id,
        coalesce((select week.program_version_id from public.workouts edited
          join public.program_weeks week on week.id = edited.program_week_id
          where edited.id = slot.edited_workout_id), target_run.program_version_id),
        coalesce(slot.edited_workout_id, slot.workout_id), requested.planned_date,
        next_sequence, 'planned', gen_random_uuid(), target_run.id, slot.id
      );
    elsif slot.scheduled_workout_id is not null then
      update public.scheduled_workouts
      set planned_date = requested.planned_date
      where id = slot.scheduled_workout_id and status = 'planned';
      if not found then raise exception 'Only future run workouts can be rescheduled'; end if;
    end if;
  end loop;
  perform pg_catalog.set_config('liftlog.program_run_bulk_sync', 'off', true);
  perform private.refresh_program_run_status(target_run.id);
  return jsonb_build_object('runId', target_run.id);
end;
$$;

create or replace function public.repeat_program_run(
  target_run_id uuid,
  target_workout_dates jsonb,
  target_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  previous public.program_runs%rowtype;
  materialized_run record; previous_slot record; new_slot_id uuid; edit_payload jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  select run.* into previous
  from public.program_runs run
  where run.id = target_run_id
    and run.status in ('completed', 'ended')
    and (
      run.athlete_id = current_user_id
      or (
        run.created_by_id = current_user_id
        and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = run.athlete_id
            and relationship.coach_id = current_user_id
            and relationship.ended_at is null
        )
      )
    )
  for share;
  if not found then raise exception 'Program run was not found'; end if;

  select result.run_id, result.created into materialized_run
  from private.materialize_program_run(
    previous.source_program_id, previous.program_version_id,
    previous.athlete_id, current_user_id, target_workout_dates,
    target_idempotency_key, previous.id
  ) result;
  if materialized_run.created then
    for previous_slot in select * from public.program_run_workouts
      where program_run_id = previous.id and edited_workout_id is not null order by position
    loop
      select id into new_slot_id from public.program_run_workouts
      where program_run_id = materialized_run.run_id and position = previous_slot.position;
      edit_payload := public.prepare_program_run_workout_edit(new_slot_id);
      perform private.replace_draft_workout_contents(previous_slot.edited_workout_id, (edit_payload ->> 'workoutId')::uuid);
    end loop;
  end if;
  return jsonb_build_object(
    'athleteId', previous.athlete_id,
    'runId', materialized_run.run_id,
    'programId', previous.source_program_id,
    'programVersionId', previous.program_version_id,
    'created', materialized_run.created
  );
end;
$$;

drop function public.list_program_summaries(integer, timestamptz, uuid);
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
  week_count bigint, workout_count bigint, has_own_runs boolean
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
          when candidate.status = 'draft' then 0
          when candidate.status = 'published' then 1
          else 2
        end,
        candidate.version_number desc,
        candidate.id
      limit 1
    ) version on true
    where program.athlete_id = current_user_id
      and program.created_by_id = current_user_id
      and program.source_type = 'self'
      and program.archived_at is null
      and not exists (
        select 1 from public.program_assignments assignment
        where assignment.customized_program_id = program.id
      )
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
    content_count.week_count, content_count.workout_count,
    exists(select 1 from public.program_runs own_run where own_run.source_program_id = page.program_id
      and own_run.athlete_id = current_user_id and own_run.created_by_id = current_user_id)
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
revoke all on function public.list_program_summaries(integer, timestamptz, uuid) from public, anon;
grant execute on function public.list_program_summaries(integer, timestamptz, uuid) to authenticated;

create or replace function public.reset_test_population(
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

  select array_agg(profile.id) into test_ids
  from public.profiles profile
  where profile.account_kind = 'test'
    and profile.test_persona_key like expected_namespace || ':%';

  if test_ids is not null and exists (
    select 1 from public.program_assignments assignment
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
  if test_ids is not null and exists (
    select 1 from public.program_runs run
    where (
      run.athlete_id = any(test_ids)
      and not (run.created_by_id = any(test_ids))
    ) or (
      run.created_by_id = any(test_ids)
      and not (run.athlete_id = any(test_ids))
    )
  ) then
    raise exception 'Fixture program runs cross namespace boundaries; reset aborted';
  end if;

  if test_ids is not null then
    perform pg_catalog.set_config('liftlog.test_reset', 'on', true);
    delete from private.run_assignment_requests receipt
    where receipt.requested_by_id = any(test_ids);
    update public.programs set run_workout_id = null
    where athlete_id = any(test_ids) and run_workout_id is not null;
    update public.program_run_workouts slot set edited_workout_id = null
    from public.program_runs run where run.id = slot.program_run_id
      and run.athlete_id = any(test_ids);
    delete from public.workout_sessions session
    where session.athlete_id = any(test_ids);

    -- Break the reverse pointer first; scheduled rows themselves still retain
    -- their run/slot identity until they are deleted on the next statement.
    update public.program_run_workouts slot
    set scheduled_workout_id = null
    from public.program_runs run
    where run.id = slot.program_run_id
      and (run.athlete_id = any(test_ids) or run.created_by_id = any(test_ids));

    delete from public.scheduled_workouts occurrence
    where occurrence.athlete_id = any(test_ids);
    delete from public.program_run_workouts slot
    using public.program_runs run
    where run.id = slot.program_run_id
      and (run.athlete_id = any(test_ids) or run.created_by_id = any(test_ids));
    delete from public.program_runs run
    where run.athlete_id = any(test_ids) or run.created_by_id = any(test_ids);
    delete from public.program_assignments assignment
    where assignment.athlete_id = any(test_ids)
       or assignment.assigned_by_id = any(test_ids);
  end if;

  select public.reset_test_population_pre_v1(
    expected_namespace, expected_persona_keys
  ) into result;
  return result;
end;
$$;

create or replace function public.schedule_workout(
  target_scheduled_workout_id uuid,
  target_planned_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  occurrence public.scheduled_workouts%rowtype;
  updated_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  -- Read immutable lineage first; the shared run writer takes the run lock
  -- before the occurrence lock and rechecks that the occurrence is still future.
  select candidate.* into occurrence
  from public.scheduled_workouts candidate
  where candidate.id = target_scheduled_workout_id
    and candidate.athlete_id = current_user_id and candidate.status = 'planned';
  if not found then raise exception 'This workout cannot be scheduled'; end if;

  if occurrence.program_run_id is not null then
    perform run.id from public.program_runs run
    where run.id = occurrence.program_run_id for update;
    perform candidate.id from public.scheduled_workouts candidate
    where candidate.id = occurrence.id and candidate.status = 'planned'
    for update;
    if not found then raise exception 'This workout cannot be scheduled'; end if;
    perform public.schedule_program_run_workouts(
      occurrence.program_run_id,
      jsonb_build_array(jsonb_build_object(
        'workoutId', (select slot.workout_id from public.program_run_workouts slot
          where slot.id = occurrence.program_run_workout_id), 'plannedDate', target_planned_date
      )), gen_random_uuid()
    );
    updated_id := occurrence.id;
  else
    update public.scheduled_workouts set planned_date = target_planned_date
    where id = occurrence.id and athlete_id = current_user_id and status = 'planned'
    returning id into updated_id;
    if updated_id is null then raise exception 'This workout cannot be scheduled'; end if;
  end if;

  if target_planned_date is null and occurrence.program_run_id is not null and exists (
    select 1 from public.program_runs run
    where run.id = occurrence.program_run_id
      and run.athlete_id = current_user_id and run.created_by_id = current_user_id
      and run.status = 'not_started'
      and (select count(*) from public.program_run_workouts slot
           where slot.program_run_id = run.id) = 1
      and not exists (select 1 from public.workout_sessions session where session.program_run_id = run.id)
  ) then
    update public.program_run_workouts set status = 'cancelled'
    where program_run_id = occurrence.program_run_id and status = 'unscheduled';
    update public.program_runs
    set status = 'ended', ended_at = now(), ended_by_id = current_user_id, completed_at = null
    where id = occurrence.program_run_id and status = 'not_started';
  end if;
  return updated_id;
end;
$$;

-- Assignment reads the exact selected run, including independently edited
-- workouts. The working copy is archived only after its immutable assignments
-- exist. A receipt makes network retries return the original assignments.
create table private.run_assignment_requests (
  requested_by_id uuid not null references public.profiles(id) on delete cascade,
  request_key uuid not null,
  source_run_id uuid not null references public.program_runs(id) on delete restrict,
  athlete_ids uuid[] not null,
  workout_dates jsonb not null,
  response jsonb not null,
  primary key(requested_by_id, request_key)
);

create or replace function public.assign_program_run(
  target_run_id uuid, target_athlete_ids uuid[],
  target_workout_dates jsonb, target_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := (select auth.uid()); normalized_athletes uuid[];
  receipt private.run_assignment_requests%rowtype; copied_program_id uuid;
  copied_version_id uuid; mapped_dates jsonb; result_payload jsonb;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  if target_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  if not private.can_read_program_run(target_run_id) then raise exception 'Program was not found'; end if;
  select array_agg(distinct id order by id) into normalized_athletes from unnest(target_athlete_ids) id;
  if coalesce(cardinality(normalized_athletes), 0) not between 1 and 50
    or array_position(normalized_athletes, null) is not null then
    raise exception 'Choose between 1 and 50 athletes';
  end if;
  if target_workout_dates is null or jsonb_typeof(target_workout_dates) <> 'array'
    or pg_column_size(target_workout_dates) > 65536 then
    raise exception 'Workout dates must be a bounded array';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(viewer::text || target_idempotency_key::text, 0));
  select * into receipt from private.run_assignment_requests
  where requested_by_id = viewer and request_key = target_idempotency_key;
  if found then
    if receipt.source_run_id is distinct from target_run_id
      or receipt.athlete_ids is distinct from normalized_athletes
      or receipt.workout_dates is distinct from target_workout_dates then
      raise exception 'Idempotency key was already used for another assignment';
    end if;
    return receipt.response;
  end if;
  if exists (select 1 from unnest(normalized_athletes) athlete(id)
    where athlete.id <> viewer and not exists (
      select 1 from public.coach_relationships relationship
      where relationship.athlete_id = athlete.id and relationship.coach_id = viewer
        and relationship.ended_at is null
    )) then raise exception 'Programs can only be assigned to athletes you currently coach'; end if;
  if exists (select 1 from jsonb_array_elements(target_workout_dates) entry
    where jsonb_typeof(entry) <> 'object' or not exists (
      select 1 from public.program_run_workouts slot
      where slot.program_run_id = target_run_id
        and (entry ->> 'workoutId')::uuid in (slot.workout_id, slot.edited_workout_id)
    )) then raise exception 'Workout dates must refer to this program'; end if;
  copied_program_id := public.copy_program_run_to_own(target_run_id);
  select id into copied_version_id from public.program_versions
  where program_id = copied_program_id and status = 'draft';
  select coalesce(jsonb_agg(jsonb_build_object('workoutId', copied.id,
    'plannedDate', entry -> 'plannedDate') order by slot.position), '[]'::jsonb)
  into mapped_dates
  from jsonb_array_elements(target_workout_dates) entry
  join public.program_run_workouts slot on slot.program_run_id = target_run_id
    and (entry ->> 'workoutId')::uuid in (slot.workout_id, slot.edited_workout_id)
  join public.program_weeks week on week.program_version_id = copied_version_id
  join public.workouts copied on copied.program_week_id = week.id and copied.position = slot.position;
  select jsonb_agg(jsonb_build_object('athleteId', created.athlete_id,
    'runId', created.run_id, 'programId', created.program_id,
    'programVersionId', created.program_version_id, 'created', created.created))
  into result_payload from public.create_program_runs(copied_program_id,
    normalized_athletes, mapped_dates, target_idempotency_key) created;
  perform public.delete_own_program(copied_program_id);
  insert into private.run_assignment_requests(requested_by_id, request_key,
    source_run_id, athlete_ids, workout_dates, response)
  values(viewer, target_idempotency_key, target_run_id, normalized_athletes,
    target_workout_dates, result_payload);
  return result_payload;
end;
$$;
revoke all on table private.run_assignment_requests from public, anon, authenticated;
revoke all on function public.assign_program_run(uuid, uuid[], jsonb, uuid) from public, anon;
grant execute on function public.assign_program_run(uuid, uuid[], jsonb, uuid) to authenticated;

create or replace function public.copy_completed_workout_to_own(target_session_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare source_session public.workout_sessions%rowtype; viewer uuid := (select auth.uid());
  new_program_id uuid; new_version_id uuid; new_week_id uuid;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  select * into source_session from public.workout_sessions
  where id = target_session_id and athlete_id = viewer and status = 'completed';
  if not found or source_session.workout_id is null then
    raise exception 'Completed workout was not found';
  end if;
  insert into public.programs(athlete_id, created_by_id, title, description,
    planning_mode, is_current, source_type, source_label, content_type)
  values(viewer, viewer, source_session.workout_title, '', 'fixed_weeks', true,
    'self', 'Repeated workout', 'quick_workout') returning id into new_program_id;
  insert into public.program_versions(program_id, authored_by_id, version_number, status)
  values(new_program_id, viewer, 1, 'draft') returning id into new_version_id;
  insert into public.program_weeks(program_version_id, week_index, label)
  values(new_version_id, 1, 'Workout') returning id into new_week_id;
  perform private.clone_single_workout(source_session.workout_id, new_week_id, 0);
  return new_program_id;
end;
$$;
revoke all on function public.copy_completed_workout_to_own(uuid) from public, anon;
grant execute on function public.copy_completed_workout_to_own(uuid) to authenticated;

-- A private draft's container title is not a second program. Calendar, Today
-- and coaching retain the assigned program's immutable display name.
create or replace function private.run_display_title(target_run_id uuid, fallback_title text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select version.title from public.program_runs run
    join public.program_versions version on version.id = run.program_version_id
    where run.id = target_run_id), fallback_title);
$$;
revoke all on function private.run_display_title(uuid, text) from public, anon, authenticated;
do $$
declare signature text; definition text; replacement text;
begin
  foreach signature in array array[
    'public.get_scheduled_workout_detail(uuid)',
    'public.get_workspace_bootstrap()',
    'public.get_coach_athlete_detail(uuid,integer,integer,integer)'
  ] loop
    select pg_catalog.pg_get_functiondef(signature::regprocedure) into definition;
    if signature like '%get_coach_athlete_detail%' then
      replacement := replace(definition,
        '''programVersionId'', occurrence.program_version_id,' || chr(10) || '        ''programTitle'', version.title,',
        '''programVersionId'', occurrence.program_version_id,' || chr(10) || '        ''programTitle'', private.run_display_title(occurrence.program_run_id, version.title),');
      replacement := replace(replacement,
        '''programVersionId'', session.program_version_id,' || chr(10) || '        ''programTitle'', version.title,',
        '''programVersionId'', session.program_version_id,' || chr(10) || '        ''programTitle'', private.run_display_title(session.program_run_id, version.title),');
    else
      replacement := replace(definition, '''programTitle'', version.title',
        '''programTitle'', private.run_display_title(occurrence.program_run_id, version.title)');
    end if;
    if replacement = definition then raise exception 'Scheduled display title contract changed: %', signature; end if;
    execute replacement;
  end loop;
  foreach signature in array array[
    'public.list_calendar_occurrences(date,date,integer,date,uuid)',
    'public.list_upcoming_scheduled_workouts(integer,date,uuid)'
  ] loop
    select pg_catalog.pg_get_functiondef(signature::regprocedure) into definition;
    replacement := replace(definition, 'occurrence.program_version_id, version.title, occurrence.workout_id',
      'occurrence.program_version_id, private.run_display_title(occurrence.program_run_id, version.title), occurrence.workout_id');
    if replacement = definition then raise exception 'Scheduled display title contract changed: %', signature; end if;
    execute replacement;
  end loop;
end;
$$;

commit;
