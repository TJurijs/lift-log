create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  timezone text not null default 'UTC',
  load_unit text not null default 'kg' check (load_unit in ('kg', 'lb')),
  distance_unit text not null default 'km' check (distance_unit in ('km', 'mi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'personal')),
  owner_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  category text not null default 'General',
  cue text not null default '',
  default_entry_mode text not null check (default_entry_mode in ('none', 'sets', 'result', 'intervals')),
  default_tracking_fields text[] not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercises_scope_owner_check check (
    (scope = 'global' and owner_id is null) or
    (scope = 'personal' and owner_id is not null)
  )
);

create table public.coach_invites (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  invited_email text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coach_relationships (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_relationships_not_self check (athlete_id <> coach_id)
);

create unique index idx_coach_relationships_one_active_coach
on public.coach_relationships (athlete_id)
where ended_at is null;

create unique index idx_coach_relationships_active_pair
on public.coach_relationships (athlete_id, coach_id)
where ended_at is null;

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  created_by_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text not null default '',
  planning_mode text not null check (planning_mode in ('repeating_week', 'fixed_weeks')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.program_versions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  authored_by_id uuid not null references public.profiles(id) on delete restrict,
  based_on_version_id uuid references public.program_versions(id) on delete set null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  effective_from date,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_versions_number_unique unique (program_id, version_number),
  constraint program_versions_publish_check check (
    (status = 'draft' and published_at is null) or
    (status in ('published', 'superseded') and published_at is not null and effective_from is not null)
  )
);

create unique index idx_program_versions_one_draft
on public.program_versions (program_id)
where status = 'draft';

create table public.program_phases (
  id uuid primary key default gen_random_uuid(),
  program_version_id uuid not null references public.program_versions(id) on delete cascade,
  name text not null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  constraint program_phases_position_unique unique (program_version_id, position)
);

create table public.program_weeks (
  id uuid primary key default gen_random_uuid(),
  program_version_id uuid not null references public.program_versions(id) on delete cascade,
  phase_id uuid references public.program_phases(id) on delete set null,
  week_index integer not null check (week_index > 0),
  label text not null default '',
  created_at timestamptz not null default now(),
  constraint program_weeks_index_unique unique (program_version_id, week_index)
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  program_week_id uuid not null references public.program_weeks(id) on delete cascade,
  title text not null,
  day_of_week smallint check (day_of_week between 1 and 7),
  position integer not null check (position >= 0),
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workouts_position_unique unique (program_week_id, position)
);

create table public.workout_sections (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  title text not null,
  section_kind text not null default 'custom' check (section_kind in ('warmup', 'main', 'conditioning', 'cooldown', 'custom')),
  notes text not null default '',
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  constraint workout_sections_position_unique unique (workout_id, position)
);

create table public.workout_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.workout_sections(id) on delete cascade,
  source_exercise_id uuid references public.exercises(id) on delete set null,
  snapshot_name text not null,
  snapshot_cue text not null default '',
  entry_mode text not null check (entry_mode in ('none', 'sets', 'result', 'intervals')),
  tracking_fields text[] not null default '{}',
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  constraint workout_items_position_unique unique (section_id, position)
);

create table public.prescribed_entries (
  id uuid primary key default gen_random_uuid(),
  workout_item_id uuid not null references public.workout_items(id) on delete cascade,
  position integer not null check (position >= 0),
  reps_min numeric check (reps_min is null or reps_min >= 0),
  reps_max numeric check (reps_max is null or reps_max >= 0),
  load_kg numeric check (load_kg is null or load_kg >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  distance_metres numeric check (distance_metres is null or distance_metres >= 0),
  rounds integer check (rounds is null or rounds >= 0),
  work_seconds integer check (work_seconds is null or work_seconds >= 0),
  rest_seconds integer check (rest_seconds is null or rest_seconds >= 0),
  target_rpe_min numeric check (target_rpe_min is null or target_rpe_min between 1 and 10),
  target_rpe_max numeric check (target_rpe_max is null or target_rpe_max between 1 and 10),
  target_text text,
  created_at timestamptz not null default now(),
  constraint prescribed_entries_position_unique unique (workout_item_id, position)
);

create table public.scheduled_workouts (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  program_version_id uuid not null references public.program_versions(id) on delete restrict,
  workout_id uuid not null references public.workouts(id) on delete restrict,
  planned_date date,
  sequence_number integer,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_workouts_occurrence_check check (planned_date is not null or sequence_number is not null)
);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  scheduled_workout_id uuid references public.scheduled_workouts(id) on delete restrict,
  program_version_id uuid references public.program_versions(id) on delete restrict,
  workout_id uuid references public.workouts(id) on delete restrict,
  workout_title text not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  session_rpe numeric check (session_rpe is null or session_rpe between 1 and 10),
  athlete_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_sessions_completion_check check (
    (status = 'completed' and completed_at is not null) or
    (status <> 'completed')
  )
);

create unique index idx_workout_sessions_one_active_schedule
on public.workout_sessions (scheduled_workout_id)
where scheduled_workout_id is not null and status in ('in_progress', 'completed');

create table public.session_item_logs (
  id uuid primary key default gen_random_uuid(),
  workout_session_id uuid not null references public.workout_sessions(id) on delete cascade,
  source_workout_item_id uuid references public.workout_items(id) on delete set null,
  snapshot_name text not null,
  snapshot_cue text not null default '',
  entry_mode text not null check (entry_mode in ('none', 'sets', 'result', 'intervals')),
  tracking_fields text[] not null default '{}',
  position integer not null check (position >= 0),
  athlete_note text not null default '',
  created_at timestamptz not null default now(),
  constraint session_item_logs_position_unique unique (workout_session_id, position)
);

create table public.session_entries (
  id uuid primary key default gen_random_uuid(),
  session_item_log_id uuid not null references public.session_item_logs(id) on delete cascade,
  position integer not null check (position >= 0),
  reps numeric check (reps is null or reps >= 0),
  load_kg numeric check (load_kg is null or load_kg >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  distance_metres numeric check (distance_metres is null or distance_metres >= 0),
  rounds integer check (rounds is null or rounds >= 0),
  heart_rate integer check (heart_rate is null or heart_rate > 0),
  rpe numeric check (rpe is null or rpe between 1 and 10),
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint session_entries_position_unique unique (session_item_log_id, position)
);

create table public.coach_feedback (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  workout_session_id uuid references public.workout_sessions(id) on delete cascade,
  message text not null check (length(message) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_feedback_not_self check (athlete_id <> coach_id)
);

create index idx_exercises_owner_active on public.exercises (owner_id) where archived_at is null;
create index idx_coach_invites_athlete_status on public.coach_invites (athlete_id, status);
create index idx_coach_invites_email_status on public.coach_invites (lower(invited_email), status);
create index idx_coach_relationships_coach_active on public.coach_relationships (coach_id) where ended_at is null;
create index idx_programs_athlete_active on public.programs (athlete_id) where archived_at is null;
create index idx_program_versions_program_status on public.program_versions (program_id, status);
create index idx_scheduled_workouts_athlete_date on public.scheduled_workouts (athlete_id, planned_date);
create index idx_workout_sessions_athlete_started on public.workout_sessions (athlete_id, started_at desc);
create index idx_coach_feedback_athlete_created on public.coach_feedback (athlete_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, timezone)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'Athlete'), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    'UTC'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_active_coach(target_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.coach_relationships relationship
    where relationship.athlete_id = target_athlete_id
      and relationship.coach_id = (select auth.uid())
      and relationship.ended_at is null
  );
$$;

create or replace function public.can_read_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.programs program
    where program.id = target_program_id
      and (
        program.athlete_id = (select auth.uid()) or
        public.is_active_coach(program.athlete_id)
      )
  );
$$;

create or replace function public.can_edit_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_read_program(target_program_id);
$$;

create or replace function public.can_read_version(target_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.program_versions version
    where version.id = target_version_id
      and public.can_read_program(version.program_id)
  );
$$;

create or replace function public.can_edit_version(target_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.program_versions version
    where version.id = target_version_id
      and version.status = 'draft'
      and public.can_edit_program(version.program_id)
  );
$$;

create or replace function public.protect_published_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.program_id <> old.program_id or new.authored_by_id <> old.authored_by_id or new.version_number <> old.version_number then
    raise exception 'Program version identity cannot be changed';
  end if;
  if old.status in ('published', 'superseded') then
    raise exception 'Published program versions are immutable';
  end if;
  if new.status in ('published', 'superseded') and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

create trigger protect_published_program_version
before update on public.program_versions
for each row execute function public.protect_published_version();

create or replace function public.protect_coaching_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.athlete_id <> old.athlete_id or new.coach_id <> old.coach_id or new.accepted_at <> old.accepted_at then
    raise exception 'Coaching relationship identity cannot be changed';
  end if;
  if old.ended_at is not null or new.ended_at is null then
    raise exception 'A coaching relationship can only transition from active to ended';
  end if;
  return new;
end;
$$;

create trigger protect_coach_relationship_identity
before update on public.coach_relationships
for each row execute function public.protect_coaching_identity();

create or replace function public.protect_invite_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.athlete_id <> old.athlete_id or lower(new.invited_email) <> lower(old.invited_email) or new.token_hash <> old.token_hash then
    raise exception 'Coach invitation identity cannot be changed';
  end if;
  return new;
end;
$$;

create trigger protect_coach_invite_identity
before update on public.coach_invites
for each row execute function public.protect_invite_identity();

create or replace function private.resolve_tree_version(table_name text, parent_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_version uuid;
begin
  case table_name
    when 'program_phases' then resolved_version := parent_id;
    when 'program_weeks' then resolved_version := parent_id;
    when 'workouts' then
      select week.program_version_id into resolved_version from public.program_weeks week where week.id = parent_id;
    when 'workout_sections' then
      select week.program_version_id into resolved_version
      from public.workouts workout join public.program_weeks week on week.id = workout.program_week_id
      where workout.id = parent_id;
    when 'workout_items' then
      select week.program_version_id into resolved_version
      from public.workout_sections section
      join public.workouts workout on workout.id = section.workout_id
      join public.program_weeks week on week.id = workout.program_week_id
      where section.id = parent_id;
    when 'prescribed_entries' then
      select week.program_version_id into resolved_version
      from public.workout_items item
      join public.workout_sections section on section.id = item.section_id
      join public.workouts workout on workout.id = section.workout_id
      join public.program_weeks week on week.id = workout.program_week_id
      where item.id = parent_id;
    else raise exception 'Unknown program tree table: %', table_name;
  end case;
  return resolved_version;
end;
$$;

create or replace function private.assert_draft_program_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_column text := tg_argv[0];
  old_parent uuid;
  new_parent uuid;
  old_version uuid;
  new_version uuid;
begin
  if tg_op <> 'INSERT' then
    old_parent := (to_jsonb(old) ->> parent_column)::uuid;
    old_version := private.resolve_tree_version(tg_table_name, old_parent);
    if not exists (select 1 from public.program_versions version where version.id = old_version and version.status = 'draft') then
      raise exception 'Published program content is immutable';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    new_parent := (to_jsonb(new) ->> parent_column)::uuid;
    new_version := private.resolve_tree_version(tg_table_name, new_parent);
    if not exists (select 1 from public.program_versions version where version.id = new_version and version.status = 'draft') then
      raise exception 'Program content can only be changed in a draft version';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger guard_program_phases_draft before insert or update or delete on public.program_phases
for each row execute function private.assert_draft_program_tree('program_version_id');
create trigger guard_program_weeks_draft before insert or update or delete on public.program_weeks
for each row execute function private.assert_draft_program_tree('program_version_id');

create or replace function private.validate_week_phase()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phase_id is not null and not exists (
    select 1 from public.program_phases phase
    where phase.id = new.phase_id and phase.program_version_id = new.program_version_id
  ) then
    raise exception 'Program week phase must belong to the same version';
  end if;
  return new;
end;
$$;

create trigger validate_program_week_phase before insert or update on public.program_weeks
for each row execute function private.validate_week_phase();
create trigger guard_workouts_draft before insert or update or delete on public.workouts
for each row execute function private.assert_draft_program_tree('program_week_id');
create trigger guard_workout_sections_draft before insert or update or delete on public.workout_sections
for each row execute function private.assert_draft_program_tree('workout_id');
create trigger guard_workout_items_draft before insert or update or delete on public.workout_items
for each row execute function private.assert_draft_program_tree('section_id');
create trigger guard_prescribed_entries_draft before insert or update or delete on public.prescribed_entries
for each row execute function private.assert_draft_program_tree('workout_item_id');

create or replace function private.resolve_history_session(table_name text, parent_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_session uuid;
begin
  if table_name = 'session_item_logs' then
    resolved_session := parent_id;
  elsif table_name = 'session_entries' then
    select item.workout_session_id into resolved_session from public.session_item_logs item where item.id = parent_id;
  else
    raise exception 'Unknown history table: %', table_name;
  end if;
  return resolved_session;
end;
$$;

create or replace function private.assert_in_progress_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_column text := tg_argv[0];
  old_session uuid;
  new_session uuid;
begin
  if tg_op <> 'INSERT' then
    old_session := private.resolve_history_session(tg_table_name, (to_jsonb(old) ->> parent_column)::uuid);
    if not exists (select 1 from public.workout_sessions session where session.id = old_session and session.status = 'in_progress') then
      raise exception 'Completed workout history is immutable';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    new_session := private.resolve_history_session(tg_table_name, (to_jsonb(new) ->> parent_column)::uuid);
    if not exists (select 1 from public.workout_sessions session where session.id = new_session and session.status = 'in_progress') then
      raise exception 'Workout results can only change while the session is in progress';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger guard_session_item_history before insert or update or delete on public.session_item_logs
for each row execute function private.assert_in_progress_history('workout_session_id');
create trigger guard_session_entry_history before insert or update or delete on public.session_entries
for each row execute function private.assert_in_progress_history('session_item_log_id');

create or replace function private.protect_session_identity_and_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' and old.status = 'completed' then
    raise exception 'Completed workout sessions are immutable';
  end if;
  if tg_op = 'UPDATE' and (
    new.athlete_id <> old.athlete_id or
    new.scheduled_workout_id is distinct from old.scheduled_workout_id or
    new.program_version_id is distinct from old.program_version_id or
    new.workout_id is distinct from old.workout_id
  ) then
    raise exception 'Workout session identity cannot be changed';
  end if;
  if tg_op <> 'DELETE' and new.scheduled_workout_id is not null and not exists (
    select 1 from public.scheduled_workouts scheduled
    where scheduled.id = new.scheduled_workout_id
      and scheduled.athlete_id = new.athlete_id
      and (new.program_version_id is null or scheduled.program_version_id = new.program_version_id)
      and (new.workout_id is null or scheduled.workout_id = new.workout_id)
  ) then
    raise exception 'Workout session does not match its scheduled workout';
  end if;
  if tg_op <> 'DELETE' and new.workout_id is not null and new.program_version_id is not null and not exists (
    select 1
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    join public.program_versions version on version.id = week.program_version_id
    join public.programs program on program.id = version.program_id
    where workout.id = new.workout_id
      and version.id = new.program_version_id
      and program.athlete_id = new.athlete_id
  ) then
    raise exception 'Workout session program lineage is invalid';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_workout_session_history before insert or update or delete on public.workout_sessions
for each row execute function private.protect_session_identity_and_completion();

create or replace function private.protect_program_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.athlete_id <> old.athlete_id or new.created_by_id <> old.created_by_id then
    raise exception 'Program ownership cannot be changed';
  end if;
  return new;
end;
$$;

create trigger protect_program_ownership before update on public.programs
for each row execute function private.protect_program_identity();

create or replace function private.protect_schedule_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.athlete_id <> old.athlete_id or new.program_version_id <> old.program_version_id or new.workout_id <> old.workout_id) then
    raise exception 'Scheduled workout identity cannot be changed';
  end if;
  if not exists (
    select 1
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    join public.program_versions version on version.id = week.program_version_id
    join public.programs program on program.id = version.program_id
    where workout.id = new.workout_id
      and version.id = new.program_version_id
      and program.athlete_id = new.athlete_id
      and version.status in ('published', 'superseded')
  ) then
    raise exception 'Scheduled workout must belong to a published version owned by the athlete';
  end if;
  return new;
end;
$$;

create trigger protect_scheduled_workout_identity before insert or update on public.scheduled_workouts
for each row execute function private.protect_schedule_identity();

create or replace function private.protect_feedback_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.athlete_id <> old.athlete_id or new.coach_id <> old.coach_id or new.workout_session_id is distinct from old.workout_session_id) then
    raise exception 'Coach feedback identity cannot be changed';
  end if;
  if new.workout_session_id is not null and not exists (
    select 1 from public.workout_sessions session
    where session.id = new.workout_session_id and session.athlete_id = new.athlete_id
  ) then
    raise exception 'Coach feedback session does not belong to the athlete';
  end if;
  return new;
end;
$$;

create trigger protect_coach_feedback_identity before insert or update on public.coach_feedback
for each row execute function private.protect_feedback_identity();

create or replace function public.accept_coach_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.coach_invites%rowtype;
  relationship_id uuid;
  current_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if (select auth.uid()) is null or current_email = '' then
    raise exception 'Authentication required';
  end if;
  select * into invitation
  from public.coach_invites invite
  where invite.token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex')
  for update;
  if invitation.id is null or invitation.status <> 'pending' or invitation.expires_at <= now() then
    raise exception 'Invitation is invalid or expired';
  end if;
  if lower(invitation.invited_email) <> current_email then
    raise exception 'Invitation belongs to another account';
  end if;
  if invitation.athlete_id = (select auth.uid()) then
    raise exception 'You cannot coach yourself';
  end if;

  insert into public.coach_relationships (athlete_id, coach_id)
  values (invitation.athlete_id, (select auth.uid()))
  returning id into relationship_id;

  update public.coach_invites
  set status = 'accepted', accepted_at = now()
  where id = invitation.id;

  return relationship_id;
end;
$$;

create or replace function public.publish_program_version(target_version_id uuid, effective_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_program_id uuid;
begin
  select version.program_id into target_program_id
  from public.program_versions version
  where version.id = target_version_id and version.status = 'draft'
  for update;

  if target_program_id is null then
    raise exception 'Draft program version not found';
  end if;
  if not public.can_edit_program(target_program_id) then
    raise exception 'Not authorized to publish this program';
  end if;
  if effective_on is null then
    raise exception 'An effective date is required';
  end if;

  update public.program_versions
  set status = 'published', effective_from = effective_on
  where id = target_version_id;

  return target_version_id;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger exercises_set_updated_at before update on public.exercises for each row execute function public.set_updated_at();
create trigger coach_invites_set_updated_at before update on public.coach_invites for each row execute function public.set_updated_at();
create trigger coach_relationships_set_updated_at before update on public.coach_relationships for each row execute function public.set_updated_at();
create trigger programs_set_updated_at before update on public.programs for each row execute function public.set_updated_at();
create trigger program_versions_set_updated_at before update on public.program_versions for each row execute function public.set_updated_at();
create trigger workouts_set_updated_at before update on public.workouts for each row execute function public.set_updated_at();
create trigger scheduled_workouts_set_updated_at before update on public.scheduled_workouts for each row execute function public.set_updated_at();
create trigger workout_sessions_set_updated_at before update on public.workout_sessions for each row execute function public.set_updated_at();
create trigger coach_feedback_set_updated_at before update on public.coach_feedback for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.exercises enable row level security;
alter table public.coach_invites enable row level security;
alter table public.coach_relationships enable row level security;
alter table public.programs enable row level security;
alter table public.program_versions enable row level security;
alter table public.program_phases enable row level security;
alter table public.program_weeks enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_sections enable row level security;
alter table public.workout_items enable row level security;
alter table public.prescribed_entries enable row level security;
alter table public.scheduled_workouts enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.session_item_logs enable row level security;
alter table public.session_entries enable row level security;
alter table public.coach_feedback enable row level security;

create policy profiles_read_connected on public.profiles for select to authenticated
using (
  id = (select auth.uid()) or
  exists (
    select 1 from public.coach_relationships relationship
    where relationship.ended_at is null
      and ((relationship.athlete_id = profiles.id and relationship.coach_id = (select auth.uid()))
        or (relationship.coach_id = profiles.id and relationship.athlete_id = (select auth.uid())))
  )
);
create policy profiles_update_self on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy exercises_read_available on public.exercises for select to authenticated
using (scope = 'global' or owner_id = (select auth.uid()));
create policy exercises_create_personal on public.exercises for insert to authenticated
with check (scope = 'personal' and owner_id = (select auth.uid()));
create policy exercises_update_personal on public.exercises for update to authenticated
using (scope = 'personal' and owner_id = (select auth.uid()))
with check (scope = 'personal' and owner_id = (select auth.uid()));
create policy exercises_delete_personal on public.exercises for delete to authenticated
using (scope = 'personal' and owner_id = (select auth.uid()));

create policy coach_invites_read_participant on public.coach_invites for select to authenticated
using (athlete_id = (select auth.uid()) or lower(invited_email) = lower((select auth.jwt() ->> 'email')));
create policy coach_invites_create_athlete on public.coach_invites for insert to authenticated
with check (athlete_id = (select auth.uid()));
create policy coach_invites_revoke_athlete on public.coach_invites for update to authenticated
using (athlete_id = (select auth.uid()) and status = 'pending')
with check (athlete_id = (select auth.uid()) and status in ('pending', 'revoked'));
create policy coach_invites_delete_athlete on public.coach_invites for delete to authenticated
using (athlete_id = (select auth.uid()));

create policy coach_relationships_read_participant on public.coach_relationships for select to authenticated
using (athlete_id = (select auth.uid()) or coach_id = (select auth.uid()));
create policy coach_relationships_end_participant on public.coach_relationships for update to authenticated
using (athlete_id = (select auth.uid()) or coach_id = (select auth.uid()))
with check (athlete_id = (select auth.uid()) or coach_id = (select auth.uid()));

create policy programs_read_authorized on public.programs for select to authenticated
using (athlete_id = (select auth.uid()) or public.is_active_coach(athlete_id));
create policy programs_create_authorized on public.programs for insert to authenticated
with check (
  created_by_id = (select auth.uid()) and
  (athlete_id = (select auth.uid()) or public.is_active_coach(athlete_id))
);
create policy programs_update_authorized on public.programs for update to authenticated
using (athlete_id = (select auth.uid()) or public.is_active_coach(athlete_id))
with check (athlete_id = (select auth.uid()) or public.is_active_coach(athlete_id));
create policy programs_delete_owner on public.programs for delete to authenticated
using (athlete_id = (select auth.uid()));

create policy program_versions_read_authorized on public.program_versions for select to authenticated
using (public.can_read_program(program_id));
create policy program_versions_create_authorized on public.program_versions for insert to authenticated
with check (status = 'draft' and authored_by_id = (select auth.uid()) and public.can_edit_program(program_id));
create policy program_versions_update_draft on public.program_versions for update to authenticated
using (status = 'draft' and public.can_edit_program(program_id))
with check (status = 'draft' and public.can_edit_program(program_id));
create policy program_versions_delete_draft on public.program_versions for delete to authenticated
using (status = 'draft' and public.can_edit_program(program_id));

create policy program_phases_read_authorized on public.program_phases for select to authenticated
using (public.can_read_version(program_version_id));
create policy program_phases_write_draft on public.program_phases for all to authenticated
using (public.can_edit_version(program_version_id)) with check (public.can_edit_version(program_version_id));

create policy program_weeks_read_authorized on public.program_weeks for select to authenticated
using (public.can_read_version(program_version_id));
create policy program_weeks_write_draft on public.program_weeks for all to authenticated
using (public.can_edit_version(program_version_id)) with check (public.can_edit_version(program_version_id));

create policy workouts_read_authorized on public.workouts for select to authenticated
using (exists (select 1 from public.program_weeks week where week.id = workouts.program_week_id and public.can_read_version(week.program_version_id)));
create policy workouts_write_draft on public.workouts for all to authenticated
using (exists (select 1 from public.program_weeks week where week.id = workouts.program_week_id and public.can_edit_version(week.program_version_id)))
with check (exists (select 1 from public.program_weeks week where week.id = workouts.program_week_id and public.can_edit_version(week.program_version_id)));

create policy workout_sections_read_authorized on public.workout_sections for select to authenticated
using (exists (
  select 1 from public.workouts workout join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = workout_sections.workout_id and public.can_read_version(week.program_version_id)
));
create policy workout_sections_write_draft on public.workout_sections for all to authenticated
using (exists (
  select 1 from public.workouts workout join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = workout_sections.workout_id and public.can_edit_version(week.program_version_id)
))
with check (exists (
  select 1 from public.workouts workout join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = workout_sections.workout_id and public.can_edit_version(week.program_version_id)
));

create policy workout_items_read_authorized on public.workout_items for select to authenticated
using (exists (
  select 1 from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where section.id = workout_items.section_id and public.can_read_version(week.program_version_id)
));
create policy workout_items_write_draft on public.workout_items for all to authenticated
using (exists (
  select 1 from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where section.id = workout_items.section_id and public.can_edit_version(week.program_version_id)
))
with check (exists (
  select 1 from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where section.id = workout_items.section_id and public.can_edit_version(week.program_version_id)
));

create policy prescribed_entries_read_authorized on public.prescribed_entries for select to authenticated
using (exists (
  select 1 from public.workout_items item
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where item.id = prescribed_entries.workout_item_id and public.can_read_version(week.program_version_id)
));
create policy prescribed_entries_write_draft on public.prescribed_entries for all to authenticated
using (exists (
  select 1 from public.workout_items item
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where item.id = prescribed_entries.workout_item_id and public.can_edit_version(week.program_version_id)
))
with check (exists (
  select 1 from public.workout_items item
  join public.workout_sections section on section.id = item.section_id
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  where item.id = prescribed_entries.workout_item_id and public.can_edit_version(week.program_version_id)
));

create policy scheduled_workouts_read_authorized on public.scheduled_workouts for select to authenticated
using (athlete_id = (select auth.uid()) or public.is_active_coach(athlete_id));
create policy scheduled_workouts_create_authorized on public.scheduled_workouts for insert to authenticated
with check (athlete_id = (select auth.uid()) or public.is_active_coach(athlete_id));
create policy scheduled_workouts_update_authorized on public.scheduled_workouts for update to authenticated
using (athlete_id = (select auth.uid()) or (public.is_active_coach(athlete_id) and status = 'planned'))
with check (athlete_id = (select auth.uid()) or (public.is_active_coach(athlete_id) and status = 'planned'));
create policy scheduled_workouts_delete_owner on public.scheduled_workouts for delete to authenticated
using (athlete_id = (select auth.uid()) and status = 'planned');

create policy workout_sessions_read_authorized on public.workout_sessions for select to authenticated
using (athlete_id = (select auth.uid()) or public.is_active_coach(athlete_id));
create policy workout_sessions_create_owner on public.workout_sessions for insert to authenticated
with check (athlete_id = (select auth.uid()));
create policy workout_sessions_update_owner on public.workout_sessions for update to authenticated
using (athlete_id = (select auth.uid()) and status = 'in_progress') with check (athlete_id = (select auth.uid()));
create policy workout_sessions_delete_owner on public.workout_sessions for delete to authenticated
using (athlete_id = (select auth.uid()) and status = 'in_progress');

create policy session_item_logs_read_authorized on public.session_item_logs for select to authenticated
using (exists (
  select 1 from public.workout_sessions session
  where session.id = session_item_logs.workout_session_id
    and (session.athlete_id = (select auth.uid()) or public.is_active_coach(session.athlete_id))
));
create policy session_item_logs_write_owner on public.session_item_logs for all to authenticated
using (exists (select 1 from public.workout_sessions session where session.id = session_item_logs.workout_session_id and session.athlete_id = (select auth.uid()) and session.status = 'in_progress'))
with check (exists (select 1 from public.workout_sessions session where session.id = session_item_logs.workout_session_id and session.athlete_id = (select auth.uid()) and session.status = 'in_progress'));

create policy session_entries_read_authorized on public.session_entries for select to authenticated
using (exists (
  select 1 from public.session_item_logs item
  join public.workout_sessions session on session.id = item.workout_session_id
  where item.id = session_entries.session_item_log_id
    and (session.athlete_id = (select auth.uid()) or public.is_active_coach(session.athlete_id))
));
create policy session_entries_write_owner on public.session_entries for all to authenticated
using (exists (
  select 1 from public.session_item_logs item join public.workout_sessions session on session.id = item.workout_session_id
  where item.id = session_entries.session_item_log_id and session.athlete_id = (select auth.uid()) and session.status = 'in_progress'
))
with check (exists (
  select 1 from public.session_item_logs item join public.workout_sessions session on session.id = item.workout_session_id
  where item.id = session_entries.session_item_log_id and session.athlete_id = (select auth.uid()) and session.status = 'in_progress'
));

create policy coach_feedback_read_authorized on public.coach_feedback for select to authenticated
using (athlete_id = (select auth.uid()) or (coach_id = (select auth.uid()) and public.is_active_coach(athlete_id)));
create policy coach_feedback_create_active_coach on public.coach_feedback for insert to authenticated
with check (coach_id = (select auth.uid()) and public.is_active_coach(athlete_id));
create policy coach_feedback_update_author on public.coach_feedback for update to authenticated
using (coach_id = (select auth.uid()) and public.is_active_coach(athlete_id))
with check (coach_id = (select auth.uid()) and public.is_active_coach(athlete_id));
create policy coach_feedback_delete_author on public.coach_feedback for delete to authenticated
using (coach_id = (select auth.uid()));

revoke all on function public.handle_new_user() from public;
revoke all on function public.is_active_coach(uuid) from public;
revoke all on function public.can_read_program(uuid) from public;
revoke all on function public.can_edit_program(uuid) from public;
revoke all on function public.can_read_version(uuid) from public;
revoke all on function public.can_edit_version(uuid) from public;

grant execute on function public.is_active_coach(uuid) to authenticated;
grant execute on function public.can_read_program(uuid) to authenticated;
grant execute on function public.can_edit_program(uuid) to authenticated;
grant execute on function public.can_read_version(uuid) to authenticated;
grant execute on function public.can_edit_version(uuid) to authenticated;
revoke all on function public.accept_coach_invite(text) from public;
revoke all on function public.publish_program_version(uuid, date) from public;
grant execute on function public.accept_coach_invite(text) to authenticated;
grant execute on function public.publish_program_version(uuid, date) to authenticated;

grant usage on schema public to authenticated;
grant usage on schema private to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

select pg_catalog.set_config('search_path', 'public', false);
