-- Workouts are one ordered exercise sequence. The remaining section row is an
-- internal ownership/RLS container, not a user-facing grouping concept.

alter table public.workout_sections disable trigger guard_workout_sections_draft;
alter table public.workout_items disable trigger guard_workout_items_draft;

-- Repair historical workouts without a section, then choose one stable
-- persistence container per workout. Existing item ids are retained so all
-- prescriptions and completed-history references remain intact.
insert into public.workout_sections (workout_id, title, section_kind, position)
select workout.id, 'Exercises', 'main', 0
from public.workouts workout
where not exists (
  select 1 from public.workout_sections section
  where section.workout_id = workout.id
);

create temporary table canonical_workout_section on commit drop as
select distinct on (section.workout_id)
  section.workout_id,
  section.id as section_id
from public.workout_sections section
order by section.workout_id, section.position, section.id;

create temporary table flattened_workout_items on commit drop as
select
  item.id as item_id,
  canonical.section_id,
  row_number() over (
    partition by section.workout_id
    order by section.position, item.position, item.id
  )::integer - 1 as position
from public.workout_items item
join public.workout_sections section on section.id = item.section_id
join canonical_workout_section canonical
  on canonical.workout_id = section.workout_id;

alter table public.workout_items
  drop constraint if exists workout_items_position_unique;

update public.workout_items item
set
  section_id = flattened.section_id,
  position = flattened.position
from flattened_workout_items flattened
where flattened.item_id = item.id;

delete from public.workout_sections section
using canonical_workout_section canonical
where section.workout_id = canonical.workout_id
  and section.id <> canonical.section_id;

update public.workout_sections section
set title = 'Exercises', section_kind = 'main', notes = '', position = 0
from canonical_workout_section canonical
where section.id = canonical.section_id;

-- Older seeded/template items predate the full exercise catalogue. Reconnect
-- exact global-name matches so their category icon and source identity travel
-- with the workout payload without another exercise-library request.
update public.workout_items item
set source_exercise_id = exercise.id
from (
  select distinct on (lower(trim(source.name)))
    source.id,
    lower(trim(source.name)) as normalized_name
  from public.exercises source
  where source.scope = 'global'
    and source.archived_at is null
  order by lower(trim(source.name)), source.created_at, source.id
) exercise
where item.source_exercise_id is null
  and lower(trim(item.snapshot_name)) = exercise.normalized_name;

alter table public.workout_items
  add constraint workout_items_position_unique unique (section_id, position);

alter table public.workout_sections enable trigger guard_workout_sections_draft;
alter table public.workout_items enable trigger guard_workout_items_draft;

create unique index idx_workout_sections_one_per_workout
  on public.workout_sections (workout_id);

comment on table public.workout_sections is
  'Internal one-row-per-workout ownership container; not a user-facing workout group.';

