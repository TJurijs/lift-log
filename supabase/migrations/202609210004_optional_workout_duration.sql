-- Workout estimates are optional. Preserve existing explicit estimates and copy
-- semantics; only new workouts without an estimate should store NULL.
-- Keep authoring locks, authorization and the complete child insert atomic.

create or replace function public.append_program_workout(
  target_week_id uuid,
  target_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  target_content_type text;
  next_position integer;
  workout_count integer;
  new_workout_id uuid;
begin
  select week.program_version_id, program.content_type
  into target_version_id, target_content_type
  from public.program_weeks week
  join public.program_versions version on version.id = week.program_version_id
  join public.programs program on program.id = version.program_id
  where week.id = target_week_id
  for update of week
  for share of version;
  if not public.can_edit_version(target_version_id) then
    raise exception 'Program version is not editable';
  end if;
  if trim(coalesce(target_title, '')) = '' then
    raise exception 'Workout name is required';
  end if;

  select coalesce(max(workout.position), -1) + 1, count(*)
  into next_position, workout_count
  from public.workouts workout
  where workout.program_week_id = target_week_id;
  if workout_count >= 200 then
    raise exception 'A program can contain at most 200 workouts';
  end if;
  if target_content_type = 'quick_workout' and workout_count > 0 then
    raise exception 'A single workout can contain only one workout';
  end if;

  insert into public.workouts (
    program_week_id, title, day_of_week, schedule_label, position, estimated_minutes
  ) values (
    target_week_id, trim(target_title), null,
    'Workout ' || (next_position + 1), next_position, null
  ) returning id into new_workout_id;

  insert into public.workout_sections (workout_id, title, section_kind, position)
  values (new_workout_id, 'Exercises', 'main', 0);

  return private.workout_content_payload(new_workout_id);
end;
$$;

create or replace function public.create_blank_quick_workout(target_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  workout_program_id uuid;
  version_id uuid;
  phase_id uuid;
  week_id uuid;
  workout_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(target_title, ''))) not between 1 and 120 then
    raise exception 'Workout name must be between 1 and 120 characters';
  end if;
  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label, content_type
  ) values (
    current_user_id, current_user_id, trim(target_title), '', 'fixed_weeks',
    true, 'self', 'Created by you', 'quick_workout'
  ) returning id into workout_program_id;
  insert into public.program_versions (program_id, authored_by_id, version_number, status)
  values (workout_program_id, current_user_id, 1, 'draft') returning id into version_id;
  insert into public.program_phases (program_version_id, name, position)
  values (version_id, 'Workout', 0) returning id into phase_id;
  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (version_id, phase_id, 1, 'Workout') returning id into week_id;
  insert into public.workouts (
    program_week_id, title, schedule_label, position, estimated_minutes
  ) values (week_id, trim(target_title), 'Workout 1', 0, null)
  returning id into workout_id;
  insert into public.workout_sections (workout_id, title, section_kind, position)
  values (workout_id, 'Exercises', 'main', 0);
  return workout_program_id;
end;
$$;

-- The legacy import endpoint also preserves a missing estimate when invoked.
create or replace function private.populate_program_from_template(
  target_version_id uuid,
  target_template_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.program_templates%rowtype;
  phase_id uuid;
  week_id uuid;
  workout_id uuid;
  section_id uuid;
  item_id uuid;
  exercise_id uuid;
  workout_position integer := 0;
  item_position integer;
  workout_entry record;
  section_entry record;
  item_entry record;
begin
  select * into template_row
  from public.program_templates template
  where template.id = target_template_id and template.is_active;
  if template_row.id is null then raise exception 'Program template is unavailable'; end if;

  insert into public.program_phases (program_version_id, name, position)
  values (target_version_id, 'Foundation', 0) returning id into phase_id;
  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (target_version_id, phase_id, 1, 'Program') returning id into week_id;

  for cycle_number in 1..greatest(coalesce(template_row.week_count, 1), 1) loop
    for workout_entry in
      select value as item, ordinality::integer - 1 as position
      from jsonb_array_elements(coalesce(template_row.workouts, '[]'::jsonb))
        with ordinality
    loop
      insert into public.workouts (
        program_week_id, title, day_of_week, schedule_label, position, estimated_minutes
      ) values (
        week_id, workout_entry.item ->> 'title', null,
        'Workout ' || (workout_position + 1), workout_position,
        (workout_entry.item ->> 'minutes')::integer
      ) returning id into workout_id;
      workout_position := workout_position + 1;
      item_position := 0;
      insert into public.workout_sections (workout_id, title, section_kind, position)
      values (workout_id, 'Exercises', 'main', 0) returning id into section_id;

      for section_entry in
        select value as item, ordinality::integer - 1 as position
        from jsonb_array_elements(coalesce(workout_entry.item -> 'sections', '[]'::jsonb))
          with ordinality
      loop
        for item_entry in
          select value as item, ordinality::integer - 1 as position
          from jsonb_array_elements(coalesce(section_entry.item -> 'items', '[]'::jsonb))
            with ordinality
        loop
          exercise_id := null;
          if item_entry.item ? 'exercise' then
            select exercise.id into exercise_id
            from public.exercises exercise
            where exercise.scope = 'global'
              and exercise.name = item_entry.item ->> 'exercise'
              and exercise.archived_at is null
            order by exercise.created_at, exercise.id limit 1;
          end if;
          insert into public.workout_items (
            section_id, source_exercise_id, snapshot_name, snapshot_cue,
            entry_mode, tracking_fields, position
          ) values (
            section_id, exercise_id, item_entry.item ->> 'title',
            coalesce(item_entry.item ->> 'cue', ''), item_entry.item ->> 'mode',
            coalesce(array(select jsonb_array_elements_text(item_entry.item -> 'fields')), array[]::text[]),
            item_position
          ) returning id into item_id;
          item_position := item_position + 1;

          if item_entry.item ->> 'mode' = 'sets' then
            for set_position in 0..greatest(
              coalesce((item_entry.item ->> 'sets')::integer, 1) - 1, 0
            ) loop
              insert into public.prescribed_entries (
                workout_item_id, position, reps_min, reps_max,
                target_rpe_min, target_rpe_max
              ) values (
                item_id, set_position, (item_entry.item ->> 'reps')::numeric,
                (item_entry.item ->> 'reps')::numeric,
                (item_entry.item ->> 'rpe')::numeric,
                (item_entry.item ->> 'rpe')::numeric
              );
            end loop;
          elsif item_entry.item ->> 'mode' <> 'none' then
            insert into public.prescribed_entries (
              workout_item_id, position, duration_seconds, distance_metres,
              rounds, work_seconds, rest_seconds, target_rpe_min, target_rpe_max
            ) values (
              item_id, 0, (item_entry.item ->> 'durationSeconds')::integer,
              (item_entry.item ->> 'distanceMetres')::numeric,
              (item_entry.item ->> 'rounds')::integer,
              (item_entry.item ->> 'workSeconds')::integer,
              (item_entry.item ->> 'restSeconds')::integer,
              (item_entry.item ->> 'rpe')::numeric,
              (item_entry.item ->> 'rpe')::numeric
            );
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
end;
$$;

revoke all on function public.append_program_workout(uuid, text) from public, anon;
grant execute on function public.append_program_workout(uuid, text) to authenticated;
revoke all on function public.create_blank_quick_workout(text) from public, anon;
grant execute on function public.create_blank_quick_workout(text) to authenticated;
revoke all on function private.populate_program_from_template(uuid, uuid) from public, anon, authenticated;
