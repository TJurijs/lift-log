-- Lightweight Next-workout summaries must carry the workout's real estimate.
-- Patch the existing bounded bootstrap definition in place so its established
-- authorization and payload contract remain otherwise byte-for-byte intact.

begin;

do $$
declare
  function_definition text;
  old_fragment constant text := $fragment$'workoutTitle', workout.title,
            'programTitle', version.title,$fragment$;
  new_fragment constant text := $fragment$'workoutTitle', workout.title,
            'estimatedMinutes', workout.estimated_minutes,
            'programTitle', version.title,$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.get_workspace_bootstrap()'::regprocedure
  ) into function_definition;

  if pg_catalog.strpos(function_definition, old_fragment) = 0 then
    raise exception 'Workspace bootstrap workout summary shape was not recognized';
  end if;

  execute pg_catalog.replace(function_definition, old_fragment, new_fragment);
end;
$$;

commit;
