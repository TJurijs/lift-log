-- Private account settings, reusable program templates, and athlete-owned scheduling.
-- Existing programs, dates, and completed history are preserved. Publishing changes
-- only program content; athletes explicitly prepare and date their own occurrences.

create or replace function private.generate_liftlog_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'LL-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
$$;

alter table public.profiles add column first_name text;
alter table public.profiles add column last_name text;
alter table public.profiles add column liftlog_id text;

update public.profiles
set
  first_name = coalesce(nullif(split_part(trim(display_name), ' ', 1), ''), 'Athlete'),
  last_name = case
    when position(' ' in trim(display_name)) > 0
      then trim(substr(trim(display_name), position(' ' in trim(display_name)) + 1))
    else ''
  end,
  liftlog_id = private.generate_liftlog_id();

alter table public.profiles alter column first_name set not null;
alter table public.profiles alter column last_name set not null;
alter table public.profiles alter column last_name set default '';
alter table public.profiles alter column liftlog_id set not null;
alter table public.profiles alter column liftlog_id set default private.generate_liftlog_id();
alter table public.profiles add constraint profiles_first_name_check
  check (length(trim(first_name)) between 1 and 80);
alter table public.profiles add constraint profiles_last_name_check
  check (length(trim(last_name)) <= 80);
alter table public.profiles add constraint profiles_liftlog_id_check
  check (liftlog_id ~ '^LL-[A-Z0-9]{16}$');
create unique index idx_profiles_liftlog_id on public.profiles (lower(liftlog_id));

create or replace function private.sync_profile_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.first_name := trim(new.first_name);
  new.last_name := trim(new.last_name);
  if new.first_name = '' then raise exception 'First name is required'; end if;
  new.display_name := trim(new.first_name || ' ' || new.last_name);
  new.liftlog_id := upper(trim(new.liftlog_id));

  if tg_op = 'UPDATE' and new.liftlog_id is distinct from old.liftlog_id
    and coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'LiftLog ID cannot be changed';
  end if;
  return new;
end;
$$;

create trigger sync_profile_identity
before insert or update on public.profiles
for each row execute function private.sync_profile_identity();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_kind text := case
    when new.raw_app_meta_data ->> 'account_kind' = 'test' then 'test'
    else 'real'
  end;
  resolved_persona text := nullif(trim(new.raw_app_meta_data ->> 'test_persona_key'), '');
  full_name_value text := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'Athlete'), '@', 1)
  );
  first_name_value text := nullif(trim(new.raw_user_meta_data ->> 'given_name'), '');
  last_name_value text := nullif(trim(new.raw_user_meta_data ->> 'family_name'), '');
  requested_liftlog_id text := upper(nullif(trim(new.raw_app_meta_data ->> 'liftlog_id'), ''));
begin
  if resolved_kind = 'real' then
    resolved_persona := null;
    requested_liftlog_id := null;
  end if;
  if resolved_kind = 'test' and resolved_persona is null then
    raise exception 'Test accounts require a persona key';
  end if;
  if requested_liftlog_id is not null and requested_liftlog_id !~ '^LL-[A-Z0-9]{16}$' then
    raise exception 'Invalid managed LiftLog ID';
  end if;

  if first_name_value is null then
    first_name_value := coalesce(nullif(split_part(full_name_value, ' ', 1), ''), 'Athlete');
  end if;
  if last_name_value is null then
    last_name_value := case
      when position(' ' in full_name_value) > 0
        then trim(substr(full_name_value, position(' ' in full_name_value) + 1))
      else ''
    end;
  end if;

  insert into public.profiles (
    id, display_name, first_name, last_name, liftlog_id, avatar_url, timezone,
    account_kind, test_persona_key
  ) values (
    new.id, trim(first_name_value || ' ' || last_name_value), first_name_value,
    last_name_value, coalesce(requested_liftlog_id, private.generate_liftlog_id()),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''), 'UTC', resolved_kind,
    resolved_persona
  ) on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.update_own_profile(target_first_name text, target_last_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  updated_profile public.profiles%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(target_first_name, ''))) not between 1 and 80 then
    raise exception 'First name must be between 1 and 80 characters';
  end if;
  if length(trim(coalesce(target_last_name, ''))) > 80 then
    raise exception 'Surname must be 80 characters or fewer';
  end if;

  update public.profiles
  set first_name = trim(target_first_name), last_name = trim(coalesce(target_last_name, ''))
  where id = current_user_id
  returning * into updated_profile;
  if updated_profile.id is null then raise exception 'Profile not found'; end if;

  return jsonb_build_object(
    'id', updated_profile.id,
    'firstName', updated_profile.first_name,
    'lastName', updated_profile.last_name,
    'displayName', updated_profile.display_name,
    'liftlogId', updated_profile.liftlog_id
  );
end;
$$;

