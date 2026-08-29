-- Some environments already contain this built-in exercise from an older seed,
-- where it was classified as General. Correct the canonical row in place so
-- every workout that references it receives the Weightlifting icon.

update public.exercises exercise
set
  category = 'Weightlifting',
  updated_at = now()
where exercise.scope = 'global'
  and exercise.owner_id is null
  and lower(trim(exercise.name)) = 'weightlifting warmup'
  and exercise.category is distinct from 'Weightlifting';
