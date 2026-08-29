-- Refresh the athlete's upcoming three-day program with Catalyst movements.
-- Apply the same plan to the already scheduled version and editable draft so
-- calendar workouts and future reuse stay aligned. Every item has a video and
-- every prescription targets RPE 8.

create temporary table next_week_video_plan (
  workout_title text not null,
  position integer not null,
  exercise_name text not null,
  set_count integer,
  rep_count integer,
  duration_seconds integer,
  distance_metres numeric,
  primary key (workout_title, position)
) on commit drop;

insert into next_week_video_plan (
  workout_title, position, exercise_name, set_count, rep_count,
  duration_seconds, distance_metres
) values
  ('Snatch technique', 0, 'Hang Muscle Snatch', 3, 3, null, null),
  ('Snatch technique', 1, 'Press In Snatch (Sots Press)', 3, 5, null, null),
  ('Snatch technique', 2, 'Heaving Snatch Balance', 4, 3, null, null),
  ('Snatch technique', 3, '2-Position Snatch', 5, 2, null, null),
  ('Snatch technique', 4, 'Block Snatch Pull', 4, 3, null, null),
  ('Snatch technique', 5, 'Snatch-Grip Romanian Deadlift (RDL)', 3, 5, null, null),
  ('Snatch technique', 6, 'Box Jump', 3, 5, null, null),
  ('Snatch technique', 7, 'Hip Extension Row', 3, 8, null, null),
  ('Snatch technique', 8, 'Half-Kneeling Adductor Rock', null, null, 300, null),

  ('Jerk technique', 0, 'Jerk Dip', 3, 5, null, null),
  ('Jerk technique', 1, 'Jerk Drive', 4, 3, null, null),
  ('Jerk technique', 2, 'Push Jerk', 5, 2, null, null),
  ('Jerk technique', 3, 'Squat Jerk', 5, 2, null, null),
  ('Jerk technique', 4, 'Front Squat – Power Jerk', 4, 2, null, null),
  ('Jerk technique', 5, 'Jerk-Grip Overhead Carry', null, null, null, 20),
  ('Jerk technique', 6, 'Kettlebell Z-Press', 3, 8, null, null),
  ('Jerk technique', 7, 'Broad Jump', 3, 5, null, null),
  ('Jerk technique', 8, 'Pallof Press', 3, 10, null, null),

  ('Balanced full-lift session', 0, 'Muscle Clean', 3, 3, null, null),
  ('Balanced full-lift session', 1, 'Hang Power Snatch', 4, 2, null, null),
  ('Balanced full-lift session', 2, '2-Position Power Clean', 4, 2, null, null),
  ('Balanced full-lift session', 3, 'Power Jerk', 5, 2, null, null),
  ('Balanced full-lift session', 4, 'Back Squat', 4, 5, null, null),
  ('Balanced full-lift session', 5, 'Bent Row', 3, 8, null, null),
  ('Balanced full-lift session', 6, 'Kettlebell Swing', 3, 12, null, null),
  ('Balanced full-lift session', 7, 'Box Jump', 3, 6, null, null),
  ('Balanced full-lift session', 8, 'Bench Press', 3, 8, null, null);

create temporary table target_next_week_video_program on commit drop as
select distinct version.program_id
from public.scheduled_workouts scheduled
join public.program_versions version on version.id = scheduled.program_version_id
join public.workouts workout on workout.id = scheduled.workout_id
where scheduled.status = 'planned'
  and scheduled.planned_date between current_date and current_date + 7
  and workout.title in (
    'Snatch technique',
    'Jerk technique',
    'Balanced full-lift session'
  );

do $$
declare
  target_count integer;
begin
  select count(*) into target_count from target_next_week_video_program;
  if target_count > 1 then
    raise exception 'Expected at most one upcoming three-day program, found %', target_count;
  end if;
end;
$$;

create temporary table target_next_week_video_workouts on commit drop as
select distinct
  workout.id as workout_id,
  workout.title as workout_title,
  section.id as section_id
