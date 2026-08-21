-- Multiple active coaches are a supported relationship graph. Test identities are
-- explicitly marked so development fixtures cannot connect to real accounts.

alter table public.profiles
add column account_kind text not null default 'real'
check (account_kind in ('real', 'test'));

alter table public.profiles
add column test_persona_key text;

alter table public.profiles
add constraint profiles_test_persona_check check (
  (account_kind = 'real' and test_persona_key is null) or
  (account_kind = 'test' and test_persona_key is not null)
);

create unique index idx_profiles_test_persona_key
on public.profiles (test_persona_key)
where test_persona_key is not null;

alter table public.profiles
add constraint profiles_id_account_kind_unique unique (id, account_kind);

alter table public.coach_invites add column account_kind text;
update public.coach_invites invite
set account_kind = profile.account_kind
from public.profiles profile
where profile.id = invite.athlete_id;
alter table public.coach_invites alter column account_kind set not null;
alter table public.coach_invites alter column account_kind set default 'real';
alter table public.coach_invites
add constraint coach_invites_account_kind_check check (account_kind in ('real', 'test'));
alter table public.coach_invites
add constraint coach_invites_athlete_kind_fk
foreign key (athlete_id, account_kind)
references public.profiles (id, account_kind) on delete cascade;

alter table public.coach_relationships add column account_kind text;
update public.coach_relationships relationship
set account_kind = profile.account_kind
from public.profiles profile
where profile.id = relationship.athlete_id;
alter table public.coach_relationships alter column account_kind set not null;
alter table public.coach_relationships alter column account_kind set default 'real';
alter table public.coach_relationships
add constraint coach_relationships_account_kind_check check (account_kind in ('real', 'test'));
alter table public.coach_relationships
add constraint coach_relationships_athlete_kind_fk
foreign key (athlete_id, account_kind)
references public.profiles (id, account_kind) on delete cascade;
alter table public.coach_relationships
add constraint coach_relationships_coach_kind_fk
foreign key (coach_id, account_kind)
references public.profiles (id, account_kind) on delete cascade;

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
begin
  if resolved_kind = 'real' then resolved_persona := null; end if;
  if resolved_kind = 'test' and resolved_persona is null then
    raise exception 'Test accounts require a persona key';
  end if;

  insert into public.profiles (
    id, display_name, avatar_url, timezone, account_kind, test_persona_key
  ) values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'Athlete'), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    'UTC', resolved_kind, resolved_persona
  ) on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.protect_profile_account_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.account_kind is distinct from old.account_kind
    or new.test_persona_key is distinct from old.test_persona_key then
    if coalesce((select auth.role()), '') <> 'service_role' then
      raise exception 'Account kind is managed by trusted maintenance only';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_profile_account_kind
before update on public.profiles
for each row execute function private.protect_profile_account_kind();

drop index if exists public.idx_coach_relationships_one_active_coach;

create unique index idx_coach_invites_one_pending_target
on public.coach_invites (athlete_id, lower(invited_email))
where status = 'pending';

