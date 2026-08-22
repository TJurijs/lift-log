-- Removing a program from scheduling also removes its unstarted calendar entries.
create or replace function public.set_program_availability(target_program_id uuid, make_available boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  published_version_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.programs program
    where program.id = target_program_id
      and program.athlete_id = current_user_id
      and program.archived_at is null
  ) then
    raise exception 'Program not found';
  end if;

  if make_available then
    select version.id into published_version_id
    from public.program_versions version
    where version.program_id = target_program_id
      and version.status = 'published'
    order by version.version_number desc
    limit 1;
    if published_version_id is null then
      raise exception 'Finish editing this program before making it available';
    end if;

    insert into public.program_availability (athlete_id, program_id)
    values (current_user_id, target_program_id)
    on conflict do nothing;

    delete from public.scheduled_workouts scheduled
    using public.program_versions version
    where version.id = scheduled.program_version_id
      and version.program_id = target_program_id
      and scheduled.program_version_id <> published_version_id
      and scheduled.status = 'planned'
      and scheduled.planned_date is null
      and not exists (
        select 1 from public.workout_sessions session
        where session.scheduled_workout_id = scheduled.id
      );
    perform public.prepare_program_schedule(published_version_id);
  else
    delete from public.program_availability
    where athlete_id = current_user_id and program_id = target_program_id;

    delete from public.scheduled_workouts scheduled
    using public.program_versions version
    where version.id = scheduled.program_version_id
      and version.program_id = target_program_id
      and scheduled.status = 'planned'
      and not exists (
        select 1 from public.workout_sessions session
        where session.scheduled_workout_id = scheduled.id
      );
  end if;
  return make_available;
end;
$$;

revoke all on function public.set_program_availability(uuid, boolean) from public;
grant execute on function public.set_program_availability(uuid, boolean) to authenticated;
