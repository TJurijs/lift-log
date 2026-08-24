-- Apply only after the compatible dev frontend passes its first smoke gate.
-- This closes the temporary rollback window left by migration 202608240005.

revoke insert, update, delete on public.session_entries
  from anon, authenticated;
revoke execute on function public.complete_workout_session(uuid, numeric, text)
  from public, anon, authenticated;

select pg_catalog.set_config('search_path', 'public', false);
