-- Logging format and tracked values describe how a movement is recorded.
-- Category remains visual/search metadata and is deliberately not used here.

create temporary table catalyst_logging_defaults on commit drop as
select
  exercise.id as exercise_id,
  case
    when coalesce(exercise.source_metadata ->> 'sectionId', '') = '19'
      or exercise.name ~* 'sled'
      or exercise.name ~* 'sprint|shuttle|run\y'
      or exercise.name ~* 'stretch|mobility|mobilization|foam roll|rolling|release|massage|breathing|plank|\mhold\y|wall sit|isometric'
      then 'result'
    else 'sets'
  end as entry_mode,
  case
    when coalesce(exercise.source_metadata ->> 'sectionId', '') = '19'
      or exercise.name ~* 'sled'
      then array['distance', 'load', 'rpe']::text[]
    when exercise.name ~* 'sprint|shuttle|run\y'
      then array['distance', 'duration', 'rpe']::text[]
    when exercise.name ~* 'stretch|mobility|mobilization|foam roll|rolling|release|massage|breathing|plank|\mhold\y|wall sit|isometric'
      then case
        when coalesce(exercise.source_metadata ->> 'sectionId', '') = '18'
          then array['duration']::text[]
        when coalesce(exercise.source_metadata ->> 'sectionId', '') in ('8', '9', '10', '11', '13', '17')
          then array['duration', 'load', 'rpe']::text[]
        else array['duration', 'rpe']::text[]
      end
    when coalesce(exercise.source_metadata ->> 'sectionId', '') in ('12', '16', '18')
      or exercise.name ~* '^(strict )?(push-?up|pull-?up|chin-?up|dip|air squat|pistol|inverted row)\y|bodyweight'
      then array['reps', 'rpe']::text[]
    else array['reps', 'load', 'rpe']::text[]
  end as tracking_fields
from public.exercises exercise
where exercise.scope = 'global'
  and exercise.owner_id is null
  and exercise.archived_at is null
  and exercise.source_provider = 'catalyst-athletics';

update public.exercises exercise
set
  default_entry_mode = defaults.entry_mode,
  default_tracking_fields = defaults.tracking_fields,
  updated_at = now()
from catalyst_logging_defaults defaults
where defaults.exercise_id = exercise.id
  and (
    exercise.default_entry_mode is distinct from defaults.entry_mode
    or exercise.default_tracking_fields is distinct from defaults.tracking_fields
  );

-- Existing completed sessions own immutable log snapshots. It is safe to
-- refresh reusable drafts and future planned workout items, but only where the
-- persisted mode already matches so no prescription is silently reinterpreted.
alter table public.workout_items disable trigger guard_workout_items_draft;

update public.workout_items item
set tracking_fields = defaults.tracking_fields
from catalyst_logging_defaults defaults,
  public.workout_sections section,
  public.workouts workout,
  public.program_weeks week,
  public.program_versions version
where item.source_exercise_id = defaults.exercise_id
  and item.entry_mode = defaults.entry_mode
  and section.id = item.section_id
  and workout.id = section.workout_id
  and week.id = workout.program_week_id
  and version.id = week.program_version_id
  and (
    version.status = 'draft'
    or exists (
      select 1
      from public.scheduled_workouts scheduled
      where scheduled.program_version_id = version.id
        and scheduled.workout_id = workout.id
        and scheduled.status = 'planned'
    )
  )
  and item.tracking_fields is distinct from defaults.tracking_fields;

alter table public.workout_items enable trigger guard_workout_items_draft;
