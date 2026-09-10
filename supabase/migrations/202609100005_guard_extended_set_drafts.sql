-- Cached clients predating timed/distance sets send null for metrics they
-- cannot render. Require an explicit capability only for these session layouts;
-- legacy repetition sets and interval/result drafts keep their existing API.
-- New clients still send null when the athlete intentionally clears a value.
do $$
declare
  original_definition text;
  updated_definition text;
  guard_definition text := $guard$
  if draft_payload ? 'recordingSchema'
    and draft_payload -> 'recordingSchema' is distinct from '2'::jsonb then
    raise exception 'Refresh LiftLog before saving this workout: the recording format has changed';
  end if;
  if draft_payload -> 'recordingSchema' is distinct from '2'::jsonb
    and exists (
      select 1 from public.session_item_logs item
      where item.workout_session_id = target_session_id
        and item.entry_mode = 'sets'
        and item.tracking_fields && array['duration', 'distance', 'heartRate']::text[]
    ) then
    raise exception 'Refresh LiftLog before saving this workout: this version cannot record all set measurements';
  end if;

$guard$;
begin
  select pg_catalog.pg_get_functiondef(
    'private.validate_workout_draft_payload(uuid,jsonb)'::regprocedure
  ) into original_definition;

  -- The smoke suite may replay this definition after a full migration reset.
  if position(guard_definition in original_definition) > 0 then return; end if;
  updated_definition := replace(original_definition,
    'payload_key.name not in (''items'', ''sessionRpe'', ''sessionNote'')',
    'payload_key.name not in (''items'', ''sessionRpe'', ''sessionNote'', ''recordingSchema'')');
  if updated_definition = original_definition then
    raise exception 'Expected workout draft property guard was not found';
  end if;
  original_definition := updated_definition;
  updated_definition := replace(original_definition,
    '  payload_item_count := jsonb_array_length(draft_payload -> ''items'');',
    guard_definition || '  payload_item_count := jsonb_array_length(draft_payload -> ''items'');');
  if updated_definition = original_definition then
    raise exception 'Expected workout draft validation insertion point was not found';
  end if;
  execute updated_definition;
end;
$$;