create or replace function public.reorder_workout_items(
  target_workout_id uuid,
  ordered_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  target_section_id uuid;
  expected_ids uuid[];
  supplied_ids uuid[];
  item_id uuid;
  item_position integer := 0;
begin
  select section.id, week.program_version_id
  into target_section_id, target_version_id
  from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = target_workout_id
  for update of section;

  if target_section_id is null then raise exception 'Workout not found'; end if;
  if not public.can_edit_version(target_version_id) then
    raise exception 'Program version is not editable';
  end if;

  select array_agg(item.id order by item.id)
  into expected_ids
  from public.workout_items item
  where item.section_id = target_section_id;
  select array_agg(value order by value)
  into supplied_ids
  from unnest(ordered_ids) value;
  if coalesce(expected_ids, array[]::uuid[]) is distinct from
     coalesce(supplied_ids, array[]::uuid[]) then
    raise exception 'Exercise order must contain every item exactly once';
  end if;

  update public.workout_items
  set position = position + 1000000
  where section_id = target_section_id;
  foreach item_id in array ordered_ids loop
    update public.workout_items
    set position = item_position
    where id = item_id and section_id = target_section_id;
    item_position := item_position + 1;
  end loop;
  return target_workout_id;
end;
$$;

-- Copies preserve the exact workout-wide order.
create or replace function private.clone_week_contents(source_week_id uuid, target_week_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_workout record;
  source_item record;
  target_workout_id uuid;
  target_section_id uuid;
  target_item_id uuid;
begin
  for source_workout in
    select * from public.workouts where program_week_id = source_week_id order by position, id
  loop
    insert into public.workouts (
      program_week_id, title, day_of_week, schedule_label, position, estimated_minutes
    ) values (
      target_week_id, source_workout.title, source_workout.day_of_week,
      source_workout.schedule_label, source_workout.position, source_workout.estimated_minutes
    ) returning id into target_workout_id;

    insert into public.workout_sections (workout_id, title, section_kind, position)
    values (target_workout_id, 'Exercises', 'main', 0)
    returning id into target_section_id;

    for source_item in
      select item.*
      from public.workout_items item
      join public.workout_sections section on section.id = item.section_id
      where section.workout_id = source_workout.id
      order by item.position, item.id
    loop
      insert into public.workout_items (
        section_id, source_exercise_id, snapshot_name, snapshot_cue,
        entry_mode, tracking_fields, position
      ) values (
        target_section_id, source_item.source_exercise_id, source_item.snapshot_name,
        source_item.snapshot_cue, source_item.entry_mode, source_item.tracking_fields,
        source_item.position
      ) returning id into target_item_id;

      insert into public.prescribed_entries (
        workout_item_id, position, reps_min, reps_max, load_kg, duration_seconds,
        distance_metres, rounds, work_seconds, rest_seconds, target_rpe_min,
        target_rpe_max, target_text
      )
      select target_item_id, entry.position, entry.reps_min, entry.reps_max,
        entry.load_kg, entry.duration_seconds, entry.distance_metres, entry.rounds,
        entry.work_seconds, entry.rest_seconds, entry.target_rpe_min,
        entry.target_rpe_max, entry.target_text
      from public.prescribed_entries entry
      where entry.workout_item_id = source_item.id
      order by entry.position;
    end loop;
  end loop;
end;
$$;

-- Sections are now an internal invariant, so old section mutation endpoints
-- must not remain callable by stale clients.
drop function if exists public.add_workout_section(uuid, text, text);
drop function if exists public.delete_workout_section(uuid, boolean);
drop function if exists public.update_workout_section(uuid, text, text);
drop function if exists public.reorder_workout_sections(uuid, uuid[]);
drop function if exists public.reorder_section_items(uuid, uuid[]);
drop function if exists public.move_workout_item(uuid, uuid, integer);

revoke all on function public.reorder_workout_items(uuid, uuid[]) from public;
grant execute on function public.reorder_workout_items(uuid, uuid[]) to authenticated;
-- Bounded content payloads emit the single ordered exercise list.
create or replace function private.workout_content_payload(target_workout_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with prescribed_payload as (
    select prescribed.workout_item_id,
      jsonb_agg(jsonb_build_object(
        'id', prescribed.id, 'position', prescribed.position,
        'repsMin', prescribed.reps_min, 'repsMax', prescribed.reps_max,
        'loadKg', prescribed.load_kg, 'durationSeconds', prescribed.duration_seconds,
        'distanceMetres', prescribed.distance_metres, 'rounds', prescribed.rounds,
        'workSeconds', prescribed.work_seconds, 'restSeconds', prescribed.rest_seconds,
        'targetRpeMin', prescribed.target_rpe_min,
        'targetRpeMax', prescribed.target_rpe_max, 'targetText', prescribed.target_text
      ) order by prescribed.position, prescribed.id) as entries
    from public.prescribed_entries prescribed
    join public.workout_items item on item.id = prescribed.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    where section.workout_id = target_workout_id
    group by prescribed.workout_item_id
  ), item_payload as (
    select item.section_id,
      jsonb_agg(jsonb_build_object(
        'id', item.id, 'sourceExerciseId', item.source_exercise_id,
        'exerciseCategory', exercise.category,
        'name', item.snapshot_name, 'cue', item.snapshot_cue,
        'entryMode', item.entry_mode, 'trackingFields', item.tracking_fields,
        'position', item.position,
        'prescribedEntries', coalesce(prescribed.entries, '[]'::jsonb)
      ) order by item.position, item.id) as items
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    left join public.exercises exercise on exercise.id = item.source_exercise_id
    left join prescribed_payload prescribed on prescribed.workout_item_id = item.id
    where section.workout_id = target_workout_id
    group by item.section_id
  ), section_payload as (
    select section.workout_id,
      jsonb_agg(jsonb_build_object(
        'id', section.id, 'title', section.title, 'kind', section.section_kind,
        'notes', section.notes, 'position', section.position,
        'items', coalesce(item.items, '[]'::jsonb)
      ) order by section.position, section.id) as sections
    from public.workout_sections section
    left join item_payload item on item.section_id = section.id
    where section.workout_id = target_workout_id
    group by section.workout_id
  )
  select jsonb_build_object(
    'id', workout.id, 'title', workout.title,
    'scheduleLabel', workout.schedule_label, 'dayOfWeek', workout.day_of_week,
    'position', workout.position, 'estimatedMinutes', workout.estimated_minutes,
    'sections', coalesce(section.sections, '[]'::jsonb)
  )
  from public.workouts workout
  left join section_payload section on section.workout_id = workout.id
  where workout.id = target_workout_id;
$$;

create or replace function private.program_version_content_payload(
  target_program_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with prescribed_payload as (
    select prescribed.workout_item_id,
      jsonb_agg(jsonb_build_object(
        'id', prescribed.id, 'position', prescribed.position,
        'repsMin', prescribed.reps_min, 'repsMax', prescribed.reps_max,
        'loadKg', prescribed.load_kg, 'durationSeconds', prescribed.duration_seconds,
        'distanceMetres', prescribed.distance_metres, 'rounds', prescribed.rounds,
        'workSeconds', prescribed.work_seconds, 'restSeconds', prescribed.rest_seconds,
        'targetRpeMin', prescribed.target_rpe_min,
        'targetRpeMax', prescribed.target_rpe_max, 'targetText', prescribed.target_text
      ) order by prescribed.position, prescribed.id) as entries
    from public.prescribed_entries prescribed
    join public.workout_items item on item.id = prescribed.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_program_version_id
    group by prescribed.workout_item_id
  ), item_payload as (
    select item.section_id,
      jsonb_agg(jsonb_build_object(
        'id', item.id, 'sourceExerciseId', item.source_exercise_id,
        'exerciseCategory', exercise.category,
        'name', item.snapshot_name, 'cue', item.snapshot_cue,
        'entryMode', item.entry_mode, 'trackingFields', item.tracking_fields,
        'position', item.position,
        'prescribedEntries', coalesce(prescribed.entries, '[]'::jsonb)
      ) order by item.position, item.id) as items
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join public.exercises exercise on exercise.id = item.source_exercise_id
    left join prescribed_payload prescribed on prescribed.workout_item_id = item.id
    where week.program_version_id = target_program_version_id
    group by item.section_id
  ), section_payload as (
    select section.workout_id,
      jsonb_agg(jsonb_build_object(
        'id', section.id, 'title', section.title, 'kind', section.section_kind,
        'notes', section.notes, 'position', section.position,
        'items', coalesce(item.items, '[]'::jsonb)
      ) order by section.position, section.id) as sections
    from public.workout_sections section
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join item_payload item on item.section_id = section.id
    where week.program_version_id = target_program_version_id
    group by section.workout_id
  ), workout_payload as (
    select workout.program_week_id,
      jsonb_agg(jsonb_build_object(
        'id', workout.id, 'title', workout.title,
        'scheduleLabel', workout.schedule_label, 'dayOfWeek', workout.day_of_week,
        'position', workout.position, 'estimatedMinutes', workout.estimated_minutes,
        'sections', coalesce(section.sections, '[]'::jsonb)
      ) order by workout.position, workout.id) as workouts
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    left join section_payload section on section.workout_id = workout.id
    where week.program_version_id = target_program_version_id
    group by workout.program_week_id
  ), week_payload as (
    select jsonb_agg(jsonb_build_object(
      'id', week.id, 'phaseId', week.phase_id, 'weekIndex', week.week_index,
      'label', week.label, 'workouts', coalesce(workout.workouts, '[]'::jsonb)
    ) order by week.week_index, week.id) as weeks
    from public.program_weeks week
    left join workout_payload workout on workout.program_week_id = week.id
    where week.program_version_id = target_program_version_id
  ), phase_payload as (
    select jsonb_agg(jsonb_build_object(
      'id', phase.id, 'name', phase.name, 'position', phase.position
    ) order by phase.position, phase.id) as phases
    from public.program_phases phase
    where phase.program_version_id = target_program_version_id
  )
  select jsonb_build_object(
    'phases', coalesce(phase.phases, '[]'::jsonb),
    'weeks', coalesce(week.weeks, '[]'::jsonb)
  )
  from phase_payload phase cross join week_payload week;
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
  ) values (week_id, trim(target_title), 'Workout 1', 0, 45)
  returning id into workout_id;
  insert into public.workout_sections (workout_id, title, section_kind, position)
  values (workout_id, 'Exercises', 'main', 0);
  return workout_program_id;
end;
$$;

revoke all on function public.create_blank_quick_workout(text) from public;
grant execute on function public.create_blank_quick_workout(text) to authenticated;

-- Legacy template JSON may still contain sections. Flatten their items into
-- one ordered workout list and discard the obsolete group metadata.
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
        coalesce((workout_entry.item ->> 'minutes')::integer, 45)
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
