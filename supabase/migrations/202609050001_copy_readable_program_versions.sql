-- Allow every readable reusable program or workout version to be duplicated.
-- The copy is always a new Own draft, so the source remains unchanged.

create or replace function public.copy_program_to_own(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_program public.programs%rowtype;
  source_version public.program_versions%rowtype;
  new_program_id uuid;
  new_version_id uuid;
  copy_title text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select program.* into source_program
  from public.programs program
  where program.id = target_program_id
    and program.archived_at is null;

  select version.* into source_version
  from public.program_versions version
  where version.program_id = target_program_id
    and version.status in ('draft', 'published', 'superseded')
    and public.can_read_version(version.id)
  order by
    case version.status
      when 'draft' then 0
      when 'published' then 1
      else 2
    end,
    version.version_number desc,
    version.id
  limit 1;

  if source_program.id is null or source_version.id is null then
    raise exception 'Readable content was not found';
  end if;

  copy_title := left(source_version.title, 115) || ' copy';
  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label, content_type
  ) values (
    current_user_id, current_user_id, copy_title, source_version.description,
    source_program.planning_mode, true, 'self', 'Duplicated by you',
    source_program.content_type
  ) returning id into new_program_id;

  insert into public.program_versions (
    program_id, authored_by_id, based_on_version_id, version_number, status
  ) values (
    new_program_id, current_user_id, source_version.id, 1, 'draft'
  ) returning id into new_version_id;

  perform private.clone_program_version_tree(source_version.id, new_version_id);

  update public.programs
  set title = copy_title
  where id = new_program_id;

  return new_program_id;
end;
$$;

revoke all on function public.copy_program_to_own(uuid) from public, anon;
grant execute on function public.copy_program_to_own(uuid) to authenticated;
