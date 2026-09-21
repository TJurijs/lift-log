-- RPE is an optional recording choice. Built-in exercises no longer select
-- it automatically when added to a new workout. Keep the reviewed movement
-- metrics (reps/weight, bodyweight reps, time, distance, etc.) as they are.
-- Personal exercise defaults are explicit user preferences and are preserved.
-- Existing workout prescriptions, copied workouts and session snapshots retain
-- their original tracking configuration and any recorded effort values.
update public.exercises
set default_tracking_fields = array_remove(default_tracking_fields, 'rpe'),
    updated_at = now()
where scope = 'global'
  and owner_id is null
  and 'rpe' = any(default_tracking_fields);
