-- Complete the General-section classification after reviewing the imported
-- catalogue in-app. These are weightlifting support movements rather than
-- generic strength exercises.

update public.exercises exercise
set
  category = 'Weightlifting',
  discipline = 'weightlifting',
  tags = array['General Exercises', 'Weightlifting']::text[],
  default_entry_mode = 'sets',
  default_tracking_fields = array['reps', 'load', 'rpe']::text[],
  updated_at = now()
where exercise.source_provider = 'catalyst-athletics'
  and exercise.source_metadata ->> 'sectionId' = '11'
  and exercise.name ~* '(^|[^a-z])(snatch|clean|jerk|push press|first pull|good morning pull)([^a-z]|$)';
