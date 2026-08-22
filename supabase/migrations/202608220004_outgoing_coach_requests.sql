-- Athletes can see and cancel their own unanswered coaching requests.

create or replace function public.list_outgoing_coach_invites()
returns table (
  id uuid,
  coach_id uuid,
  coach_name text,
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
    invitation.invited_profile_id,
    coach.display_name,
    invitation.created_at,
    invitation.expires_at
  from public.coach_invites invitation
  join public.profiles coach on coach.id = invitation.invited_profile_id
  where invitation.athlete_id = current_user_id
    and invitation.status = 'pending'
    and invitation.expires_at > now()
  order by invitation.created_at desc;
end;
$$;

create or replace function public.cancel_coach_invite(target_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  invitation public.coach_invites%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select * into invitation
  from public.coach_invites invite
  where invite.id = target_invite_id
    and invite.athlete_id = current_user_id
  for update;

  if invitation.id is null then raise exception 'Coaching request not found'; end if;
  if invitation.status <> 'pending' then
    raise exception 'Only a pending coaching request can be cancelled';
  end if;

  update public.coach_invites
  set status = 'revoked'
  where id = invitation.id;

  return invitation.id;
end;
$$;

revoke all on function public.list_outgoing_coach_invites() from public;
revoke all on function public.cancel_coach_invite(uuid) from public;
grant execute on function public.list_outgoing_coach_invites() to authenticated;
grant execute on function public.cancel_coach_invite(uuid) to authenticated;
