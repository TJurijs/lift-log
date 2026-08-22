-- Keep personal display preferences with the private account. Metric units are
-- the default, while members can opt into pounds and miles later.

alter table public.profiles
  add column if not exists weight_unit text not null default 'kg'
    check (weight_unit in ('kg', 'lb')),
  add column if not exists distance_unit text not null default 'km'
    check (distance_unit in ('km', 'mi'));

create or replace function public.update_own_profile(
  target_first_name text,
  target_last_name text,
  target_week_starts_on_sunday boolean,
  target_weight_unit text,
  target_distance_unit text
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
  if target_weight_unit not in ('kg', 'lb') then
    raise exception 'Weight unit must be kg or lb';
  end if;
  if target_distance_unit not in ('km', 'mi') then
    raise exception 'Distance unit must be km or mi';
  end if;

  update public.profiles
  set
    first_name = trim(target_first_name),
    last_name = trim(coalesce(target_last_name, '')),
    week_starts_on_sunday = target_week_starts_on_sunday,
    weight_unit = target_weight_unit,
    distance_unit = target_distance_unit
  where id = current_user_id
  returning * into updated_profile;
  if updated_profile.id is null then raise exception 'Profile not found'; end if;

  return jsonb_build_object(
    'id', updated_profile.id,
    'firstName', updated_profile.first_name,
    'lastName', updated_profile.last_name,
    'displayName', updated_profile.display_name,
    'liftlogId', updated_profile.liftlog_id,
    'weekStartsOnSunday', updated_profile.week_starts_on_sunday,
    'weightUnit', updated_profile.weight_unit,
    'distanceUnit', updated_profile.distance_unit
  );
end;
$$;

revoke all on function public.update_own_profile(text, text, boolean, text, text) from public;
grant execute on function public.update_own_profile(text, text, boolean, text, text) to authenticated;
