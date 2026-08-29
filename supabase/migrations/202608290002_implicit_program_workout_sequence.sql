-- Programs are edited and scheduled as ordered workout sequences. A single
-- program_weeks row remains as an internal ownership/RLS container so the
-- established program tree foreign keys do not need a destructive rewrite.

-- Program-tree immutability protects ordinary application writes, including
-- published versions. This migration is the one controlled exception needed
-- to normalize the existing trees. Both triggers are restored before commit.
alter table public.program_weeks disable trigger guard_program_weeks_draft;
alter table public.workouts disable trigger guard_workouts_draft;

-- Repair any incomplete historical version before deriving the canonical
-- container. The nullable phase relation already supports versions without a
-- phase row.
insert into public.program_weeks (
  program_version_id,
  phase_id,
  week_index,
  label
)
select
  version.id,
  (
    select phase.id
    from public.program_phases phase
    where phase.program_version_id = version.id
    order by phase.position, phase.id
    limit 1
  ),
  1,
  case when program.content_type = 'quick_workout' then 'Workout' else 'Program' end
from public.program_versions version
join public.programs program on program.id = version.program_id
where not exists (
  select 1
  from public.program_weeks existing
  where existing.program_version_id = version.id
);

create temporary table implicit_program_week_map on commit drop as
select distinct on (week.program_version_id)
  week.program_version_id,
  week.id as canonical_week_id
from public.program_weeks week
order by week.program_version_id, week.week_index, week.id;

-- Capture the complete old order before changing a parent or position. The
-- workout primary keys are never replaced, so schedules and history continue
-- to reference the exact same content records.
create temporary table implicit_program_workout_order on commit drop as
select
  workout.id as workout_id,
  map.canonical_week_id,
  row_number() over (
    partition by week.program_version_id
    order by week.week_index, workout.position, workout.id
  )::integer - 1 as next_position
from public.workouts workout
join public.program_weeks week on week.id = workout.program_week_id
join implicit_program_week_map map
  on map.program_version_id = week.program_version_id;

-- The old uniqueness boundary was one position sequence per week. Drop and
-- recreate it inside this transaction so rows from different old weeks can be
-- moved directly into their final contiguous positions without collision.
alter table public.workouts
  drop constraint if exists workouts_position_unique;

update public.workouts workout
set
  program_week_id = ordered.canonical_week_id,
  position = ordered.next_position,
  day_of_week = null,
  schedule_label = 'Workout ' || (ordered.next_position + 1)
from implicit_program_workout_order ordered
where ordered.workout_id = workout.id;

alter table public.workouts
  add constraint workouts_position_unique
  unique (program_week_id, position);

delete from public.program_weeks week
using implicit_program_week_map map
where week.program_version_id = map.program_version_id
  and week.id <> map.canonical_week_id;

update public.program_weeks week
set
  week_index = 1,
  label = case
    when program.content_type = 'quick_workout' then 'Workout'
    else 'Program'
  end
from public.program_versions version
join public.programs program on program.id = version.program_id
where version.id = week.program_version_id;

alter table public.program_weeks enable trigger guard_program_weeks_draft;
alter table public.workouts enable trigger guard_workouts_draft;

-- This is the durable one-container invariant. The older
-- (program_version_id, week_index) constraint remains useful for existing read
-- plans, while this index prevents any new hidden Week 2 row.
create unique index idx_program_weeks_one_per_version
  on public.program_weeks (program_version_id);

comment on table public.program_weeks is
  'Internal one-row-per-version container for an ordered workout sequence; not a user-managed calendar week.';