from target_next_week_video_program target
join public.program_versions version on version.program_id = target.program_id
join public.program_weeks week on week.program_version_id = version.id
join public.workouts workout on workout.program_week_id = week.id
join public.workout_sections section on section.workout_id = workout.id
where workout.title in (
    'Snatch technique',
    'Jerk technique',
    'Balanced full-lift session'
  )
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

do $$
declare
  unresolved_count integer;
begin
  select count(*) into unresolved_count
  from next_week_video_plan plan
  where not exists (
    select 1
    from public.exercises exercise
    where exercise.scope = 'global'
      and exercise.archived_at is null
      and exercise.video_url is not null
      and lower(trim(exercise.name)) = lower(trim(plan.exercise_name))
  );

  if unresolved_count <> 0 then
    raise exception '% planned exercises are missing a catalogue video', unresolved_count;
  end if;
end;
$$;

alter table public.workout_items disable trigger guard_workout_items_draft;
alter table public.prescribed_entries disable trigger guard_prescribed_entries_draft;

delete from public.workout_items item
using target_next_week_video_workouts target
where item.section_id = target.section_id;

create temporary table inserted_next_week_video_items on commit drop as
select
  gen_random_uuid() as item_id,
  target.workout_id,
  target.section_id,
  plan.position,
  plan.set_count,
  plan.rep_count,
  plan.duration_seconds,
  plan.distance_metres,
  exercise.id as exercise_id,
  exercise.name,
  exercise.cue,
  exercise.default_entry_mode,
  exercise.default_tracking_fields
from target_next_week_video_workouts target
join next_week_video_plan plan on plan.workout_title = target.workout_title
cross join lateral (
  select candidate.*
  from public.exercises candidate
  where candidate.scope = 'global'
    and candidate.archived_at is null
    and candidate.video_url is not null
    and lower(trim(candidate.name)) = lower(trim(plan.exercise_name))
  order by
    (candidate.source_provider = 'catalyst-athletics') desc,
    candidate.created_at,
    candidate.id
  limit 1
) exercise;

insert into public.workout_items (
  id, section_id, source_exercise_id, snapshot_name, snapshot_cue,
  entry_mode, tracking_fields, position
)
select
  item.item_id,
  item.section_id,
  item.exercise_id,
  item.name,
  item.cue,
  item.default_entry_mode,
  item.default_tracking_fields,
  item.position
from inserted_next_week_video_items item;

insert into public.prescribed_entries (
  workout_item_id, position, reps_min, reps_max, duration_seconds,
  distance_metres, target_rpe_min, target_rpe_max
)
select
  item.item_id,
  series.position - 1,
  item.rep_count,
  item.rep_count,
  item.duration_seconds,
  item.distance_metres,
  8,
  8
from inserted_next_week_video_items item
cross join lateral generate_series(1, coalesce(item.set_count, 1)) as series(position);

alter table public.prescribed_entries enable trigger guard_prescribed_entries_draft;
alter table public.workout_items enable trigger guard_workout_items_draft;

do $$
declare
  invalid_workout_count integer;
begin
  select count(*) into invalid_workout_count
  from target_next_week_video_workouts target
  where 9 <> (
    select count(*)
    from public.workout_items item
    where item.section_id = target.section_id
  )
  or exists (
    select 1
    from public.workout_items item
    left join public.exercises exercise on exercise.id = item.source_exercise_id
    where item.section_id = target.section_id
      and exercise.video_url is null
  )
  or exists (
    select 1
    from public.workout_items item
    join public.prescribed_entries entry on entry.workout_item_id = item.id
    where item.section_id = target.section_id
      and (entry.target_rpe_min <> 8 or entry.target_rpe_max <> 8)
  );

  if invalid_workout_count <> 0 then
    raise exception 'Video/RPE verification failed for % workouts', invalid_workout_count;
  end if;
end;
$$;
