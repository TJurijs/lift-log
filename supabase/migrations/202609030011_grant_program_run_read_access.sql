-- Participant read policies already protect these tables. Grant SELECT so
-- PostgREST can evaluate those policies and return an empty set for an
-- unrelated athlete instead of rejecting the query before RLS runs.
grant select on public.program_runs to authenticated;
grant select on public.program_run_workouts to authenticated;

-- Integration fixtures and controlled operational repair use the service role.
-- It bypasses RLS but still requires explicit table privileges in PostgREST.
grant select, insert, update, delete on public.program_runs to service_role;
grant select, insert, update, delete on public.program_run_workouts to service_role;
