-- Program names and descriptions are prescribed content. Store them with each
-- version so renaming a later draft cannot rewrite schedule labels or history.

alter table public.program_versions
  add column title text,
  add column description text;

-- The existing immutability trigger correctly rejects updates to published and
-- superseded rows. Disable only that trigger while the new columns are filled;
-- the migration transaction retains the table lock until the trigger is back.
alter table public.program_versions
  disable trigger protect_published_program_version;
alter table public.program_versions
  disable trigger program_versions_set_updated_at;

update public.program_versions version
set
  title = program.title,
  description = program.description
from public.programs program
where program.id = version.program_id;

alter table public.program_versions
  enable trigger program_versions_set_updated_at;
alter table public.program_versions
  enable trigger protect_published_program_version;

alter table public.program_versions
  alter column title set not null,
  alter column description set not null;

create or replace function public.protect_published_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- ON DELETE SET NULL may clear lineage when a source program/version is
  -- removed. Preserve that narrow cleanup exception from 202608220003 while
  -- proving the historical snapshot itself is otherwise byte-for-byte stable.
  if old.based_on_version_id is not null
    and new.based_on_version_id is null
    and new.program_id = old.program_id
    and new.authored_by_id = old.authored_by_id
    and new.version_number = old.version_number
    and new.status = old.status
    and new.effective_from is not distinct from old.effective_from
    and new.published_at is not distinct from old.published_at
    and new.title is not distinct from old.title
    and new.description is not distinct from old.description then
    return new;
  end if;

  if new.program_id is distinct from old.program_id
    or new.authored_by_id is distinct from old.authored_by_id
    or new.version_number is distinct from old.version_number then
    raise exception 'Program version identity cannot be changed';
  end if;
  if new.based_on_version_id is distinct from old.based_on_version_id then
    raise exception 'Program version lineage cannot be changed';
  end if;

  if old.status = 'superseded' then
    raise exception 'Superseded program versions are immutable';
  end if;

  if old.status = 'published' then
    if new.status <> 'superseded'
      or new.effective_from is distinct from old.effective_from
      or new.published_at is distinct from old.published_at
      or new.based_on_version_id is distinct from old.based_on_version_id
      or new.title is distinct from old.title
      or new.description is distinct from old.description then
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

-- Existing creation/assignment RPCs deliberately omit version metadata. For a
-- normal draft, copy the owning program's current draft metadata. For an
-- assignment or copy whose based_on version belongs to another program, use
-- the exact source-version metadata instead of the source container's possibly
-- newer draft name. Version 1 also repairs the new target container so legacy
-- clients display the same factual name during the coordinated rollout.
create or replace function private.canonicalize_program_version_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  container_title text;
  container_description text;
  source_program_id uuid;
  source_status text;
  source_title text;
  source_description text;
begin
  if tg_op = 'UPDATE' and old.status in ('published', 'superseded') then
    return new;
  end if;

  select program.title, program.description
  into container_title, container_description
  from public.programs program
  where program.id = new.program_id;
  if not found then
    raise exception 'Program version must belong to an existing program';
  end if;

  if tg_op = 'INSERT' and new.based_on_version_id is not null then
    if (select auth.uid()) is not null
      and not public.can_read_version(new.based_on_version_id) then
      raise exception 'Based-on program version is not available';
    end if;

    select
      version.program_id,
      version.status,
      version.title,
      version.description
    into source_program_id, source_status, source_title, source_description
    from public.program_versions version
    where version.id = new.based_on_version_id;

    if source_program_id is null then
      raise exception 'Based-on program version was not found';
    end if;
    if source_status not in ('published', 'superseded') then
      raise exception 'Based-on program version must be immutable';
    end if;

    if source_program_id is distinct from new.program_id then
      new.title := source_title;
      new.description := source_description;

      if new.version_number = 1 then
        update public.programs
        set
          title = source_title,
          description = source_description
        where id = new.program_id;
      end if;
      return new;
    end if;
  end if;

  new.title := container_title;
  new.description := container_description;
  return new;
end;
$$;

drop trigger if exists canonicalize_program_version_metadata
  on public.program_versions;
create trigger canonicalize_program_version_metadata
before insert or update on public.program_versions
for each row execute function private.canonicalize_program_version_metadata();

create or replace function private.sync_program_draft_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.title is not distinct from old.title
    and new.description is not distinct from old.description then
    return new;
  end if;

  update public.program_versions
  set
    title = new.title,
    description = new.description
  where program_id = new.id
    and status = 'draft';
  return new;
end;
$$;

drop trigger if exists sync_program_draft_metadata on public.programs;
create trigger sync_program_draft_metadata
after update of title, description on public.programs
for each row execute function private.sync_program_draft_metadata();

revoke all on function private.canonicalize_program_version_metadata()
  from public, anon, authenticated;
revoke all on function private.sync_program_draft_metadata()
  from public, anon, authenticated;

select pg_catalog.set_config('search_path', 'public', false);