-- Clone one implicit container while preserving the phase metadata and full
-- nested workout tree. create_program_draft, copy_program_to_own and
-- fork_program_assignment all pass through this helper.
create or replace function private.clone_program_version_tree(
  source_version_id uuid,
  target_version_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_phase_row record;
  source_week_id uuid;
  source_phase_id uuid;
  target_phase_id uuid;
  target_week_id uuid;
  target_week_label text;
begin
  for source_phase_row in
    select phase.*
    from public.program_phases phase
    where phase.program_version_id = source_version_id
    order by phase.position, phase.id
  loop
    insert into public.program_phases (program_version_id, name, position)
    values (target_version_id, source_phase_row.name, source_phase_row.position);
  end loop;

  select week.id, week.phase_id
  into source_week_id, source_phase_id
  from public.program_weeks week
  where week.program_version_id = source_version_id
  order by week.week_index, week.id
  limit 1;

  if source_phase_id is not null then
    select target_phase.id
    into target_phase_id
    from public.program_phases source_phase
    join public.program_phases target_phase
      on target_phase.program_version_id = target_version_id
     and target_phase.position = source_phase.position
    where source_phase.id = source_phase_id
    limit 1;
  else
    select phase.id
    into target_phase_id
    from public.program_phases phase
    where phase.program_version_id = target_version_id
    order by phase.position, phase.id
    limit 1;
  end if;

  select case
    when program.content_type = 'quick_workout' then 'Workout'
    else 'Program'
  end
  into target_week_label
  from public.program_versions version
  join public.programs program on program.id = version.program_id
  where version.id = target_version_id;

  insert into public.program_weeks (
    program_version_id,
    phase_id,
    week_index,
    label
  ) values (
    target_version_id,
    target_phase_id,
    1,
    coalesce(target_week_label, 'Program')
  ) returning id into target_week_id;

  if source_week_id is not null then
    perform private.clone_week_contents(source_week_id, target_week_id);
  end if;
end;
$$;

-- Template `week_count` historically meant repeating the template workout
-- array for that many progression slots. Preserve that content and order, but
-- materialize it as one sequence rather than multiple user-visible weeks.
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
  workout_entry record;
  section_entry record;
  item_entry record;
begin
  select * into template_row
  from public.program_templates template
  where template.id = target_template_id and template.is_active;
  if template_row.id is null then
    raise exception 'Program template is unavailable';
  end if;

  insert into public.program_phases (program_version_id, name, position)
  values (target_version_id, 'Foundation', 0)
  returning id into phase_id;

  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (target_version_id, phase_id, 1, 'Program')
  returning id into week_id;

  for cycle_number in 1..greatest(coalesce(template_row.week_count, 1), 1) loop
    for workout_entry in
      select value as item, ordinality::integer - 1 as position
      from jsonb_array_elements(coalesce(template_row.workouts, '[]'::jsonb))
        with ordinality
    loop
      insert into public.workouts (
        program_week_id,
        title,
        day_of_week,
        schedule_label,
        position,
        estimated_minutes
      ) values (
        week_id,
        workout_entry.item ->> 'title',
        null,
        'Workout ' || (workout_position + 1),
        workout_position,
        coalesce((workout_entry.item ->> 'minutes')::integer, 45)
      ) returning id into workout_id;
      workout_position := workout_position + 1;

      for section_entry in
        select value as item, ordinality::integer - 1 as position
        from jsonb_array_elements(
          coalesce(workout_entry.item -> 'sections', '[]'::jsonb)
        ) with ordinality
      loop
        insert into public.workout_sections (
          workout_id,
          title,
          section_kind,
          position
        ) values (
          workout_id,
          section_entry.item ->> 'title',
          coalesce(section_entry.item ->> 'kind', 'custom'),
          section_entry.position
        ) returning id into section_id;

        for item_entry in
          select value as item, ordinality::integer - 1 as position
          from jsonb_array_elements(
            coalesce(section_entry.item -> 'items', '[]'::jsonb)
          ) with ordinality
        loop
          exercise_id := null;
          if item_entry.item ? 'exercise' then
            select exercise.id
            into exercise_id
            from public.exercises exercise
            where exercise.scope = 'global'
              and exercise.name = item_entry.item ->> 'exercise'
              and exercise.archived_at is null
            order by exercise.created_at, exercise.id
            limit 1;
          end if;

          insert into public.workout_items (
            section_id,
            source_exercise_id,
            snapshot_name,
            snapshot_cue,
            entry_mode,
            tracking_fields,
            position
          ) values (
            section_id,
            exercise_id,
            item_entry.item ->> 'title',
            coalesce(item_entry.item ->> 'cue', ''),
            item_entry.item ->> 'mode',
            coalesce(
              array(
                select jsonb_array_elements_text(item_entry.item -> 'fields')
              ),
              array[]::text[]
            ),
            item_entry.position
          ) returning id into item_id;

          if item_entry.item ->> 'mode' = 'sets' then
            for set_position in 0..greatest(
              coalesce((item_entry.item ->> 'sets')::integer, 1) - 1,
              0
            ) loop
              insert into public.prescribed_entries (
                workout_item_id,
                position,
                reps_min,
                reps_max,
                target_rpe_min,
                target_rpe_max
              ) values (
                item_id,
                set_position,
                (item_entry.item ->> 'reps')::numeric,
                (item_entry.item ->> 'reps')::numeric,
                (item_entry.item ->> 'rpe')::numeric,
                (item_entry.item ->> 'rpe')::numeric
              );
            end loop;
          elsif item_entry.item ->> 'mode' <> 'none' then
            insert into public.prescribed_entries (
              workout_item_id,
              position,
              duration_seconds,
              distance_metres,
              rounds,
              work_seconds,
              rest_seconds,
              target_rpe_min,
              target_rpe_max
            ) values (
              item_id,
              0,
              (item_entry.item ->> 'durationSeconds')::integer,
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

-- New blank programs also use the neutral implicit container label. Keep the
-- established signature for deployed clients.
create or replace function public.create_blank_program(
  target_athlete_id uuid,
  target_title text,
  target_planning_mode text default 'fixed_weeks'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  resolved_athlete_id uuid := coalesce(target_athlete_id, (select auth.uid()));
  program_id uuid;
  version_id uuid;
  phase_id uuid;
  author_name text;
  source_kind text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if resolved_athlete_id <> current_user_id
    and not public.is_active_coach(resolved_athlete_id) then
    raise exception 'Not authorized to create this program';
  end if;
  if length(trim(coalesce(target_title, ''))) not between 1 and 120 then
    raise exception 'Program title must be between 1 and 120 characters';
  end if;
  if coalesce(target_planning_mode, 'fixed_weeks') <> 'fixed_weeks' then
    raise exception 'Repeating programs are no longer supported';
  end if;

  select profile.display_name
  into author_name
  from public.profiles profile
  where profile.id = current_user_id;
  source_kind := case
    when resolved_athlete_id = current_user_id then 'self'
    else 'coach'
  end;

  insert into public.programs (
    athlete_id,
    created_by_id,
    title,
    description,
    planning_mode,
    is_current,
    source_type,
    source_label
  ) values (
    resolved_athlete_id,
    current_user_id,
    trim(target_title),
    '',
    'fixed_weeks',
    true,
    source_kind,
    case
      when source_kind = 'self' then 'Created by you'
      else 'Created by ' || author_name
    end
  ) returning id into program_id;

  insert into public.program_versions (
    program_id,
    authored_by_id,
    version_number,
    status
  ) values (
    program_id,
    current_user_id,
    1,
    'draft'
  ) returning id into version_id;

  insert into public.program_phases (program_version_id, name, position)
  values (version_id, 'Plan', 0)
  returning id into phase_id;

  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (version_id, phase_id, 1, 'Program');

  return program_id;
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
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if length(trim(coalesce(target_title, ''))) not between 1 and 120 then
    raise exception 'Workout name must be between 1 and 120 characters';
  end if;

  insert into public.programs (
    athlete_id,
    created_by_id,
    title,
    description,
    planning_mode,
    is_current,
    source_type,
    source_label,
    content_type
  ) values (
    current_user_id,
    current_user_id,
    trim(target_title),
    '',
    'fixed_weeks',
    true,
    'self',
    'Created by you',
    'quick_workout'
  ) returning id into workout_program_id;

  insert into public.program_versions (
    program_id,
    authored_by_id,
    version_number,
    status
  ) values (
    workout_program_id,
    current_user_id,
    1,
    'draft'
  ) returning id into version_id;

  insert into public.program_phases (program_version_id, name, position)
  values (version_id, 'Workout', 0)
  returning id into phase_id;

  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (version_id, phase_id, 1, 'Workout')
  returning id into week_id;

  insert into public.workouts (
    program_week_id,
    title,
    schedule_label,
    position,
    estimated_minutes
  ) values (
    week_id,
    trim(target_title),
    'Workout 1',
    0,
    45
  ) returning id into workout_id;

  insert into public.workout_sections (
    workout_id,
    title,
    section_kind,
    position
  ) values
    (workout_id, 'Warm up', 'warmup', 0),
    (workout_id, 'Main work', 'main', 1),
    (workout_id, 'Functional', 'conditioning', 2),
    (workout_id, 'Cooldown', 'cooldown', 3);

  return workout_program_id;
end;
$$;

-- Week mutation endpoints are intentionally removed: the single row is an
-- implementation detail and deleting it would cascade-delete the whole
-- workout sequence.
drop function if exists public.add_program_week(uuid);
drop function if exists public.delete_program_week(uuid);
drop function if exists public.duplicate_program_week(uuid, uuid);
drop function if exists public.duplicate_program_week_times(uuid, integer);

-- Keep the historically revoked signature discoverable for old clients and
-- integration probes, but remove its six-week implementation so even a
-- privileged accidental call cannot violate the one-container invariant.
create or replace function public.ensure_starter_program(
  target_athlete_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform target_athlete_id;
  raise exception 'Starter program creation is retired; create a program or workout explicitly';
end;
$$;

revoke all on function public.ensure_starter_program(uuid)
  from public, anon, authenticated;

revoke all on function public.create_blank_program(uuid, text, text) from public;
grant execute on function public.create_blank_program(uuid, text, text) to authenticated;
revoke all on function public.create_blank_quick_workout(text) from public;
grant execute on function public.create_blank_quick_workout(text) to authenticated;
