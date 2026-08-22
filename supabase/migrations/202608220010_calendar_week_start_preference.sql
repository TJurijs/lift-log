-- Calendar weeks are Monday-first by default. Each account may opt into a
-- Sunday-first grid without affecting anyone else's calendar.

alter table public.profiles
  add column if not exists week_starts_on_sunday boolean not null default false;

create or replace function public.update_own_profile(
  target_first_name text,
  target_last_name text,
  target_week_starts_on_sunday boolean
)
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
  set
    first_name = trim(target_first_name),
    last_name = trim(coalesce(target_last_name, '')),
    week_starts_on_sunday = target_week_starts_on_sunday
  where id = current_user_id
  returning * into updated_profile;
  if updated_profile.id is null then raise exception 'Profile not found'; end if;

  return jsonb_build_object(
    'id', updated_profile.id,
    'firstName', updated_profile.first_name,
    'lastName', updated_profile.last_name,
    'displayName', updated_profile.display_name,
    'liftlogId', updated_profile.liftlog_id,
    'weekStartsOnSunday', updated_profile.week_starts_on_sunday
  );
end;
$$;

revoke all on function public.update_own_profile(text, text, boolean) from public;
grant execute on function public.update_own_profile(text, text, boolean) to authenticated;
