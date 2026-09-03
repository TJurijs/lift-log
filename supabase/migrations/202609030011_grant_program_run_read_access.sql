-- Participant read policies already protect these tables. Grant SELECT so
-- PostgREST can evaluate those policies and return an empty set for an
-- unrelated athlete instead of rejecting the query before RLS runs.
grant select on public.program_runs to authenticated;
grant select on public.program_run_workouts to authenticated;