-- Registered invite targets are bound to their profile ID. Their private email is
-- never stored in an ID-based invitation or exposed to the inviting athlete.
drop trigger if exists protect_coach_invite_identity on public.coach_invites;
drop index if exists public.idx_coach_invites_one_pending_target;
alter table public.coach_invites alter column invited_email drop not null;
alter table public.coach_invites add column invited_profile_id uuid;
alter table public.coach_invites add column target_identifier_kind text not null default 'email'
  check (target_identifier_kind in ('email', 'id'));

update public.coach_invites invite
set invited_profile_id = auth_user.id, invited_email = null
from auth.users auth_user
join public.profiles target_profile on target_profile.id = auth_user.id
where lower(auth_user.email) = lower(invite.invited_email)
  and target_profile.account_kind = invite.account_kind;

alter table public.coach_invites add constraint coach_invites_target_check check (
  (invited_profile_id is not null and invited_email is null) or
  (invited_profile_id is null and invited_email is not null)
);
alter table public.coach_invites add constraint coach_invites_target_identifier_check check (
  target_identifier_kind = 'email' or invited_profile_id is not null
);
alter table public.coach_invites add constraint coach_invites_target_kind_fk
  foreign key (invited_profile_id, account_kind)
  references public.profiles (id, account_kind) on delete cascade;

create unique index idx_coach_invites_one_pending_email
  on public.coach_invites (athlete_id, lower(invited_email))
  where status = 'pending' and invited_profile_id is null;
create unique index idx_coach_invites_one_pending_profile
  on public.coach_invites (athlete_id, invited_profile_id)
  where status = 'pending' and invited_profile_id is not null;

drop policy if exists coach_invites_read_participant on public.coach_invites;
create policy coach_invites_read_participant on public.coach_invites for select to authenticated
using (
  athlete_id = (select auth.uid()) or (
    account_kind = (
      select profile.account_kind from public.profiles profile
      where profile.id = (select auth.uid())
    )
    and (
      invited_profile_id = (select auth.uid())
      or (
        invited_profile_id is null
        and lower(invited_email) = lower((select auth.jwt() ->> 'email'))
      )
    )
  )
);

create or replace function private.enforce_invite_account_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  athlete_kind text;
  target_user_id uuid;
  target_kind text;
begin
  select profile.account_kind into athlete_kind
  from public.profiles profile where profile.id = new.athlete_id;
  if athlete_kind is null or new.account_kind <> athlete_kind then
    raise exception 'Invitation account kind must match its athlete';
  end if;

  target_user_id := new.invited_profile_id;
  if target_user_id is null and new.invited_email is not null then
    select auth_user.id into target_user_id
    from auth.users auth_user where lower(auth_user.email) = lower(new.invited_email) limit 1;
  end if;
  if target_user_id = new.athlete_id then raise exception 'You cannot coach yourself'; end if;
  if target_user_id is not null then
    select profile.account_kind into target_kind from public.profiles profile where profile.id = target_user_id;
    if target_kind is null or target_kind <> new.account_kind then
      raise exception 'Real and test accounts cannot exchange coaching invitations';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_invite_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.athlete_id <> old.athlete_id
    or lower(coalesce(new.invited_email, '')) <> lower(coalesce(old.invited_email, ''))
    or new.invited_profile_id is distinct from old.invited_profile_id
    or new.target_identifier_kind <> old.target_identifier_kind
    or new.token_hash <> old.token_hash
    or new.account_kind <> old.account_kind then
    raise exception 'Coach invitation identity cannot be changed';
  end if;
  return new;
end;
$$;

create trigger protect_coach_invite_identity
before update on public.coach_invites
for each row execute function public.protect_invite_identity();

