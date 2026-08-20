-- Operational MVP transactions, starter content, and stricter authorization.

alter table public.programs
  add column is_current boolean not null default true;

create unique index idx_programs_one_current
  on public.programs (athlete_id)
  where is_current and archived_at is null;

alter table public.workouts
  add column schedule_label text not null default 'Flexible';

alter table public.exercises
  add constraint exercises_tracking_fields_allowed check (
    default_tracking_fields <@ array['reps', 'load', 'duration', 'distance', 'rounds', 'heartRate', 'rpe']::text[]
  );

alter table public.workout_items
  add constraint workout_items_tracking_fields_allowed check (
    tracking_fields <@ array['reps', 'load', 'duration', 'distance', 'rounds', 'heartRate', 'rpe']::text[]
  );

alter table public.session_item_logs
  add constraint session_item_logs_tracking_fields_allowed check (
    tracking_fields <@ array['reps', 'load', 'duration', 'distance', 'rounds', 'heartRate', 'rpe']::text[]
  );

alter table public.workout_sessions
  drop constraint workout_sessions_completion_check;

alter table public.workout_sessions
  add constraint workout_sessions_completion_check check (
    (status = 'completed' and completed_at is not null) or
    (status <> 'completed' and completed_at is null)
  );

insert into public.exercises (
  id, scope, owner_id, name, category, cue, default_entry_mode, default_tracking_fields
) values
  ('00000000-0000-4000-8000-000000000001', 'global', null, 'Back squat', 'Strength', 'Brace, sit between the hips, drive evenly.', 'sets', array['reps', 'load', 'rpe']),
  ('00000000-0000-4000-8000-000000000002', 'global', null, 'Bench press', 'Strength', 'Set the upper back and keep the feet planted.', 'sets', array['reps', 'load', 'rpe']),
  ('00000000-0000-4000-8000-000000000003', 'global', null, 'Romanian deadlift', 'Strength', 'Push the hips back and keep the bar close.', 'sets', array['reps', 'load', 'rpe']),
  ('00000000-0000-4000-8000-000000000004', 'global', null, 'Push-up', 'Bodyweight', 'Move as one line and finish with long arms.', 'sets', array['reps', 'rpe']),
  ('00000000-0000-4000-8000-000000000005', 'global', null, 'Pull-up', 'Bodyweight', 'Start long, pull the chest toward the bar.', 'sets', array['reps', 'rpe']),
  ('00000000-0000-4000-8000-000000000006', 'global', null, 'Zone 2 bike', 'Cardio', 'Keep a sustainable conversational pace.', 'result', array['duration', 'distance', 'rpe']),
  ('00000000-0000-4000-8000-000000000007', 'global', null, 'Easy run', 'Cardio', 'Relaxed pace; finish feeling like you could continue.', 'result', array['duration', 'distance', 'rpe']),
  ('00000000-0000-4000-8000-000000000008', 'global', null, 'Rowing intervals', 'Conditioning', 'Use a repeatable effort across every interval.', 'intervals', array['rounds', 'duration', 'distance', 'rpe']),
  ('00000000-0000-4000-8000-000000000009', 'global', null, 'Plank', 'Core', 'Ribs down, glutes tight, breathe behind the brace.', 'result', array['duration', 'rpe']),
  ('00000000-0000-4000-8000-000000000010', 'global', null, 'Full-body mobility flow', 'Mobility', 'Move slowly through a comfortable range.', 'none', array[]::text[]),
  ('00000000-0000-4000-8000-000000000011', 'global', null, 'Snatch', 'Weightlifting', 'Stay balanced through the pull and receive actively.', 'sets', array['reps', 'load', 'rpe']),
  ('00000000-0000-4000-8000-000000000012', 'global', null, 'Clean & jerk', 'Weightlifting', 'Finish the pull, meet the bar, then drive vertically.', 'sets', array['reps', 'load', 'rpe'])
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  cue = excluded.cue,
  default_entry_mode = excluded.default_entry_mode,
  default_tracking_fields = excluded.default_tracking_fields,
  archived_at = null;

drop policy exercises_read_available on public.exercises;
create policy exercises_read_available on public.exercises for select to authenticated
using (archived_at is null and (scope = 'global' or owner_id = (select auth.uid())));

