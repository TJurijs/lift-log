-- Apply the athlete's non-split jerk preference to the already scheduled
-- next-week program and its editable draft. Existing workout item ids and
-- prescriptions are retained so dates, sets, reps and RPE do not change.

create temporary table target_next_week_jerk_program on commit drop as
select distinct version.program_id
from public.scheduled_workouts scheduled
join public.program_versions version on version.id = scheduled.program_version_id
join public.workouts workout on workout.id = scheduled.workout_id
join public.workout_sections section on section.workout_id = workout.id
join public.workout_items item on item.section_id = section.id
where scheduled.status = 'planned'
  and scheduled.planned_date between current_date and current_date + 7
  and lower(trim(workout.title)) = 'jerk technique'
  and lower(trim(item.snapshot_name)) in ('split jerk', 'jerk balance');

do $$
declare
  target_count integer;
begin
  select count(*) into target_count from target_next_week_jerk_program;
  -- Fresh/local databases do not contain the athlete's personal plan, so the
  -- data correction is intentionally a no-op there. Multiple matches are not
  -- safe to modify automatically.
  if target_count > 1 then
    raise exception 'Expected at most one upcoming split-jerk program, found %', target_count;
  end if;
end;
$$;

create temporary table target_jerk_workouts on commit drop as
select distinct workout.id
from target_next_week_jerk_program target
join public.program_versions version on version.program_id = target.program_id
join public.program_weeks week on week.program_version_id = version.id
join public.workouts workout on workout.program_week_id = week.id
where lower(trim(workout.title)) = 'jerk technique'
  and (
    version.status = 'draft'
    or exists (
      select 1
      from public.scheduled_workouts scheduled
      where scheduled.program_version_id = version.id
        and scheduled.workout_id = workout.id
        and scheduled.status = 'planned'
        and scheduled.planned_date between current_date and current_date + 7
    )
  );

alter table public.workout_items disable trigger guard_workout_items_draft;
alter table public.prescribed_entries disable trigger guard_prescribed_entries_draft;

do $$
declare
  target_workout record;
  push_exercise public.exercises%rowtype;
  squat_exercise public.exercises%rowtype;
  push_item_id uuid;
  squat_item_id uuid;
begin
  select exercise.* into push_exercise
  from public.exercises exercise
  where exercise.scope = 'global'
    and exercise.archived_at is null
    and lower(trim(exercise.name)) = 'push jerk'
  order by (exercise.source_provider = 'catalyst-athletics') desc,
           exercise.created_at,
           exercise.id
  limit 1;

  select exercise.* into squat_exercise
  from public.exercises exercise
  where exercise.scope = 'global'
    and exercise.archived_at is null
    and lower(trim(exercise.name)) = 'squat jerk'
  order by (exercise.source_provider = 'catalyst-athletics') desc,
           exercise.created_at,
           exercise.id
  limit 1;

  if push_exercise.id is null or squat_exercise.id is null then
    raise exception 'Push Jerk and Squat Jerk must exist in the exercise catalogue';
  end if;

  for target_workout in select id from target_jerk_workouts loop
    select item.id into push_item_id
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    where section.workout_id = target_workout.id
      and lower(trim(item.snapshot_name)) in ('jerk balance', 'push jerk')
    order by
      case when lower(trim(item.snapshot_name)) = 'jerk balance' then 0 else 1 end,
      item.position,
      item.id
    limit 1;

    select item.id into squat_item_id
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    where section.workout_id = target_workout.id
      and lower(trim(item.snapshot_name)) in ('split jerk', 'squat jerk')
    order by
      case when lower(trim(item.snapshot_name)) = 'split jerk' then 0 else 1 end,
      item.position,
      item.id
    limit 1;

    if push_item_id is null or squat_item_id is null then
      raise exception 'Replacement items are missing from jerk workout %', target_workout.id;
    end if;

    update public.workout_items item
    set
      source_exercise_id = push_exercise.id,
      snapshot_name = push_exercise.name,
      snapshot_cue = push_exercise.cue,
      entry_mode = push_exercise.default_entry_mode,
      tracking_fields = push_exercise.default_tracking_fields
    where item.id = push_item_id;

    delete from public.workout_items item
    using public.workout_sections section
    where item.section_id = section.id
      and section.workout_id = target_workout.id
      and item.id <> push_item_id
      and lower(trim(item.snapshot_name)) = 'push jerk';

    update public.workout_items item
    set
      source_exercise_id = squat_exercise.id,
      snapshot_name = squat_exercise.name,
      snapshot_cue = squat_exercise.cue,
      entry_mode = squat_exercise.default_entry_mode,
      tracking_fields = squat_exercise.default_tracking_fields
    where item.id = squat_item_id;

    delete from public.workout_items item
    using public.workout_sections section
    where item.section_id = section.id
      and section.workout_id = target_workout.id
      and item.id <> squat_item_id
      and lower(trim(item.snapshot_name)) = 'squat jerk';

    update public.workout_items item
    set position = item.position + 1000
    from public.workout_sections section
    where item.section_id = section.id
      and section.workout_id = target_workout.id;

    with ordered as (
      select
        item.id,
        row_number() over (
          order by
            case
              when lower(trim(item.snapshot_name)) = 'weightlifting warmup' then 0
              when lower(trim(item.snapshot_name)) = 'jerk dip and drive' then 1
              when item.id = push_item_id then 2
              when item.id = squat_item_id then 3
              else 10
            end,
            item.position,
            item.id
        )::integer - 1 as next_position
      from public.workout_items item
      join public.workout_sections section on section.id = item.section_id
      where section.workout_id = target_workout.id
    )
    update public.workout_items item
    set position = ordered.next_position
    from ordered
    where item.id = ordered.id;
  end loop;
end;
$$;

alter table public.prescribed_entries enable trigger guard_prescribed_entries_draft;
alter table public.workout_items enable trigger guard_workout_items_draft;

do $$
declare
  invalid_workout_count integer;
begin
  select count(*) into invalid_workout_count
  from target_jerk_workouts target
  where exists (
    select 1
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    where section.workout_id = target.id
      and lower(trim(item.snapshot_name)) in ('split jerk', 'jerk balance')
  )
  or 1 <> (
    select count(*)
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    where section.workout_id = target.id
      and lower(trim(item.snapshot_name)) = 'push jerk'
  )
  or 1 <> (
    select count(*)
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    where section.workout_id = target.id
      and lower(trim(item.snapshot_name)) = 'squat jerk'
  );

  if invalid_workout_count <> 0 then
    raise exception 'Jerk preference verification failed for % workouts', invalid_workout_count;
  end if;
end;
$$;