create or replace function public.resolve_coach_invite_target(target_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_kind text;
  normalized text := trim(coalesce(target_identifier, ''));
  target_user_id uuid;
  target_email text;
  target_profile public.profiles%rowtype;
  identifier_kind text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select profile.account_kind into current_kind from public.profiles profile where profile.id = current_user_id;
  if current_kind is null then raise exception 'Profile not found'; end if;

  if position('@' in normalized) > 1 then
    identifier_kind := 'email';
    target_email := lower(normalized);
    select auth_user.id into target_user_id
    from auth.users auth_user where lower(auth_user.email) = target_email limit 1;
    if target_user_id is null then
      if current_kind = 'test' then raise exception 'Test accounts can invite only existing test accounts'; end if;
      return jsonb_build_object(
        'registered', false,
        'identifierType', 'email',
        'displayName', target_email,
        'liftlogId', null
      );
    end if;
  elsif upper(normalized) ~ '^LL-[A-Z0-9]{16}$' then
    identifier_kind := 'id';
    select profile.id into target_user_id
    from public.profiles profile where lower(profile.liftlog_id) = lower(normalized) limit 1;
    if target_user_id is null then raise exception 'No account matches that LiftLog ID'; end if;
  else
    raise exception 'Enter an email address or LiftLog ID';
  end if;

  if target_user_id = current_user_id then raise exception 'You cannot coach yourself'; end if;
  select * into target_profile from public.profiles profile where profile.id = target_user_id;
  if target_profile.id is null or target_profile.account_kind <> current_kind then
    raise exception 'No available account matches that email or LiftLog ID';
  end if;
  if exists (
    select 1 from public.coach_relationships relationship
    where relationship.athlete_id = current_user_id
      and relationship.coach_id = target_user_id
      and relationship.ended_at is null
  ) then raise exception 'This coach already has access'; end if;

  return jsonb_build_object(
    'registered', true,
    'identifierType', identifier_kind,
    'displayName', target_profile.display_name,
    'liftlogId', case when identifier_kind = 'id' then target_profile.liftlog_id else null end
  );
end;
$$;

create or replace function public.create_coach_invite(target_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  current_kind text;
  normalized_identifier text := trim(coalesce(target_email, ''));
  normalized_email text;
  target_user_id uuid;
  target_kind text;
  identifier_kind text;
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
  invitation_id uuid;
  expiration timestamptz := now() + interval '7 days';
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select profile.account_kind into current_kind
  from public.profiles profile where profile.id = current_user_id;
  if current_kind is null then raise exception 'Profile not found'; end if;

  if upper(normalized_identifier) ~ '^LL-[A-Z0-9]{16}$' then
    identifier_kind := 'id';
    select profile.id into target_user_id
    from public.profiles profile
    where lower(profile.liftlog_id) = lower(normalized_identifier)
    limit 1;
    if target_user_id is null then raise exception 'No account matches that LiftLog ID'; end if;
  elsif position('@' in normalized_identifier) > 1 then
    identifier_kind := 'email';
    normalized_email := lower(normalized_identifier);
    select auth_user.id into target_user_id
    from auth.users auth_user where lower(auth_user.email) = normalized_email limit 1;
  else
    raise exception 'Enter an email address or LiftLog ID';
  end if;

  if target_user_id is null and (normalized_email is null or normalized_email = '') then
    raise exception 'A valid email address is required';
  end if;
  if (normalized_email is not null and normalized_email = current_email) or target_user_id = current_user_id then
    raise exception 'You cannot coach yourself';
  end if;
  if target_user_id is not null then
    select profile.account_kind into target_kind from public.profiles profile where profile.id = target_user_id;
  end if;
  if current_kind = 'test' and coalesce(target_kind, 'real') <> 'test' then
    raise exception 'Test accounts can invite only existing test accounts';
  end if;
  if current_kind = 'real' and target_kind = 'test' then
    raise exception 'Real accounts cannot invite test accounts';
  end if;
  if target_user_id is not null and exists (
    select 1 from public.coach_relationships relationship
    where relationship.athlete_id = current_user_id
      and relationship.coach_id = target_user_id
      and relationship.ended_at is null
  ) then raise exception 'This coach already has access'; end if;

  update public.coach_invites set status = 'revoked'
  where athlete_id = current_user_id and status = 'pending'
    and (
      (target_user_id is not null and invited_profile_id = target_user_id)
      or (target_user_id is null and invited_profile_id is null and lower(invited_email) = normalized_email)
    );
  insert into public.coach_invites (
    athlete_id, invited_email, invited_profile_id, target_identifier_kind,
    token_hash, status, expires_at, account_kind
  ) values (
    current_user_id, case when target_user_id is null then normalized_email else null end,
    target_user_id, identifier_kind,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'), 'pending', expiration, current_kind
  ) returning id into invitation_id;

  return jsonb_build_object('id', invitation_id, 'token', raw_token, 'expiresAt', expiration);
end;
$$;

create or replace function public.accept_coach_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.coach_invites%rowtype;
  relationship_id uuid;
  current_user_id uuid := (select auth.uid());
  current_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  athlete_kind text;
  coach_kind text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into invitation
  from public.coach_invites invite
  where invite.token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex')
  for update;
  if invitation.id is null or invitation.status <> 'pending' or invitation.expires_at <= now() then
    raise exception 'Invitation is invalid or expired';
  end if;
  if invitation.invited_profile_id is not null then
    if invitation.invited_profile_id <> current_user_id then
      raise exception 'Invitation belongs to another account';
    end if;
  elsif current_email = '' or lower(invitation.invited_email) <> current_email then
    raise exception 'Invitation belongs to another account';
  end if;
  if invitation.athlete_id = current_user_id then raise exception 'You cannot coach yourself'; end if;

  select profile.account_kind into athlete_kind from public.profiles profile where profile.id = invitation.athlete_id;
  select profile.account_kind into coach_kind from public.profiles profile where profile.id = current_user_id;
  if athlete_kind is null or coach_kind is null or athlete_kind <> coach_kind then
    raise exception 'Real and test accounts cannot form coaching relationships';
  end if;
  if exists (
    select 1 from public.coach_relationships relationship
    where relationship.athlete_id = invitation.athlete_id
      and relationship.coach_id = current_user_id
      and relationship.ended_at is null
  ) then raise exception 'This coaching relationship is already active'; end if;

  insert into public.coach_relationships (athlete_id, coach_id, account_kind)
  values (invitation.athlete_id, current_user_id, invitation.account_kind)
  returning id into relationship_id;
  update public.coach_invites set status = 'accepted', accepted_at = now() where id = invitation.id;
  return relationship_id;
end;
$$;

create table public.program_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  planning_mode text not null check (planning_mode in ('repeating_week', 'fixed_weeks')),
  week_count integer not null check (week_count between 1 and 52),
  source_label text not null default 'LiftLog library',
  workouts jsonb not null check (jsonb_typeof(workouts) = 'array' and jsonb_array_length(workouts) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.program_templates enable row level security;
create policy program_templates_read_active on public.program_templates for select to authenticated
using (is_active);
grant select on public.program_templates to authenticated;
grant select, insert, update, delete on public.program_templates to service_role;

alter table public.programs add column source_type text not null default 'self'
  check (source_type in ('self', 'coach', 'library'));
alter table public.programs add column source_label text not null default '';
alter table public.programs add column template_id uuid references public.program_templates(id) on delete restrict;

-- Programs are created through the source-aware RPCs below. Keeping direct inserts
-- would let a browser forge library or coach provenance.
drop policy if exists programs_create_authorized on public.programs;

update public.programs program
set
  source_type = case when program.created_by_id = program.athlete_id then 'self' else 'coach' end,
  source_label = case
    when program.created_by_id = program.athlete_id then 'Created by you'
    else 'Created by ' || coalesce((select profile.display_name from public.profiles profile where profile.id = program.created_by_id), 'coach')
  end;

create or replace function private.protect_program_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.athlete_id <> old.athlete_id
    or new.created_by_id <> old.created_by_id
    or new.source_type <> old.source_type
    or new.source_label <> old.source_label
    or new.template_id is distinct from old.template_id then
    raise exception 'Program ownership and source cannot be changed';
  end if;
  return new;
end;
$$;

alter table public.scheduled_workouts add column scheduled_by_id uuid;
update public.scheduled_workouts set scheduled_by_id = athlete_id;
alter table public.scheduled_workouts alter column scheduled_by_id set not null;
alter table public.scheduled_workouts
  add constraint scheduled_workouts_scheduled_by_fk
  foreign key (scheduled_by_id) references public.profiles(id) on delete cascade;
alter table public.scheduled_workouts
  add constraint scheduled_workouts_athlete_schedules_self check (scheduled_by_id = athlete_id);

create or replace function private.protect_schedule_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.athlete_id <> old.athlete_id
    or new.program_version_id <> old.program_version_id
    or new.workout_id <> old.workout_id
    or new.scheduled_by_id <> old.scheduled_by_id
  ) then raise exception 'Scheduled workout identity cannot be changed'; end if;
  if new.scheduled_by_id <> new.athlete_id then
    raise exception 'Only the athlete can own a calendar placement';
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
  ) then raise exception 'Scheduled workout must belong to a published version owned by the athlete'; end if;
  return new;
end;
$$;

insert into public.program_templates (id, slug, title, description, planning_mode, week_count, workouts) values
(
  '10000000-0000-4000-8000-000000000001', 'flexible-strength-3', 'Flexible Strength',
  'Three balanced strength sessions with simple warmups and room to progress.', 'fixed_weeks', 4,
  '[
    {"title":"Full body A","minutes":50,"sections":[
      {"title":"Warm-up","kind":"warmup","items":[{"title":"5 min easy movement","cue":"Raise your temperature gradually.","mode":"none","fields":[]}]},
      {"title":"Main work","kind":"main","items":[
        {"exercise":"Back squat","title":"Back squat","cue":"Controlled reps; leave two in reserve.","mode":"sets","fields":["reps","load","rpe"],"sets":3,"reps":6,"rpe":7},
        {"exercise":"Bench press","title":"Bench press","cue":"Stay tight and move smoothly.","mode":"sets","fields":["reps","load","rpe"],"sets":3,"reps":8,"rpe":7}
      ]}
    ]},
    {"title":"Full body B","minutes":50,"sections":[{"title":"Main work","kind":"main","items":[
      {"exercise":"Romanian deadlift","title":"Romanian deadlift","cue":"Hips back and bar close.","mode":"sets","fields":["reps","load","rpe"],"sets":3,"reps":8,"rpe":7},
      {"exercise":"Pull-up","title":"Pull-up","cue":"Use assistance when needed.","mode":"sets","fields":["reps","rpe"],"sets":3,"reps":6,"rpe":8}
    ]}]},
    {"title":"Strength + easy cardio","minutes":55,"sections":[
      {"title":"Strength","kind":"main","items":[{"exercise":"Back squat","title":"Back squat","cue":"Crisp, repeatable sets.","mode":"sets","fields":["reps","load","rpe"],"sets":3,"reps":5,"rpe":7}]},
      {"title":"Cardio","kind":"conditioning","items":[{"exercise":"Zone 2 bike","title":"Zone 2 bike","cue":"Conversational pace.","mode":"result","fields":["duration","distance","rpe"],"durationSeconds":1200,"rpe":5}]},
      {"title":"Cooldown","kind":"cooldown","items":[{"title":"Easy breathing","cue":"Let your breathing settle.","mode":"none","fields":[]}]}
    ]}
  ]'::jsonb
),
(
  '10000000-0000-4000-8000-000000000002', 'bodybuilding-2', 'Bodybuilding Essentials',
  'Two full-body hypertrophy sessions that fit around a busy week.', 'fixed_weeks', 4,
  '[
    {"title":"Upper emphasis","minutes":55,"sections":[{"title":"Main work","kind":"main","items":[
      {"exercise":"Bench press","title":"Bench press","cue":"Controlled lowering and a strong finish.","mode":"sets","fields":["reps","load","rpe"],"sets":4,"reps":8,"rpe":8},
      {"exercise":"Pull-up","title":"Pull-up","cue":"Full range with assistance if needed.","mode":"sets","fields":["reps","rpe"],"sets":4,"reps":8,"rpe":8},
      {"exercise":"Romanian deadlift","title":"Romanian deadlift","cue":"Keep tension through the hamstrings.","mode":"sets","fields":["reps","load","rpe"],"sets":3,"reps":10,"rpe":8}
    ]}]},
    {"title":"Lower emphasis","minutes":55,"sections":[{"title":"Main work","kind":"main","items":[
      {"exercise":"Back squat","title":"Back squat","cue":"Use a controlled tempo.","mode":"sets","fields":["reps","load","rpe"],"sets":4,"reps":8,"rpe":8},
      {"exercise":"Push-up","title":"Push-up","cue":"Stop just before form changes.","mode":"sets","fields":["reps","rpe"],"sets":3,"reps":12,"rpe":8},
      {"exercise":"Plank","title":"Plank","cue":"Strong position and calm breathing.","mode":"result","fields":["duration","rpe"],"durationSeconds":60,"rpe":7}
    ]}]}
  ]'::jsonb
),
(
  '10000000-0000-4000-8000-000000000003', 'cardio-reset-1', 'Cardio Reset',
  'One approachable aerobic session per week with mobility and no strength bias.', 'fixed_weeks', 6,
  '[
    {"title":"Easy aerobic session","minutes":40,"sections":[
      {"title":"Preparation","kind":"warmup","items":[{"exercise":"Full-body mobility flow","title":"Mobility flow","cue":"Move slowly through a comfortable range.","mode":"none","fields":[]}]},
      {"title":"Aerobic work","kind":"conditioning","items":[{"exercise":"Easy run","title":"Easy run or walk","cue":"Keep the effort conversational.","mode":"result","fields":["duration","distance","heartRate","rpe"],"durationSeconds":1800,"rpe":5}]},
      {"title":"Cooldown","kind":"cooldown","items":[{"title":"5 min easy walk","cue":"Finish feeling better than you started.","mode":"none","fields":[]}]}
    ]}
  ]'::jsonb
)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  planning_mode = excluded.planning_mode,
  week_count = excluded.week_count,
  workouts = excluded.workouts,
  is_active = true;

