-- A library template materializes as one immutable published program per athlete.
-- Editing starts by copying it into Own; no hidden draft is created.
create unique index if not exists idx_programs_one_library_template_per_athlete
  on public.programs (athlete_id, template_id)
  where source_type = 'library' and archived_at is null and template_id is not null;

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
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select program.id into program_id from public.programs program
  where program.athlete_id = current_user_id and program.template_id = target_template_id
    and program.source_type = 'library' and program.archived_at is null limit 1;
  if program_id is not null then return program_id; end if;

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
  values (program_id, current_user_id, 1, 'draft') returning id into published_version_id;
  perform private.populate_program_from_template(published_version_id, template_row.id);
  update public.program_versions set status = 'published', effective_from = current_date, published_at = now()
  where id = published_version_id;
  return program_id;
end;
$$;

revoke all on function public.create_program_from_template(uuid) from public;
grant execute on function public.create_program_from_template(uuid) to authenticated;
