-- Align database privileges and copy authorization with the documented
-- viewer-relative capability model. This migration is intentionally forward
-- only; it does not rewrite existing program instances.

grant select on table public.program_availability to authenticated;

create or replace function public.copy_program_to_own(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_program public.programs%rowtype;
  source_version_id uuid;
  new_program_id uuid;
  new_version_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select * into source_program
  from public.programs program
  where program.id = target_program_id
    and program.athlete_id = current_user_id
    and program.source_type in ('library', 'coach')
    and program.archived_at is null;
  if source_program.id is null then
    raise exception 'Only your Library or Coach content can be copied to Own';
  end if;

  select version.id into source_version_id
  from public.program_versions version
  where version.program_id = target_program_id
    and version.status in ('published', 'superseded')
  order by
    case version.status when 'published' then 0 else 1 end,
    version.version_number desc
  limit 1;
  if source_version_id is null then raise exception 'Published program content not found'; end if;

  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label
  ) values (
    current_user_id, current_user_id, source_program.title, source_program.description,
    source_program.planning_mode, true, 'self', 'Copied by you'
  ) returning id into new_program_id;
  insert into public.program_versions (
    program_id, authored_by_id, based_on_version_id, version_number, status
  ) values (
    new_program_id, current_user_id, source_version_id, 1, 'draft'
  ) returning id into new_version_id;
  perform private.clone_program_version_tree(source_version_id, new_version_id);
  return new_program_id;
end;
$$;

revoke all on function public.copy_program_to_own(uuid) from public;
grant execute on function public.copy_program_to_own(uuid) to authenticated;