create or replace function private.populate_program_from_template(target_version_id uuid, target_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.program_templates%rowtype;
  phase_id uuid;
  week_id uuid;
  workout_id uuid;
  section_id uuid;
  item_id uuid;
  exercise_id uuid;
  workout_entry record;
  section_entry record;
  item_entry record;
begin
  select * into template_row from public.program_templates template where template.id = target_template_id and template.is_active;
  if template_row.id is null then raise exception 'Program template is unavailable'; end if;

  insert into public.program_phases (program_version_id, name, position)
  values (target_version_id, 'Foundation', 0) returning id into phase_id;

  for week_number in 1..template_row.week_count loop
    insert into public.program_weeks (program_version_id, phase_id, week_index, label)
    values (target_version_id, phase_id, week_number, 'Week ' || week_number)
    returning id into week_id;

    for workout_entry in
      select value as item, ordinality::integer - 1 as position
      from jsonb_array_elements(template_row.workouts) with ordinality
    loop
      insert into public.workouts (
        program_week_id, title, day_of_week, schedule_label, position, estimated_minutes
      ) values (
        week_id, workout_entry.item ->> 'title', null,
        'Workout ' || (workout_entry.position + 1), workout_entry.position,
        coalesce((workout_entry.item ->> 'minutes')::integer, 45)
      ) returning id into workout_id;

      for section_entry in
        select value as item, ordinality::integer - 1 as position
        from jsonb_array_elements(workout_entry.item -> 'sections') with ordinality
      loop
        insert into public.workout_sections (workout_id, title, section_kind, position)
        values (
          workout_id, section_entry.item ->> 'title',
          coalesce(section_entry.item ->> 'kind', 'custom'), section_entry.position
        ) returning id into section_id;

        for item_entry in
          select value as item, ordinality::integer - 1 as position
          from jsonb_array_elements(section_entry.item -> 'items') with ordinality
        loop
          exercise_id := null;
          if item_entry.item ? 'exercise' then
            select exercise.id into exercise_id from public.exercises exercise
            where exercise.scope = 'global' and exercise.name = item_entry.item ->> 'exercise'
              and exercise.archived_at is null
            order by exercise.created_at limit 1;
          end if;
          insert into public.workout_items (
            section_id, source_exercise_id, snapshot_name, snapshot_cue,
            entry_mode, tracking_fields, position
          ) values (
            section_id, exercise_id, item_entry.item ->> 'title',
            coalesce(item_entry.item ->> 'cue', ''), item_entry.item ->> 'mode',
            coalesce(array(select jsonb_array_elements_text(item_entry.item -> 'fields')), array[]::text[]),
            item_entry.position
          ) returning id into item_id;

          if item_entry.item ->> 'mode' = 'sets' then
            for set_position in 0..greatest(coalesce((item_entry.item ->> 'sets')::integer, 1) - 1, 0) loop
              insert into public.prescribed_entries (
                workout_item_id, position, reps_min, reps_max, target_rpe_min, target_rpe_max
              ) values (
                item_id, set_position, (item_entry.item ->> 'reps')::numeric,
                (item_entry.item ->> 'reps')::numeric, (item_entry.item ->> 'rpe')::numeric,
                (item_entry.item ->> 'rpe')::numeric
              );
            end loop;
          elsif item_entry.item ->> 'mode' <> 'none' then
            insert into public.prescribed_entries (
              workout_item_id, position, duration_seconds, distance_metres, rounds,
              work_seconds, rest_seconds, target_rpe_min, target_rpe_max
            ) values (
              item_id, 0, (item_entry.item ->> 'durationSeconds')::integer,
              (item_entry.item ->> 'distanceMetres')::numeric,
              (item_entry.item ->> 'rounds')::integer,
              (item_entry.item ->> 'workSeconds')::integer,
              (item_entry.item ->> 'restSeconds')::integer,
              (item_entry.item ->> 'rpe')::numeric,
              (item_entry.item ->> 'rpe')::numeric
            );
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
end;
$$;

create or replace function public.create_blank_program(
  target_athlete_id uuid,
  target_title text,
  target_planning_mode text default 'fixed_weeks'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  resolved_athlete_id uuid := coalesce(target_athlete_id, (select auth.uid()));
  program_id uuid;
  version_id uuid;
  phase_id uuid;
  author_name text;
  source_kind text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if resolved_athlete_id <> current_user_id and not public.is_active_coach(resolved_athlete_id) then
    raise exception 'Not authorized to create this program';
  end if;
  if length(trim(coalesce(target_title, ''))) not between 1 and 120 then
    raise exception 'Program title must be between 1 and 120 characters';
  end if;
  if target_planning_mode not in ('repeating_week', 'fixed_weeks') then
    raise exception 'Invalid planning mode';
  end if;
  if exists (select 1 from public.programs where athlete_id = resolved_athlete_id and is_current and archived_at is null) then
    raise exception 'This athlete already has a current program';
  end if;

  select profile.display_name into author_name from public.profiles profile where profile.id = current_user_id;
  source_kind := case when resolved_athlete_id = current_user_id then 'self' else 'coach' end;
  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label
  ) values (
    resolved_athlete_id, current_user_id, trim(target_title), '', target_planning_mode,
    true, source_kind,
    case when source_kind = 'self' then 'Created by you' else 'Created by ' || author_name end
  ) returning id into program_id;
  insert into public.program_versions (program_id, authored_by_id, version_number, status)
  values (program_id, current_user_id, 1, 'draft') returning id into version_id;
  insert into public.program_phases (program_version_id, name, position)
  values (version_id, 'Plan', 0) returning id into phase_id;
  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (version_id, phase_id, 1, 'Week 1');
  return program_id;
end;
$$;

create or replace function public.create_program_from_template(target_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  template_row public.program_templates%rowtype;
  program_id uuid;
  published_version_id uuid;
  sequence_value integer := 0;
  workout_row record;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if exists (select 1 from public.programs where athlete_id = current_user_id and is_current and archived_at is null) then
    raise exception 'You already have a current program';
  end if;
  select * into template_row from public.program_templates template where template.id = target_template_id and template.is_active;
  if template_row.id is null then raise exception 'Program template is unavailable'; end if;

  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label, template_id
  ) values (
    current_user_id, current_user_id, template_row.title, template_row.description,
    template_row.planning_mode, true, 'library', template_row.source_label, template_row.id
  ) returning id into program_id;
  insert into public.program_versions (program_id, authored_by_id, version_number, status)
  values (program_id, current_user_id, 1, 'draft')
  returning id into published_version_id;
  perform private.populate_program_from_template(published_version_id, template_row.id);
  update public.program_versions
  set status = 'published', effective_from = current_date, published_at = now()
  where id = published_version_id;

  for workout_row in
    select workout.id
    from public.program_weeks week
    join public.workouts workout on workout.program_week_id = week.id
    where week.program_version_id = published_version_id
    order by week.week_index, workout.position
  loop
    sequence_value := sequence_value + 1;
    insert into public.scheduled_workouts (
      athlete_id, scheduled_by_id, program_version_id, workout_id, planned_date, sequence_number, status
    ) values (
      current_user_id, current_user_id, published_version_id, workout_row.id, null, sequence_value, 'planned'
    );
  end loop;
  perform public.create_program_draft(program_id);
  return program_id;
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
  select version.program_id
  into target_program_id
  from public.program_versions version
  join public.programs program on program.id = version.program_id
  where version.id = target_version_id and version.status = 'draft'
  for update of version;
  if target_program_id is null then raise exception 'Draft program version not found'; end if;
  if not public.can_edit_program(target_program_id) then raise exception 'Not authorized to publish this program'; end if;
  if effective_on is null then raise exception 'An effective date is required'; end if;
  if not exists (
    select 1 from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_version_id
  ) then raise exception 'A program must contain at least one workout'; end if;

  update public.program_versions set status = 'superseded'
  where program_id = target_program_id and status = 'published';
  update public.program_versions set status = 'published', effective_from = effective_on
  where id = target_version_id;
  perform public.create_program_draft(target_program_id);
  return target_version_id;
end;
$$;

drop policy if exists scheduled_workouts_create_authorized on public.scheduled_workouts;
drop policy if exists scheduled_workouts_update_authorized on public.scheduled_workouts;
drop policy if exists scheduled_workouts_delete_owner on public.scheduled_workouts;
revoke insert, update, delete on public.scheduled_workouts from authenticated;
create unique index idx_scheduled_workouts_version_workout_sequence
  on public.scheduled_workouts (program_version_id, workout_id, sequence_number)
  where sequence_number is not null;

create or replace function public.prepare_program_schedule(target_program_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_athlete_id uuid;
  workout_row record;
  sequence_value integer := 0;
  inserted_count integer := 0;
  affected_count integer := 0;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select program.athlete_id into target_athlete_id
  from public.program_versions version
  join public.programs program on program.id = version.program_id
  where version.id = target_program_version_id and version.status = 'published';
  if target_athlete_id is null then raise exception 'Published program not found'; end if;
  if target_athlete_id <> current_user_id then
    raise exception 'Only the athlete can prepare calendar workouts';
  end if;

  for workout_row in
    select workout.id
    from public.program_weeks week
    join public.workouts workout on workout.program_week_id = week.id
    where week.program_version_id = target_program_version_id
    order by week.week_index, workout.position
  loop
    sequence_value := sequence_value + 1;
    insert into public.scheduled_workouts (
      athlete_id, scheduled_by_id, program_version_id, workout_id,
      planned_date, sequence_number, status
    ) values (
      current_user_id, current_user_id, target_program_version_id, workout_row.id,
      null, sequence_value, 'planned'
    ) on conflict do nothing;
    get diagnostics affected_count = row_count;
    inserted_count := inserted_count + affected_count;
  end loop;
  return inserted_count;
end;
$$;

create or replace function public.schedule_workout(
  target_scheduled_workout_id uuid,
  target_planned_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  updated_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  update public.scheduled_workouts
  set planned_date = target_planned_date
  where id = target_scheduled_workout_id
    and athlete_id = current_user_id
    and status = 'planned'
  returning id into updated_id;
  if updated_id is null then raise exception 'This workout cannot be scheduled'; end if;
  return updated_id;
end;
$$;

-- Keep fixture resets safe after registered invitation targets moved from email
-- addresses to private profile IDs. The exact persona-key set is verified inside
-- the same transaction before any fixture data is removed.
drop function public.reset_test_population(text);
create function public.reset_test_population(expected_namespace text, expected_persona_keys text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  test_ids uuid[];
  test_emails text[];
  actual_keys text[];
  expected_keys text[];
  removed_count integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Test population reset requires the service role';
  end if;
  if expected_namespace is null or expected_namespace !~ '^[a-z0-9-]+-v[0-9]+$' then
    raise exception 'A valid fixture namespace is required';
  end if;

  if expected_persona_keys is null or cardinality(expected_persona_keys) = 0
    or cardinality(expected_persona_keys) <> (
      select count(distinct key_value) from unnest(expected_persona_keys) as persona_key(key_value)
    ) then
    raise exception 'An exact, unique fixture persona set is required';
  end if;
  select array_agg(expected_namespace || ':' || key_value order by key_value)
  into expected_keys from unnest(expected_persona_keys) as persona_key(key_value);

  select array_agg(profile.id), count(profile.id)::integer,
         array_agg(profile.test_persona_key order by profile.test_persona_key)
  into test_ids, removed_count, actual_keys
  from public.profiles profile
  where profile.account_kind = 'test'
    and profile.test_persona_key like expected_namespace || ':%';

  if test_ids is null then
    if cardinality(expected_persona_keys) > 0 then
      return jsonb_build_object('removed', 0, 'namespace', expected_namespace);
    end if;
  end if;
  if actual_keys is distinct from expected_keys then
    raise exception 'Fixture namespace does not match the exact expected persona set; reset aborted';
  end if;
  select array_agg(lower(auth_user.email)) into test_emails
  from auth.users auth_user where auth_user.id = any(test_ids);

  if exists (
    select 1 from public.coach_relationships relationship
    where (relationship.athlete_id = any(test_ids) and not (relationship.coach_id = any(test_ids)))
       or (relationship.coach_id = any(test_ids) and not (relationship.athlete_id = any(test_ids)))
  ) then raise exception 'Fixture accounts connect to another namespace; reset aborted'; end if;

  if exists (
    select 1 from public.coach_invites invite
    where (invite.athlete_id = any(test_ids)
      and invite.invited_profile_id is not null
      and not (invite.invited_profile_id = any(test_ids)))
      or (invite.invited_profile_id = any(test_ids)
      and not (invite.athlete_id = any(test_ids)))
  ) or exists (
    select 1 from public.coach_invites invite
    join auth.users invited_user on lower(invited_user.email) = lower(invite.invited_email)
    where invite.athlete_id = any(test_ids)
      and not (invited_user.id = any(test_ids))
  ) or exists (
    select 1 from public.coach_invites invite
    where not (invite.athlete_id = any(test_ids))
      and invite.invited_email is not null
      and lower(invite.invited_email) = any(test_emails)
  ) then raise exception 'Fixture invitations cross namespace boundaries; reset aborted'; end if;

  if exists (
    select 1 from public.programs program
    where program.created_by_id = any(test_ids)
      and not (program.athlete_id = any(test_ids))
  ) or exists (
    select 1 from public.program_versions version
    join public.programs program on program.id = version.program_id
    where version.authored_by_id = any(test_ids)
      and not (program.athlete_id = any(test_ids))
  ) or exists (
    select 1 from public.programs program
    where program.athlete_id = any(test_ids)
      and not (program.created_by_id = any(test_ids))
  ) or exists (
    select 1 from public.program_versions version
    join public.programs program on program.id = version.program_id
    where program.athlete_id = any(test_ids)
      and not (version.authored_by_id = any(test_ids))
  ) then raise exception 'Fixture programs cross namespace boundaries; reset aborted'; end if;

  if exists (
    select 1 from public.workout_items item
    join public.exercises exercise on exercise.id = item.source_exercise_id
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    join public.program_versions version on version.id = week.program_version_id
    join public.programs program on program.id = version.program_id
    where exercise.owner_id = any(test_ids)
      and not (program.athlete_id = any(test_ids))
  ) then raise exception 'Fixture exercises are referenced outside the namespace; reset aborted'; end if;

  perform pg_catalog.set_config('liftlog.test_reset', 'on', true);
  delete from public.coach_feedback feedback
  where feedback.athlete_id = any(test_ids) or feedback.coach_id = any(test_ids);
  delete from public.workout_sessions session where session.athlete_id = any(test_ids);
  delete from public.scheduled_workouts scheduled where scheduled.athlete_id = any(test_ids);
  delete from public.programs program where program.athlete_id = any(test_ids);
  delete from public.coach_invites invite
  where invite.athlete_id = any(test_ids)
    or invite.invited_profile_id = any(test_ids)
    or (invite.invited_email is not null and lower(invite.invited_email) = any(test_emails));
  delete from public.coach_relationships relationship
  where relationship.athlete_id = any(test_ids) or relationship.coach_id = any(test_ids);
  delete from public.exercises exercise where exercise.owner_id = any(test_ids);
  perform pg_catalog.set_config('liftlog.test_reset', 'off', true);

  return jsonb_build_object('removed', removed_count, 'namespace', expected_namespace);
exception when others then
  perform pg_catalog.set_config('liftlog.test_reset', 'off', true);
  raise;
end;
$$;

revoke all on function private.generate_liftlog_id() from public, anon, authenticated;
revoke all on function private.sync_profile_identity() from public, anon, authenticated;
revoke all on function private.populate_program_from_template(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_own_profile(text, text) from public;
revoke all on function public.resolve_coach_invite_target(text) from public;
revoke all on function public.create_blank_program(uuid, text, text) from public;
revoke all on function public.create_program_from_template(uuid) from public;
revoke all on function public.prepare_program_schedule(uuid) from public;
revoke all on function public.schedule_workout(uuid, date) from public;
revoke all on function public.reset_test_population(text, text[]) from public, anon, authenticated;
grant execute on function public.update_own_profile(text, text) to authenticated;
grant execute on function public.resolve_coach_invite_target(text) to authenticated;
grant execute on function public.create_blank_program(uuid, text, text) to authenticated;
grant execute on function public.create_program_from_template(uuid) to authenticated;
grant execute on function public.prepare_program_schedule(uuid) to authenticated;
grant execute on function public.schedule_workout(uuid, date) to authenticated;
grant execute on function public.reset_test_population(text, text[]) to service_role;

-- The old read-triggered starter RPC would recreate training merely by opening
-- the app. New program creation is always an explicit user or coach action.
revoke execute on function public.ensure_starter_program(uuid) from authenticated;

select pg_catalog.set_config('search_path', 'public', false);
