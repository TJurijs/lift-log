-- Interval prescriptions contain one row per round, so an in-progress session
-- must be allowed to persist the same ordered shape. Single-result items remain
-- limited to one aggregate entry.
do $$
declare
  original_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'private.validate_workout_draft_payload(uuid,jsonb)'::regprocedure
  )
  into original_definition;

  updated_definition := replace(
    original_definition,
    'item.entry_mode in (''result'', ''intervals'')',
    'item.entry_mode = ''result'''
  );

  if updated_definition = original_definition then
    raise exception 'Expected interval draft entry-count guard was not found';
  end if;

  execute updated_definition;
end;
$$;