drop policy programs_read_authorized on public.programs;
create policy programs_read_authorized on public.programs for select to authenticated
using (archived_at is null and (athlete_id = (select auth.uid()) or public.is_active_coach(athlete_id)));

drop policy coach_feedback_delete_author on public.coach_feedback;
create policy coach_feedback_delete_author on public.coach_feedback for delete to authenticated
using (coach_id = (select auth.uid()) and public.is_active_coach(athlete_id));

revoke usage on schema private from authenticated;
revoke execute on all functions in schema private from public, authenticated;

create or replace function public.protect_published_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.program_id <> old.program_id or new.authored_by_id <> old.authored_by_id or new.version_number <> old.version_number then
    raise exception 'Program version identity cannot be changed';
  end if;

  if old.status = 'superseded' then
    raise exception 'Superseded program versions are immutable';
  end if;

  if old.status = 'published' then
    if new.status <> 'superseded'
      or new.effective_from is distinct from old.effective_from
      or new.published_at is distinct from old.published_at
      or new.based_on_version_id is distinct from old.based_on_version_id then
      raise exception 'Published program versions are immutable except when superseded';
    end if;
    return new;
  end if;

  if new.status in ('published', 'superseded') and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

create or replace function private.add_program_item(
  target_section_id uuid,
  source_exercise_name text,
  item_name text,
  item_cue text,
  item_mode text,
  item_fields text[],
  item_position integer,
  set_count integer,
  reps_low numeric,
  reps_high numeric,
  duration_value integer,
  distance_value numeric,
  target_rpe_low numeric,
  target_rpe_high numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  exercise_id uuid;
  item_id uuid;
begin
  if source_exercise_name is not null then
    select exercise.id into exercise_id
    from public.exercises exercise
    where exercise.scope = 'global' and exercise.name = source_exercise_name and exercise.archived_at is null
    order by exercise.created_at
    limit 1;
  end if;

  insert into public.workout_items (
    section_id, source_exercise_id, snapshot_name, snapshot_cue, entry_mode, tracking_fields, position
  ) values (
    target_section_id, exercise_id, item_name, item_cue, item_mode, item_fields, item_position
  ) returning id into item_id;

  if item_mode = 'sets' then
    for entry_position in 0..greatest(set_count - 1, 0) loop
      insert into public.prescribed_entries (
        workout_item_id, position, reps_min, reps_max, target_rpe_min, target_rpe_max
      ) values (
        item_id, entry_position, reps_low, reps_high, target_rpe_low, target_rpe_high
      );
    end loop;
  elsif item_mode <> 'none' then
    insert into public.prescribed_entries (
      workout_item_id, position, duration_seconds, distance_metres, target_rpe_min, target_rpe_max
    ) values (
      item_id, 0, duration_value, distance_value, target_rpe_low, target_rpe_high
    );
  end if;

  return item_id;
end;
$$;

create or replace function private.clone_week_contents(source_week_id uuid, target_week_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_workout record;
  source_section record;
  source_item record;
  target_workout_id uuid;
  target_section_id uuid;
  target_item_id uuid;
begin
  for source_workout in
    select * from public.workouts where program_week_id = source_week_id order by position
  loop
    insert into public.workouts (
      program_week_id, title, day_of_week, schedule_label, position, estimated_minutes
    ) values (
      target_week_id, source_workout.title, source_workout.day_of_week,
      source_workout.schedule_label, source_workout.position, source_workout.estimated_minutes
    ) returning id into target_workout_id;

    for source_section in
      select * from public.workout_sections where workout_id = source_workout.id order by position
    loop
      insert into public.workout_sections (workout_id, title, section_kind, notes, position)
      values (target_workout_id, source_section.title, source_section.section_kind, source_section.notes, source_section.position)
      returning id into target_section_id;

      for source_item in
        select * from public.workout_items where section_id = source_section.id order by position
      loop
        insert into public.workout_items (
          section_id, source_exercise_id, snapshot_name, snapshot_cue, entry_mode, tracking_fields, position
        ) values (
          target_section_id, source_item.source_exercise_id, source_item.snapshot_name,
          source_item.snapshot_cue, source_item.entry_mode, source_item.tracking_fields, source_item.position
        ) returning id into target_item_id;

        insert into public.prescribed_entries (
          workout_item_id, position, reps_min, reps_max, load_kg, duration_seconds,
          distance_metres, rounds, work_seconds, rest_seconds, target_rpe_min,
          target_rpe_max, target_text
        )
        select
          target_item_id, entry.position, entry.reps_min, entry.reps_max, entry.load_kg,
          entry.duration_seconds, entry.distance_metres, entry.rounds, entry.work_seconds,
          entry.rest_seconds, entry.target_rpe_min, entry.target_rpe_max, entry.target_text
        from public.prescribed_entries entry
        where entry.workout_item_id = source_item.id
        order by entry.position;
      end loop;
    end loop;
  end loop;
end;
$$;

create or replace function private.clone_program_version_tree(source_version_id uuid, target_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_phase_row record;
  source_week_row record;
  target_phase_id uuid;
  target_week_id uuid;
begin
  for source_phase_row in
    select * from public.program_phases where program_version_id = source_version_id order by position
  loop
    insert into public.program_phases (program_version_id, name, position)
    values (target_version_id, source_phase_row.name, source_phase_row.position);
  end loop;

  for source_week_row in
    select * from public.program_weeks where program_version_id = source_version_id order by week_index
  loop
    target_phase_id := null;
    if source_week_row.phase_id is not null then
      select target_phase.id into target_phase_id
      from public.program_phases target_phase
      join public.program_phases source_phase_table on source_phase_table.position = target_phase.position
      where target_phase.program_version_id = target_version_id
        and source_phase_table.id = source_week_row.phase_id;
    end if;

    insert into public.program_weeks (program_version_id, phase_id, week_index, label)
    values (target_version_id, target_phase_id, source_week_row.week_index, source_week_row.label)
    returning id into target_week_id;

    perform private.clone_week_contents(source_week_row.id, target_week_id);
  end loop;
end;
$$;

create or replace function public.ensure_starter_program(target_athlete_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  resolved_athlete_id uuid := coalesce(target_athlete_id, (select auth.uid()));
  existing_program_id uuid;
  program_id uuid;
  version_id uuid;
  phase_id uuid;
  week_id uuid;
  workout_id uuid;
  section_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if resolved_athlete_id <> current_user_id and not public.is_active_coach(resolved_athlete_id) then
    raise exception 'Not authorized to create this program';
  end if;

  select program.id into existing_program_id
  from public.programs program
  where program.athlete_id = resolved_athlete_id and program.is_current and program.archived_at is null
  order by program.created_at desc
  limit 1;
  if existing_program_id is not null then return existing_program_id; end if;

  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current
  ) values (
    resolved_athlete_id, current_user_id, 'Foundation',
    'A balanced three-day plan for strength, aerobic fitness, and movement quality.',
    'fixed_weeks', true
  ) returning id into program_id;

  insert into public.program_versions (program_id, authored_by_id, version_number, status)
  values (program_id, current_user_id, 1, 'draft') returning id into version_id;

  insert into public.program_phases (program_version_id, name, position)
  values (version_id, 'Base', 0) returning id into phase_id;

  for week_number in 1..6 loop
    insert into public.program_weeks (program_version_id, phase_id, week_index, label)
    values (
      version_id, phase_id, week_number,
      case when week_number <= 2 then 'Ease in' when week_number <= 5 then 'Build' else 'Consolidate' end
    ) returning id into week_id;

    insert into public.workouts (program_week_id, title, day_of_week, schedule_label, position, estimated_minutes)
    values (week_id, 'Full body', 1, 'Monday', 0, 50) returning id into workout_id;
    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (workout_id, 'Preparation', 'warmup', 0) returning id into section_id;
    perform private.add_program_item(section_id, null, '5 min easy bike', 'Raise temperature gradually.', 'none', array[]::text[], 0, 0, null, null, null, null, null, null);
    perform private.add_program_item(section_id, 'Full-body mobility flow', 'Hip and shoulder mobility flow', 'Move comfortably; nothing needs to be logged.', 'none', array[]::text[], 1, 0, null, null, null, null, null, null);
    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (workout_id, 'Main work', 'main', 1) returning id into section_id;
    perform private.add_program_item(section_id, 'Back squat', 'Back squat', 'Controlled descent · rest 2–3 min', 'sets', array['reps','load','rpe'], 0, 4, 5, 5, null, null, 7, 8);
    perform private.add_program_item(section_id, 'Bench press', 'Bench press', 'Leave two clean reps in reserve.', 'sets', array['reps','load','rpe'], 1, 3, 8, 8, null, null, 7, 7);
    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (workout_id, 'Finish', 'cooldown', 2) returning id into section_id;
    perform private.add_program_item(section_id, null, '5 min relaxed walk', 'Let breathing settle.', 'none', array[]::text[], 0, 0, null, null, null, null, null, null);

    insert into public.workouts (program_week_id, title, day_of_week, schedule_label, position, estimated_minutes)
    values (week_id, 'Strength + engine', 4, 'Thursday', 1, 55) returning id into workout_id;
    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (workout_id, 'Preparation', 'warmup', 0) returning id into section_id;
    perform private.add_program_item(section_id, 'Full-body mobility flow', 'Easy movement preparation', 'Move comfortably and build temperature.', 'none', array[]::text[], 0, 0, null, null, null, null, null, null);
    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (workout_id, 'Strength', 'main', 1) returning id into section_id;
    perform private.add_program_item(section_id, 'Back squat', 'Back squat', 'Controlled descent · rest 2–3 min', 'sets', array['reps','load','rpe'], 0, 4, 5, 5, null, null, 7, 8);
    perform private.add_program_item(section_id, 'Push-up', 'Push-up', 'Stop before form changes.', 'sets', array['reps','rpe'], 1, 3, 10, 15, null, null, 8, 8);
    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (workout_id, 'Conditioning', 'conditioning', 2) returning id into section_id;
    perform private.add_program_item(section_id, 'Zone 2 bike', 'Zone 2 bike', 'Conversational pace.', 'result', array['duration','distance','rpe'], 0, 0, null, null, 1200, null, 5, 6);
    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (workout_id, 'Cooldown', 'cooldown', 3) returning id into section_id;
    perform private.add_program_item(section_id, null, 'Easy stretch and breathing', '2–5 minutes, no tracking required.', 'none', array[]::text[], 0, 0, null, null, null, null, null, null);

    insert into public.workouts (program_week_id, title, day_of_week, schedule_label, position, estimated_minutes)
    values (week_id, 'Cardio + core', 6, 'Saturday', 2, 45) returning id into workout_id;
    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (workout_id, 'Aerobic work', 'conditioning', 0) returning id into section_id;
    perform private.add_program_item(section_id, 'Easy run', 'Easy run', 'Keep the whole effort conversational.', 'result', array['duration','distance','rpe'], 0, 0, null, null, 1800, null, 5, 5);
    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (workout_id, 'Core', 'main', 1) returning id into section_id;
    perform private.add_program_item(section_id, 'Plank', 'Plank', 'Strong position and calm breathing.', 'result', array['duration','rpe'], 0, 0, null, null, 60, null, 7, 7);
  end loop;

  return program_id;
end;
$$;

create or replace function public.create_program_draft(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_draft_id uuid;
  source_version_id uuid;
  new_version_id uuid;
  next_version_number integer;
begin
  if (select auth.uid()) is null or not public.can_edit_program(target_program_id) then
    raise exception 'Not authorized to edit this program';
  end if;

  select version.id into existing_draft_id
  from public.program_versions version
  where version.program_id = target_program_id and version.status = 'draft'
  limit 1;
  if existing_draft_id is not null then return existing_draft_id; end if;

  select version.id, version.version_number + 1
  into source_version_id, next_version_number
  from public.program_versions version
  where version.program_id = target_program_id and version.status in ('published', 'superseded')
  order by version.version_number desc
  limit 1;
  if source_version_id is null then raise exception 'No source version is available'; end if;

  insert into public.program_versions (
    program_id, authored_by_id, based_on_version_id, version_number, status
  ) values (
    target_program_id, (select auth.uid()), source_version_id, next_version_number, 'draft'
  ) returning id into new_version_id;

  perform private.clone_program_version_tree(source_version_id, new_version_id);
  return new_version_id;
end;
$$;

create or replace function public.duplicate_program_week(source_week_id uuid, target_week_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_version_id uuid;
  target_version_id uuid;
begin
  select week.program_version_id into source_version_id from public.program_weeks week where week.id = source_week_id;
  select week.program_version_id into target_version_id from public.program_weeks week where week.id = target_week_id;
  if source_version_id is null or target_version_id is null or source_version_id <> target_version_id then
    raise exception 'Weeks must belong to the same program version';
  end if;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;

  delete from public.workouts workout where workout.program_week_id = target_week_id;
  perform private.clone_week_contents(source_week_id, target_week_id);
  return target_week_id;
end;
$$;

create or replace function public.publish_program_version(target_version_id uuid, effective_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_program_id uuid;
  target_athlete_id uuid;
  scheduled record;
  sequence_value integer := 0;
  planned_value date;
begin
  select version.program_id, program.athlete_id
  into target_program_id, target_athlete_id
  from public.program_versions version
  join public.programs program on program.id = version.program_id
  where version.id = target_version_id and version.status = 'draft'
  for update of version;

  if target_program_id is null then raise exception 'Draft program version not found'; end if;
  if not public.can_edit_program(target_program_id) then raise exception 'Not authorized to publish this program'; end if;
  if effective_on is null then raise exception 'An effective date is required'; end if;
  if not exists (
    select 1 from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_version_id
  ) then raise exception 'A program must contain at least one workout'; end if;

  update public.program_versions
  set status = 'superseded'
  where program_id = target_program_id and status = 'published';

  update public.program_versions
  set status = 'published', effective_from = effective_on
  where id = target_version_id;

  delete from public.scheduled_workouts occurrence
  using public.program_versions version
  where occurrence.program_version_id = version.id
    and version.program_id = target_program_id
    and occurrence.status = 'planned'
    and (occurrence.planned_date is null or occurrence.planned_date >= effective_on);

  for scheduled in
    select week.week_index, workout.id as workout_id, workout.day_of_week
    from public.program_weeks week
    join public.workouts workout on workout.program_week_id = week.id
    where week.program_version_id = target_version_id
    order by week.week_index, workout.position
  loop
    sequence_value := sequence_value + 1;
    planned_value := null;
    if scheduled.day_of_week is not null then
      planned_value := effective_on
        + ((scheduled.week_index - 1) * 7)
        + mod(scheduled.day_of_week - extract(isodow from effective_on)::integer + 7, 7);
    end if;
    insert into public.scheduled_workouts (
      athlete_id, program_version_id, workout_id, planned_date, sequence_number, status
    ) values (
      target_athlete_id, target_version_id, scheduled.workout_id, planned_value, sequence_value, 'planned'
    );
  end loop;

  perform public.create_program_draft(target_program_id);
  return target_version_id;
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
  existing_session_id uuid;
  session_id uuid;
  session_item_id uuid;
  workout_title_value text;
  item record;
  prescribed record;
  item_position integer := 0;
  entry_count integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  if target_scheduled_workout_id is not null then
    if not exists (
      select 1 from public.scheduled_workouts occurrence
      where occurrence.id = target_scheduled_workout_id
        and occurrence.athlete_id = current_user_id
        and occurrence.workout_id = target_workout_id
        and occurrence.program_version_id = target_program_version_id
    ) then raise exception 'Scheduled workout is invalid'; end if;

    select workout_session.id into existing_session_id
    from public.workout_sessions workout_session
    where workout_session.scheduled_workout_id = target_scheduled_workout_id
      and workout_session.status = 'in_progress'
    order by workout_session.started_at desc
    limit 1;
    if existing_session_id is not null then return existing_session_id; end if;
  end if;

  select workout.title into workout_title_value
  from public.workouts workout
  join public.program_weeks week on week.id = workout.program_week_id
  join public.program_versions version on version.id = week.program_version_id
  join public.programs program on program.id = version.program_id
  where workout.id = target_workout_id
    and version.id = target_program_version_id
    and program.athlete_id = current_user_id;
  if workout_title_value is null then raise exception 'Workout is not available to this athlete'; end if;

  insert into public.workout_sessions (
    athlete_id, scheduled_workout_id, program_version_id, workout_id, workout_title, status
  ) values (
    current_user_id, target_scheduled_workout_id, target_program_version_id,
    target_workout_id, workout_title_value, 'in_progress'
  ) returning id into session_id;

  for item in
    select workout_item.*
    from public.workout_sections section
    join public.workout_items workout_item on workout_item.section_id = section.id
    where section.workout_id = target_workout_id
    order by section.position, workout_item.position
  loop
    insert into public.session_item_logs (
      workout_session_id, source_workout_item_id, snapshot_name, snapshot_cue,
      entry_mode, tracking_fields, position
    ) values (
      session_id, item.id, item.snapshot_name, item.snapshot_cue,
      item.entry_mode, item.tracking_fields, item_position
    ) returning id into session_item_id;
    item_position := item_position + 1;
    entry_count := 0;

    for prescribed in
      select * from public.prescribed_entries entry
      where entry.workout_item_id = item.id
      order by entry.position
    loop
      insert into public.session_entries (
        session_item_log_id, position, reps, load_kg, duration_seconds,
        distance_metres, rounds, rpe
      ) values (
        session_item_id, prescribed.position, prescribed.reps_min, prescribed.load_kg,
        prescribed.duration_seconds, prescribed.distance_metres, prescribed.rounds, null
      );
      entry_count := entry_count + 1;
    end loop;

    if entry_count = 0 and item.entry_mode <> 'none' then
      insert into public.session_entries (session_item_log_id, position)
      values (session_item_id, 0);
    end if;
  end loop;

  if target_scheduled_workout_id is not null then
    update public.scheduled_workouts set status = 'in_progress'
    where id = target_scheduled_workout_id;
  end if;
  return session_id;
end;
$$;

create or replace function public.complete_workout_session(
  target_session_id uuid,
  final_rpe numeric,
  final_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  scheduled_id uuid;
begin
  if final_rpe is not null and (final_rpe < 1 or final_rpe > 10) then
    raise exception 'Session RPE must be between 1 and 10';
  end if;

  select session.scheduled_workout_id into scheduled_id
  from public.workout_sessions session
  where session.id = target_session_id
    and session.athlete_id = (select auth.uid())
    and session.status = 'in_progress'
  for update;
  if not found then raise exception 'In-progress session not found'; end if;

  update public.workout_sessions
  set status = 'completed', completed_at = now(), session_rpe = final_rpe,
      athlete_note = coalesce(final_note, '')
  where id = target_session_id;

  if scheduled_id is not null then
    update public.scheduled_workouts set status = 'completed' where id = scheduled_id;
  end if;
  return target_session_id;
end;
$$;

create or replace function public.create_coach_invite(target_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_email text := lower(trim(target_email));
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
  invitation_id uuid;
  expiration timestamptz := now() + interval '7 days';
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if normalized_email = '' or position('@' in normalized_email) < 2 then raise exception 'A valid email is required'; end if;
  if exists (
    select 1 from public.coach_relationships relationship
    where relationship.athlete_id = current_user_id and relationship.ended_at is null
  ) then raise exception 'End the current coaching relationship before inviting another coach'; end if;

  update public.coach_invites
  set status = 'revoked'
  where athlete_id = current_user_id and status = 'pending';

  insert into public.coach_invites (
    athlete_id, invited_email, token_hash, status, expires_at
  ) values (
    current_user_id, normalized_email,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'), 'pending', expiration
  ) returning id into invitation_id;

  return jsonb_build_object('id', invitation_id, 'token', raw_token, 'expiresAt', expiration);
end;
$$;

revoke all on function private.add_program_item(uuid, text, text, text, text, text[], integer, integer, numeric, numeric, integer, numeric, numeric, numeric) from public, authenticated;
revoke all on function private.clone_week_contents(uuid, uuid) from public, authenticated;
revoke all on function private.clone_program_version_tree(uuid, uuid) from public, authenticated;

revoke all on function public.ensure_starter_program(uuid) from public;
revoke all on function public.create_program_draft(uuid) from public;
revoke all on function public.duplicate_program_week(uuid, uuid) from public;
revoke all on function public.start_or_resume_workout(uuid, uuid, uuid) from public;
revoke all on function public.complete_workout_session(uuid, numeric, text) from public;
revoke all on function public.create_coach_invite(text) from public;

grant execute on function public.ensure_starter_program(uuid) to authenticated;
grant execute on function public.create_program_draft(uuid) to authenticated;
grant execute on function public.duplicate_program_week(uuid, uuid) to authenticated;
grant execute on function public.start_or_resume_workout(uuid, uuid, uuid) to authenticated;
grant execute on function public.complete_workout_session(uuid, numeric, text) to authenticated;
grant execute on function public.create_coach_invite(text) to authenticated;

-- Supabase secret/service-role clients are reserved for trusted maintenance and tests.
-- Database triggers still protect immutable published plans and completed history.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

select pg_catalog.set_config('search_path', 'public', false);
