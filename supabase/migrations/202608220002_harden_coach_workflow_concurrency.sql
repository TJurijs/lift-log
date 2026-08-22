-- Serialize retries for one athlete/coach invitation pair and lock coaching
-- authorization for the duration of a program assignment transaction.

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
  expiration timestamptz;
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

  -- A transaction-scoped lock makes repeated requests for the same pair
  -- idempotent even when two browser requests arrive at the same time.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':' || target_user_id::text, 0)
  );

  if exists (
    select 1 from public.coach_relationships relationship
    where relationship.athlete_id = current_user_id
      and relationship.coach_id = target_user_id
      and relationship.ended_at is null
  ) then raise exception 'This coach already has access'; end if;

  select invitation.id, invitation.expires_at
  into invitation_id, expiration
  from public.coach_invites invitation
  where invitation.athlete_id = current_user_id
    and invitation.invited_profile_id = target_user_id
    and invitation.status = 'pending'
  order by invitation.created_at desc
  limit 1
  for update;

  if invitation_id is not null and expiration > now() then
    return jsonb_build_object(
      'id', invitation_id,
      'targetProfileId', target_user_id,
      'targetName', target_profile.display_name,
      'expiresAt', expiration
    );
  end if;

  if invitation_id is not null then
    update public.coach_invites
    set status = 'expired'
    where id = invitation_id;
  end if;

  invitation_id := null;
  expiration := now() + interval '7 days';
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

create or replace function public.assign_own_program_to_athletes(
  target_program_id uuid,
  target_athlete_ids uuid[]
)
returns table (
  athlete_id uuid,
  assigned_program_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  source_program public.programs%rowtype;
  source_version_id uuid;
  coach_name text;
  normalized_athlete_ids uuid[];
  active_relationship_count integer;
  athlete_cursor uuid;
  new_program_id uuid;
  new_version_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_athlete_ids is null or cardinality(target_athlete_ids) = 0 then
    raise exception 'Choose at least one athlete';
  end if;
  if cardinality(target_athlete_ids) > 50 then
    raise exception 'A program can be assigned to at most 50 athletes at once';
  end if;
  if exists (select 1 from unnest(target_athlete_ids) requested_id where requested_id is null) then
    raise exception 'Athlete IDs cannot be empty';
  end if;

  select array_agg(requested_id order by first_position)
  into normalized_athlete_ids
  from (
    select requested_id, min(position) as first_position
    from unnest(target_athlete_ids) with ordinality requested(requested_id, position)
    group by requested_id
  ) distinct_targets;

  select program.* into source_program
  from public.programs program
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and program.created_by_id = current_user_id
    and program.source_type = 'self'
    and program.is_current
    and program.archived_at is null
  for share;
  if source_program.id is null then
    raise exception 'Only one of your own programs can be assigned';
  end if;

  select version.id into source_version_id
  from public.program_versions version
  where version.program_id = source_program.id
    and version.status = 'published'
  order by version.version_number desc
  limit 1
  for share;
  if source_version_id is null then
    raise exception 'Publish the program before assigning it';
  end if;

  -- Ending a coaching relationship updates the same row and must wait while
  -- this transaction holds FOR SHARE. The count is checked only after every
  -- matching row has been locked, so the batch remains all-or-nothing.
  perform relationship.id
  from public.coach_relationships relationship
  where relationship.coach_id = current_user_id
    and relationship.athlete_id = any(normalized_athlete_ids)
    and relationship.ended_at is null
  order by relationship.athlete_id
  for share;

  select count(distinct relationship.athlete_id)
  into active_relationship_count
  from public.coach_relationships relationship
  where relationship.coach_id = current_user_id
    and relationship.athlete_id = any(normalized_athlete_ids)
    and relationship.ended_at is null;

  if active_relationship_count <> cardinality(normalized_athlete_ids) then
    raise exception 'Programs can only be assigned to athletes you currently coach';
  end if;

  select profile.display_name into coach_name
  from public.profiles profile
  where profile.id = current_user_id;

  foreach athlete_cursor in array normalized_athlete_ids loop
    new_program_id := null;

    insert into public.programs (
      athlete_id,
      created_by_id,
      title,
      description,
      planning_mode,
      is_current,
      source_type,
      source_label,
      assigned_from_program_id
    ) values (
      athlete_cursor,
      current_user_id,
      source_program.title,
      source_program.description,
      source_program.planning_mode,
      true,
      'coach',
      'Assigned by ' || coalesce(coach_name, 'coach'),
      source_program.id
    )
    on conflict (athlete_id, assigned_from_program_id)
      where assigned_from_program_id is not null and archived_at is null
    do nothing
    returning id into new_program_id;

    if new_program_id is null then
      select program.id into assigned_program_id
      from public.programs program
      where program.athlete_id = athlete_cursor
        and program.assigned_from_program_id = source_program.id
        and program.archived_at is null;
      athlete_id := athlete_cursor;
      created := false;
      return next;
      continue;
    end if;

    insert into public.program_versions (
      program_id,
      authored_by_id,
      based_on_version_id,
      version_number,
      status
    ) values (
      new_program_id,
      current_user_id,
      source_version_id,
      1,
      'draft'
    ) returning id into new_version_id;

    perform private.clone_program_version_tree(source_version_id, new_version_id);

    update public.program_versions
    set status = 'published', effective_from = current_date, published_at = now()
    where id = new_version_id;

    athlete_id := athlete_cursor;
    assigned_program_id := new_program_id;
    created := true;
    return next;
  end loop;
end;
$$;

revoke all on function public.create_coach_invite(text) from public;
revoke all on function public.assign_own_program_to_athletes(uuid, uuid[]) from public;
grant execute on function public.create_coach_invite(text) to authenticated;
grant execute on function public.assign_own_program_to_athletes(uuid, uuid[]) to authenticated;
