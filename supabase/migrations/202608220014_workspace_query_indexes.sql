-- Supports the Phase 1/2 workspace summary reads and on-demand workout detail.
-- These indexes match the RLS-scoped filter and ordering paths used by the app.

create index if not exists idx_programs_athlete_current_created
  on public.programs (athlete_id, created_at desc)
  where is_current = true and archived_at is null;

create index if not exists idx_program_versions_program_version_desc
  on public.program_versions (program_id, version_number desc);

create index if not exists idx_program_weeks_version_week_index
  on public.program_weeks (program_version_id, week_index);

create index if not exists idx_workouts_week_position
  on public.workouts (program_week_id, position);

create index if not exists idx_workout_sections_workout_position
  on public.workout_sections (workout_id, position);

create index if not exists idx_workout_items_section_position
  on public.workout_items (section_id, position);

create index if not exists idx_prescribed_entries_item_position
  on public.prescribed_entries (workout_item_id, position);

create index if not exists idx_scheduled_workouts_athlete_sequence
  on public.scheduled_workouts (athlete_id, sequence_number);

create index if not exists idx_workout_sessions_athlete_active_started
  on public.workout_sessions (athlete_id, started_at desc)
  where status = 'in_progress';
