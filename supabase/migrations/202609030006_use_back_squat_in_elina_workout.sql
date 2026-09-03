-- Prefer the familiar back squat in Elina's general-fitness workout.

do $$
declare
  replacement public.exercises%rowtype;
begin
  select candidate.*
  into replacement
  from public.exercises candidate
  where candidate.scope = 'global'
    and candidate.archived_at is null
    and candidate.video_url is not null
    and lower(candidate.name) = 'back squat'
  order by
    (candidate.source_provider = 'catalyst-athletics') desc,
    candidate.created_at,
    candidate.id
  limit 1;

  if replacement.id is null then
    raise exception 'Video-backed Back Squat exercise is missing';
  end if;

  update public.workout_items item
  set source_exercise_id = replacement.id,
      snapshot_name = replacement.name,
      snapshot_cue = replacement.cue,
      entry_mode = replacement.default_entry_mode,
      tracking_fields = replacement.default_tracking_fields
  from public.workout_sections section,
       public.workouts workout,
       public.program_weeks week,
       public.program_versions version,
       public.programs program
  where item.section_id = section.id
    and section.workout_id = workout.id
    and workout.program_week_id = week.id
    and week.program_version_id = version.id
    and version.program_id = program.id
    and program.title = 'Elina — General Fitness'
    and program.content_type = 'quick_workout'
    and program.archived_at is null
    and lower(item.snapshot_name) = 'front squat';
end;
$$;