drop policy if exists coach_invites_create_athlete on public.coach_invites;
drop policy if exists coach_invites_read_participant on public.coach_invites;
create policy coach_invites_read_participant on public.coach_invites for select to authenticated
using (
  athlete_id = (select auth.uid()) or (
    lower(invited_email) = lower((select auth.jwt() ->> 'email'))
    and account_kind = (
      select profile.account_kind from public.profiles profile
      where profile.id = (select auth.uid())
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

  select auth_user.id into target_user_id
  from auth.users auth_user
  where lower(auth_user.email) = lower(new.invited_email)
  limit 1;
  if target_user_id = new.athlete_id then raise exception 'You cannot coach yourself'; end if;
  if target_user_id is not null then
    select profile.account_kind into target_kind
    from public.profiles profile where profile.id = target_user_id;
    if target_kind is null or target_kind <> new.account_kind then
      raise exception 'Real and test accounts cannot exchange coaching invitations';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_invite_account_kind
before insert on public.coach_invites
for each row execute function private.enforce_invite_account_kind();

create or replace function private.enforce_coaching_account_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  athlete_kind text;
  coach_kind text;
begin
  select profile.account_kind into athlete_kind
  from public.profiles profile where profile.id = new.athlete_id;
  select profile.account_kind into coach_kind
  from public.profiles profile where profile.id = new.coach_id;

  if athlete_kind is null or coach_kind is null or athlete_kind <> coach_kind then
    raise exception 'Real and test accounts cannot form coaching relationships';
  end if;
  return new;
end;
$$;

create trigger enforce_coaching_account_kind
before insert on public.coach_relationships
for each row execute function private.enforce_coaching_account_kind();

create or replace function public.protect_coaching_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.athlete_id <> old.athlete_id
    or new.coach_id <> old.coach_id
    or new.accepted_at <> old.accepted_at
    or new.account_kind <> old.account_kind then
    raise exception 'Coaching relationship identity cannot be changed';
  end if;
  if old.ended_at is not null or new.ended_at is null then
    raise exception 'A coaching relationship can only transition from active to ended';
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
    or lower(new.invited_email) <> lower(old.invited_email)
    or new.token_hash <> old.token_hash
    or new.account_kind <> old.account_kind then
    raise exception 'Coach invitation identity cannot be changed';
  end if;
  return new;
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
  target_user_id uuid;
  target_kind text;
  normalized_email text := lower(trim(target_email));
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
  invitation_id uuid;
  expiration timestamptz := now() + interval '7 days';
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if normalized_email = '' or position('@' in normalized_email) < 2 then
    raise exception 'A valid email is required';
  end if;
  if normalized_email = current_email then raise exception 'You cannot coach yourself'; end if;

  select profile.account_kind into current_kind
  from public.profiles profile where profile.id = current_user_id;
  select auth_user.id into target_user_id
  from auth.users auth_user where lower(auth_user.email) = normalized_email limit 1;
  if target_user_id is not null then
    select profile.account_kind into target_kind
    from public.profiles profile where profile.id = target_user_id;
  end if;

  if current_kind = 'test' and coalesce(target_kind, 'real') <> 'test' then
    raise exception 'Test accounts can invite only test accounts';
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

  update public.coach_invites
  set status = 'revoked'
  where athlete_id = current_user_id
    and lower(invited_email) = normalized_email
    and status = 'pending';

  insert into public.coach_invites (
    athlete_id, invited_email, token_hash, status, expires_at, account_kind
  ) values (
    current_user_id, normalized_email,
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
  if current_user_id is null or current_email = '' then raise exception 'Authentication required'; end if;
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
  if invitation.athlete_id = current_user_id then raise exception 'You cannot coach yourself'; end if;

  select profile.account_kind into athlete_kind
  from public.profiles profile where profile.id = invitation.athlete_id;
  select profile.account_kind into coach_kind
  from public.profiles profile where profile.id = current_user_id;
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

  update public.coach_invites
  set status = 'accepted', accepted_at = now()
  where id = invitation.id;
  return relationship_id;
end;
$$;

-- Test reset is a tightly scoped maintenance operation. The bypass exists only
-- for deleting immutable fixture snapshots inside reset_test_population().
create or replace function public.protect_published_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('liftlog.test_reset', true) = 'on'
    and coalesce((select auth.role()), '') = 'service_role'
    and old.based_on_version_id is not null
    and new.based_on_version_id is null
    and new.program_id = old.program_id
    and new.authored_by_id = old.authored_by_id
    and new.version_number = old.version_number
    and new.status = old.status
    and new.effective_from is not distinct from old.effective_from
    and new.published_at is not distinct from old.published_at then
    return new;
  end if;

  if new.program_id <> old.program_id or new.authored_by_id <> old.authored_by_id or new.version_number <> old.version_number then
    raise exception 'Program version identity cannot be changed';
  end if;
  if old.status = 'superseded' then
    raise exception 'Superseded program versions are immutable';
  end if;
  if old.status = 'published' then
    if new.status <> 'superseded'
      or new.effective_from is distinct from old.effective_from
      or new.published_at is distinct from old.published_at
      or new.based_on_version_id is distinct from old.based_on_version_id then
      raise exception 'Published program versions are immutable except when superseded';
    end if;
    return new;
  end if;
  if new.status in ('published', 'superseded') and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
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
  if tg_op = 'DELETE'
    and current_setting('liftlog.test_reset', true) = 'on'
    and coalesce((select auth.role()), '') = 'service_role' then
    return old;
  end if;
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
  if tg_op = 'DELETE'
    and current_setting('liftlog.test_reset', true) = 'on'
    and coalesce((select auth.role()), '') = 'service_role' then
    return old;
  end if;
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

create or replace function private.protect_session_identity_and_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('liftlog.test_reset', true) = 'on'
    and coalesce((select auth.role()), '') = 'service_role' then
    return old;
  end if;
  if tg_op <> 'INSERT' and old.status = 'completed' then
    raise exception 'Completed workout sessions are immutable';
  end if;
  if tg_op = 'UPDATE' and (
    new.athlete_id <> old.athlete_id or
    new.scheduled_workout_id is distinct from old.scheduled_workout_id or
    new.program_version_id is distinct from old.program_version_id or
    new.workout_id is distinct from old.workout_id
  ) then raise exception 'Workout session identity cannot be changed'; end if;
  if tg_op <> 'DELETE' and new.scheduled_workout_id is not null and not exists (
    select 1 from public.scheduled_workouts scheduled
    where scheduled.id = new.scheduled_workout_id
      and scheduled.athlete_id = new.athlete_id
      and (new.program_version_id is null or scheduled.program_version_id = new.program_version_id)
      and (new.workout_id is null or scheduled.workout_id = new.workout_id)
  ) then raise exception 'Workout session does not match its scheduled workout'; end if;
  if tg_op <> 'DELETE' and new.workout_id is not null and new.program_version_id is not null and not exists (
    select 1 from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    join public.program_versions version on version.id = week.program_version_id
    join public.programs program on program.id = version.program_id
    where workout.id = new.workout_id
      and version.id = new.program_version_id
      and program.athlete_id = new.athlete_id
  ) then raise exception 'Workout session program lineage is invalid'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.reset_test_population(expected_namespace text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  test_ids uuid[];
  test_emails text[];
  removed_count integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Test population reset requires the service role';
  end if;
  if expected_namespace is null or expected_namespace !~ '^[a-z0-9-]+-v[0-9]+$' then
    raise exception 'A valid fixture namespace is required';
  end if;

  select array_agg(profile.id), count(profile.id)::integer
  into test_ids, removed_count
  from public.profiles profile
  where profile.account_kind = 'test'
    and profile.test_persona_key like expected_namespace || ':%';

  if test_ids is null then
    return jsonb_build_object('removed', 0, 'namespace', expected_namespace);
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
    join auth.users invited_user on lower(invited_user.email) = lower(invite.invited_email)
    where invite.athlete_id = any(test_ids)
      and not (invited_user.id = any(test_ids))
  ) or exists (
    select 1 from public.coach_invites invite
    where not (invite.athlete_id = any(test_ids))
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
  delete from public.coach_invites invite where invite.athlete_id = any(test_ids);
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

revoke all on function public.reset_test_population(text) from public, anon, authenticated;
grant execute on function public.reset_test_population(text) to service_role;

revoke all on function private.protect_profile_account_kind() from public, anon, authenticated;
revoke all on function private.enforce_coaching_account_kind() from public, anon, authenticated;
revoke all on function private.enforce_invite_account_kind() from public, anon, authenticated;

select pg_catalog.set_config('search_path', 'public', false);
