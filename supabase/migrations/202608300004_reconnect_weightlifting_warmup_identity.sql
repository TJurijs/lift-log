-- Legacy plans may reference an older personal/seed exercise with the same
-- snapshot name. Reconnect those items to the canonical global movement; the
-- immutable prescription snapshot and completed results remain unchanged.

alter table public.workout_items
  disable trigger guard_workout_items_draft;

update public.workout_items item
set source_exercise_id = canonical.id
from (
  select exercise.id
  from public.exercises exercise
  where exercise.scope = 'global'
    and exercise.owner_id is null
    and exercise.archived_at is null
    and lower(trim(exercise.name)) = 'weightlifting warmup'
  order by exercise.created_at, exercise.id
  limit 1
) canonical
where lower(trim(item.snapshot_name)) = 'weightlifting warmup'
  and item.source_exercise_id is distinct from canonical.id;

alter table public.workout_items
  enable trigger guard_workout_items_draft;
