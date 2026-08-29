-- Replace three upcoming-program movements that require unavailable space or
-- equipment, or are unnecessarily high-impact for the athlete.

create temporary table upcoming_movement_replacements (
  workout_title text not null,
  old_exercise_name text not null,
  new_exercise_name text not null,
  set_count integer not null,
  rep_count integer not null,
  primary key (workout_title, old_exercise_name)
) on commit drop;

insert into upcoming_movement_replacements (
  workout_title, old_exercise_name, new_exercise_name, set_count, rep_count
) values
  ('Snatch technique', 'Block Snatch Pull', 'Snatch Pull', 4, 3),
  ('Jerk technique', 'Jerk-Grip Overhead Carry', 'Push Press', 3, 5),
  ('Jerk technique', 'Broad Jump', 'Hip Extension', 3, 12);

create temporary table target_upcoming_programs on commit drop as
select distinct version.program_id
from public.scheduled_workouts scheduled
join public.program_versions version on version.id = scheduled.program_version_id
join public.workouts workout on workout.id = scheduled.workout_id
where scheduled.status = 'planned'
  and scheduled.planned_date between current_date and current_date + 7
  and workout.title in ('Snatch technique', 'Jerk technique');

do $$
declare
  target_count integer;
begin
  select count(*) into target_count from target_upcoming_programs;
  if target_count > 1 then
    raise exception 'Expected at most one upcoming target program, found %', target_count;
  end if;
end;
$$;

create temporary table target_replacement_items on commit drop as
select
  item.id as item_id,
  replacement.set_count,
  replacement.rep_count,
  exercise.id as exercise_id,
  exercise.name,
  exercise.cue,
  exercise.default_entry_mode,
  exercise.default_tracking_fields
from target_upcoming_programs target
join public.program_versions version on version.program_id = target.program_id
join public.program_weeks week on week.program_version_id = version.id
join public.workouts workout on workout.program_week_id = week.id
join public.workout_sections section on section.workout_id = workout.id
join public.workout_items item on item.section_id = section.id
join upcoming_movement_replacements replacement
  on lower(trim(replacement.workout_title)) = lower(trim(workout.title))
  and lower(trim(replacement.old_exercise_name)) = lower(trim(item.snapshot_name))
cross join lateral (
  select candidate.*
  from public.exercises candidate
  where candidate.scope = 'global'
    and candidate.archived_at is null
    and candidate.video_url is not null
    and lower(trim(candidate.name)) = lower(trim(replacement.new_exercise_name))
  order by
    (candidate.source_provider = 'catalyst-athletics') desc,
    candidate.created_at,
    candidate.id
  limit 1
) exercise
where version.status = 'draft'
  or exists (
    select 1
    from public.scheduled_workouts scheduled
    where scheduled.program_version_id = version.id
      and scheduled.workout_id = workout.id
      and scheduled.status = 'planned'
      and scheduled.planned_date between current_date and current_date + 7
  );

do $$
declare
  expected_count integer;
  actual_count integer;
begin
  select count(*) into expected_count
  from target_upcoming_programs target
  join public.program_versions version on version.program_id = target.program_id
  cross join upcoming_movement_replacements replacement
  where version.status = 'draft'
    or exists (
      select 1
      from public.program_weeks week
      join public.workouts workout on workout.program_week_id = week.id
      join public.scheduled_workouts scheduled
        on scheduled.program_version_id = version.id
        and scheduled.workout_id = workout.id
      where week.program_version_id = version.id
        and lower(trim(workout.title)) = lower(trim(replacement.workout_title))
        and scheduled.status = 'planned'
        and scheduled.planned_date between current_date and current_date + 7
    );

  select count(*) into actual_count from target_replacement_items;
  if actual_count <> expected_count then
    raise exception 'Expected % replacement items, found %', expected_count, actual_count;
  end if;
end;
$$;

alter table public.workout_items disable trigger guard_workout_items_draft;
alter table public.prescribed_entries disable trigger guard_prescribed_entries_draft;

update public.workout_items item
set
  source_exercise_id = target.exercise_id,
  snapshot_name = target.name,
  snapshot_cue = target.cue,
  entry_mode = target.default_entry_mode,
  tracking_fields = target.default_tracking_fields
from target_replacement_items target
where item.id = target.item_id;

delete from public.prescribed_entries entry
using target_replacement_items target
where entry.workout_item_id = target.item_id;

insert into public.prescribed_entries (
  workout_item_id, position, reps_min, reps_max,
  target_rpe_min, target_rpe_max
)
select
  target.item_id,
  series.position - 1,
  target.rep_count,
  target.rep_count,
  8,
  8
from target_replacement_items target
cross join lateral generate_series(1, target.set_count) as series(position);

alter table public.prescribed_entries enable trigger guard_prescribed_entries_draft;
alter table public.workout_items enable trigger guard_workout_items_draft;
