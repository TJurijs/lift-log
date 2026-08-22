-- Coaching invitations are account-bound, in-app requests. New requests can only
-- target an existing profile by its exact email address or LiftLog ID; raw invite
-- tokens are no longer returned to the browser.

update public.coach_invites
set status = 'revoked'
where status = 'pending' and invited_profile_id is null;

alter table public.coach_invites
  drop constraint if exists coach_invites_status_check;
alter table public.coach_invites
  add constraint coach_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired'));

alter table public.coach_invites
  add constraint coach_invites_pending_profile_check
  check (status <> 'pending' or invited_profile_id is not null);

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
  target_profile public.profiles%rowtype;
  identifier_kind text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select profile.account_kind into current_kind
  from public.profiles profile where profile.id = current_user_id;
  if current_kind is null then raise exception 'Profile not found'; end if;

  if position('@' in normalized) > 1 then
    identifier_kind := 'email';
    select auth_user.id into target_user_id
    from auth.users auth_user
    where lower(auth_user.email) = lower(normalized)
    limit 1;
  elsif upper(normalized) ~ '^LL-[A-Z0-9]{16}$' then
    identifier_kind := 'id';
    select profile.id into target_user_id
    from public.profiles profile
    where lower(profile.liftlog_id) = lower(normalized)
    limit 1;
  else
    raise exception 'Enter an email address or LiftLog ID';
  end if;

  if target_user_id is null then
    raise exception 'No available account matches that email or LiftLog ID';
  end if;
  if target_user_id = current_user_id then raise exception 'You cannot coach yourself'; end if;

  select * into target_profile
  from public.profiles profile where profile.id = target_user_id;
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
  current_kind text;
  normalized_identifier text := trim(coalesce(target_email, ''));
  target_user_id uuid;
  target_profile public.profiles%rowtype;
  identifier_kind text;
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
  elsif position('@' in normalized_identifier) > 1 then
    identifier_kind := 'email';
    select auth_user.id into target_user_id
    from auth.users auth_user
    where lower(auth_user.email) = lower(normalized_identifier)
    limit 1;
  else
    raise exception 'Enter an email address or LiftLog ID';
  end if;

  if target_user_id is null then
    raise exception 'No available account matches that email or LiftLog ID';
  end if;
  if target_user_id = current_user_id then raise exception 'You cannot coach yourself'; end if;

  select * into target_profile
  from public.profiles profile where profile.id = target_user_id;
  if target_profile.id is null or target_profile.account_kind <> current_kind then
    raise exception 'No available account matches that email or LiftLog ID';
  end if;
  if exists (
    select 1 from public.coach_relationships relationship
    where relationship.athlete_id = current_user_id
      and relationship.coach_id = target_user_id
      and relationship.ended_at is null
  ) then raise exception 'This coach already has access'; end if;

  update public.coach_invites
  set status = 'revoked'
  where athlete_id = current_user_id
    and invited_profile_id = target_user_id
    and status = 'pending';

  insert into public.coach_invites (
    athlete_id, invited_email, invited_profile_id, target_identifier_kind,
    token_hash, status, expires_at, account_kind
  ) values (
    current_user_id, null, target_user_id, identifier_kind,
    encode(extensions.gen_random_bytes(32), 'hex'), 'pending', expiration, current_kind
  ) returning id into invitation_id;

  return jsonb_build_object(
    'id', invitation_id,
    'targetProfileId', target_user_id,
    'targetName', target_profile.display_name,
    'expiresAt', expiration
  );
end;
$$;

create or replace function public.list_pending_coach_invites()
returns table (
  id uuid,
  athlete_id uuid,
  athlete_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  return query
  select
    invitation.id,
    invitation.athlete_id,
    athlete.display_name,
    invitation.created_at,
    invitation.expires_at
  from public.coach_invites invitation
  join public.profiles athlete on athlete.id = invitation.athlete_id
  where invitation.invited_profile_id = current_user_id
    and invitation.status = 'pending'
    and invitation.expires_at > now()
  order by invitation.created_at asc;
end;
$$;

create or replace function public.respond_to_coach_invite(
  target_invite_id uuid,
  target_response text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  invitation public.coach_invites%rowtype;
  relationship_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_response not in ('accepted', 'declined') then
    raise exception 'Response must be accepted or declined';
  end if;

  select * into invitation
  from public.coach_invites invite
  where invite.id = target_invite_id
    and invite.invited_profile_id = current_user_id
  for update;

  if invitation.id is null then raise exception 'Coaching invitation not found'; end if;
  if invitation.status <> 'pending' then raise exception 'Coaching invitation has already been answered'; end if;
  if invitation.expires_at <= now() then raise exception 'Coaching invitation has expired'; end if;
  if invitation.athlete_id = current_user_id then raise exception 'You cannot coach yourself'; end if;

  if target_response = 'declined' then
    update public.coach_invites
    set status = 'declined'
    where id = invitation.id;
    return jsonb_build_object('status', 'declined', 'relationshipId', null);
  end if;

  select relationship.id into relationship_id
  from public.coach_relationships relationship
  where relationship.athlete_id = invitation.athlete_id
    and relationship.coach_id = current_user_id
    and relationship.ended_at is null
  limit 1;

  if relationship_id is null then
    insert into public.coach_relationships (athlete_id, coach_id, account_kind)
    values (invitation.athlete_id, current_user_id, invitation.account_kind)
    returning id into relationship_id;
  end if;

  update public.coach_invites
  set status = 'accepted', accepted_at = now()
  where id = invitation.id;

  return jsonb_build_object('status', 'accepted', 'relationshipId', relationship_id);
end;
$$;

revoke all on function public.resolve_coach_invite_target(text) from public;
revoke all on function public.create_coach_invite(text) from public;
revoke all on function public.list_pending_coach_invites() from public;
revoke all on function public.respond_to_coach_invite(uuid, text) from public;

grant execute on function public.resolve_coach_invite_target(text) to authenticated;
grant execute on function public.create_coach_invite(text) to authenticated;
grant execute on function public.list_pending_coach_invites() to authenticated;
grant execute on function public.respond_to_coach_invite(uuid, text) to authenticated;
