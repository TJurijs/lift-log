-- The built-in weightlifting warmup predates the canonical exercise library.
-- Give it the same durable identity as every other exercise so category icons
-- remain correct in new plans, existing plans, and completed history.

insert into public.exercises (
  scope,
  owner_id,
  name,
  category,
  cue,
  default_entry_mode,
  default_tracking_fields
)
select
  'global',
  null,
  'Weightlifting warmup',
  'Weightlifting',
  'Move through an easy barbell warmup and prepare the positions for today.',
  'none',
  '{}'::text[]
where not exists (
  select 1
  from public.exercises exercise
  where exercise.scope = 'global'
    and exercise.owner_id is null
    and lower(trim(exercise.name)) = 'weightlifting warmup'
);

alter table public.workout_items
  disable trigger guard_workout_items_draft;

update public.workout_items item
set source_exercise_id = exercise.id
from public.exercises exercise
where item.source_exercise_id is null
  and exercise.scope = 'global'
  and exercise.owner_id is null
  and exercise.archived_at is null
  and lower(trim(exercise.name)) = 'weightlifting warmup'
  and lower(trim(item.snapshot_name)) = 'weightlifting warmup';

alter table public.workout_items
  enable trigger guard_workout_items_draft;

alter table public.session_item_logs
  disable trigger guard_session_item_history;

update public.session_item_logs item
set snapshot_category = 'Weightlifting'
where lower(trim(item.snapshot_name)) = 'weightlifting warmup'
  and item.snapshot_category is distinct from 'Weightlifting';

alter table public.session_item_logs
  enable trigger guard_session_item_history;
