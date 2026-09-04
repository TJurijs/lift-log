-- Direct PostgREST writes must not attach an unrelated personal exercise by
-- UUID and expose its category/video through the authorized workout payload.
-- Keep parent draft authorization in the existing permissive write policy.
create policy workout_items_insert_visible_exercise
on public.workout_items
as restrictive
for insert
to authenticated
with check (
  source_exercise_id is null
  or exists (
    select 1 from public.exercises exercise
    where exercise.id = workout_items.source_exercise_id
      and exercise.archived_at is null
      and (exercise.scope = 'global' or exercise.owner_id = (select auth.uid()))
  )
);

-- INSERT protection alone would permit inserting null and changing the
-- reference afterwards. Check only changed references so an authorized copy
-- of a coach's private exercise remains editable without granting access to
-- that coach's exercise library. Invoker rights preserve exercise RLS for
-- direct writes; existing authorized SECURITY DEFINER copy operations retain
-- their permission to preserve source references.
create function private.check_changed_workout_exercise_reference()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.source_exercise_id is distinct from old.source_exercise_id
    and new.source_exercise_id is not null
    and not exists (
      select 1 from public.exercises exercise
      where exercise.id = new.source_exercise_id
    ) then
    raise exception 'Exercise is unavailable';
  end if;
  return new;
end;
$$;

create trigger check_changed_workout_exercise_reference
before update of source_exercise_id on public.workout_items
for each row execute function private.check_changed_workout_exercise_reference();

revoke all on function private.check_changed_workout_exercise_reference()
  from public, anon, authenticated;
