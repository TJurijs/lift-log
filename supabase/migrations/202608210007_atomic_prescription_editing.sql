-- Coaches and self-authors save a complete exercise prescription atomically.
create or replace function public.save_workout_item_prescription(
  target_item_id uuid,
  target_cue text,
  target_mode text,
  target_fields text[],
  target_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  entry jsonb;
  entry_position integer := 0;
begin
  select week.program_version_id into target_version_id
  from public.workout_items item
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where item.id = target_item_id;
  if not public.can_edit_version(target_version_id) then raise exception 'Program version is not editable'; end if;
  if target_mode not in ('none','sets','result','intervals') then raise exception 'Invalid prescription type'; end if;
  if target_fields is null or not target_fields <@ array['reps','load','duration','distance','rounds','heartRate','rpe']::text[] then
    raise exception 'Invalid tracking fields';
  end if;
  if target_mode = 'none' and jsonb_array_length(coalesce(target_entries, '[]'::jsonb)) > 0 then
    raise exception 'Instruction-only items cannot have prescribed entries';
  end if;

  update public.workout_items set snapshot_cue = trim(coalesce(target_cue, '')), entry_mode = target_mode, tracking_fields = target_fields
  where id = target_item_id;
  delete from public.prescribed_entries where workout_item_id = target_item_id;
  for entry in select value from jsonb_array_elements(coalesce(target_entries, '[]'::jsonb))
  loop
    insert into public.prescribed_entries (
      workout_item_id, position, reps_min, reps_max, load_kg, duration_seconds,
      distance_metres, rounds, work_seconds, rest_seconds, target_rpe_min,
      target_rpe_max, target_text
    ) values (
      target_item_id, entry_position,
      nullif(entry ->> 'reps_min', '')::numeric,
      nullif(entry ->> 'reps_max', '')::numeric,
      nullif(entry ->> 'load_kg', '')::numeric,
      nullif(entry ->> 'duration_seconds', '')::integer,
      nullif(entry ->> 'distance_metres', '')::numeric,
      nullif(entry ->> 'rounds', '')::integer,
      nullif(entry ->> 'work_seconds', '')::integer,
      nullif(entry ->> 'rest_seconds', '')::integer,
      nullif(entry ->> 'target_rpe_min', '')::numeric,
      nullif(entry ->> 'target_rpe_max', '')::numeric,
      nullif(entry ->> 'target_text', '')
    );
    entry_position := entry_position + 1;
  end loop;
  return target_item_id;
end;
$$;

revoke all on function public.save_workout_item_prescription(uuid, text, text, text[], jsonb) from public;
grant execute on function public.save_workout_item_prescription(uuid, text, text, text[], jsonb) to authenticated;
