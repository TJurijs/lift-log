-- Create Jurijs's reusable, video-backed general-fitness workout for Elina.
-- The workout stays in Jurijs's own Programs library and is not assigned or
-- scheduled here. It can therefore be reviewed and edited before use.

do $$
declare
  owner_id uuid;
  workout_program_id uuid;
  version_id uuid;
  phase_id uuid;
  week_id uuid;
  workout_id uuid;
  target_section_id uuid;
  plan_row record;
  exercise_row record;
  item_id uuid;
  entry_position integer;
begin
  select profile.id
  into owner_id
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where lower(account.email) = 'toyurit@gmail.com'
  limit 1;

  if owner_id is null then
    raise notice 'Target LiftLog account is not present in this environment; skipping personal workout creation';
    return;
  end if;

  select program.id
  into workout_program_id
  from public.programs program
  where program.athlete_id = owner_id
    and program.created_by_id = owner_id
    and program.content_type = 'quick_workout'
    and program.title = 'Elina — General Fitness'
    and program.archived_at is null
  limit 1;

  if workout_program_id is not null then
    return;
  end if;

  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label, content_type
  ) values (
    owner_id,
    owner_id,
    'Elina — General Fitness',
    'An approachable 80-minute full-body workout: 10-minute warm-up, 60-minute main work, and 10-minute cooldown. Keep every set controlled and comfortable.',
    'fixed_weeks',
    true,
    'self',
    'Created by you',
    'quick_workout'
  ) returning id into workout_program_id;

  insert into public.program_versions (
    program_id, authored_by_id, version_number, status
  ) values (
    workout_program_id, owner_id, 1, 'draft'
  ) returning id into version_id;

  insert into public.program_phases (program_version_id, name, position)
  values (version_id, 'Workout', 0)
  returning id into phase_id;

  insert into public.program_weeks (
    program_version_id, phase_id, week_index, label
  ) values (
    version_id, phase_id, 1, 'Workout'
  ) returning id into week_id;

  insert into public.workouts (
    program_week_id, title, schedule_label, position, estimated_minutes
  ) values (
    week_id, 'Elina — General Fitness', 'Workout 1', 0, 80
  ) returning id into workout_id;

  insert into public.workout_sections (workout_id, title, section_kind, position)
  values (workout_id, 'Exercises', 'main', 0)
  returning id into target_section_id;

  for plan_row in
    select *
    from (values
      (0,  'Half-Kneeling Adductor Rock',       1, null::numeric, 300, 5::numeric),
      (1,  'Band Pull-Apart',                    1, null::numeric, 300, 5::numeric),
      (2,  'Muscle Clean From Power Position',   3, 5::numeric,    null::integer, 6::numeric),
      (3,  'Front Squat',                        4, 8::numeric,    null::integer, 6::numeric),
      (4,  'Romanian Deadlift (RDL)',            4, 8::numeric,    null::integer, 6::numeric),
      (5,  'Push Press',                         4, 6::numeric,    null::integer, 6::numeric),
      (6,  'Bent Row',                           4, 8::numeric,    null::integer, 6::numeric),
      (7,  'Step-up',                            3, 10::numeric,   null::integer, 6::numeric),
      (8,  'Hip Extension',                      3, 12::numeric,   null::integer, 6::numeric),
      (9,  'Pallof Press',                       3, 10::numeric,   null::integer, 6::numeric),
      (10, 'Butterfly Adduction',                1, null::numeric, 300, 4::numeric),
      (11, 'Snow Angel',                         1, null::numeric, 300, 4::numeric)
    ) as plan(position, exercise_name, set_count, rep_count, duration_seconds, target_rpe)
    order by plan.position
  loop
    select candidate.*
    into exercise_row
    from public.exercises candidate
    where candidate.scope = 'global'
      and candidate.archived_at is null
      and candidate.video_url is not null
      and lower(trim(candidate.name)) = lower(trim(plan_row.exercise_name))
    order by
      (candidate.source_provider = 'catalyst-athletics') desc,
      candidate.created_at,
      candidate.id
    limit 1;

    if exercise_row.id is null then
      raise exception 'Missing video-backed exercise: %', plan_row.exercise_name;
    end if;

    item_id := gen_random_uuid();

    insert into public.workout_items (
      id, section_id, source_exercise_id, snapshot_name, snapshot_cue,
      entry_mode, tracking_fields, position
    ) values (
      item_id,
      target_section_id,
      exercise_row.id,
      exercise_row.name,
      exercise_row.cue,
      exercise_row.default_entry_mode,
      exercise_row.default_tracking_fields,
      plan_row.position
    );

    for entry_position in 0..(plan_row.set_count - 1) loop
      insert into public.prescribed_entries (
        workout_item_id, position, reps_min, reps_max, duration_seconds,
        target_rpe_min, target_rpe_max
      ) values (
        item_id,
        entry_position,
        plan_row.rep_count,
        plan_row.rep_count,
        plan_row.duration_seconds,
        plan_row.target_rpe,
        plan_row.target_rpe
      );
    end loop;
  end loop;

  if 12 <> (
    select count(*)
    from public.workout_items item
    where item.section_id = target_section_id
  ) then
    raise exception 'Elina workout creation verification failed';
  end if;
end;
$$;
