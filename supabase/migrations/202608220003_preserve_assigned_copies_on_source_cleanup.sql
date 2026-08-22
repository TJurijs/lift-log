-- FK cleanup may clear lineage pointers when a source row is hard-deleted.
-- Permit only that null transition while keeping all ownership/source fields
-- and published content immutable. Normal program deletion remains archival.

create or replace function private.protect_program_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.athlete_id <> old.athlete_id
    or new.created_by_id <> old.created_by_id
    or new.source_type <> old.source_type
    or new.source_label <> old.source_label
    or new.template_id is distinct from old.template_id
    or (
      new.assigned_from_program_id is distinct from old.assigned_from_program_id
      and not (
        old.assigned_from_program_id is not null
        and new.assigned_from_program_id is null
      )
    ) then
    raise exception 'Program ownership and source cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function public.protect_published_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.based_on_version_id is not null
    and new.based_on_version_id is null
    and new.program_id = old.program_id
    and new.authored_by_id = old.authored_by_id
    and new.version_number = old.version_number
    and new.status = old.status
    and new.effective_from is not distinct from old.effective_from
    and new.published_at is not distinct from old.published_at then
    return new;
  end if;

  if new.program_id <> old.program_id
    or new.authored_by_id <> old.authored_by_id
    or new.version_number <> old.version_number then
    raise exception 'Program version identity cannot be changed';
  end if;
  if old.status = 'superseded' then
    raise exception 'Superseded program versions are immutable';
  end if;
  if old.status = 'published' then
    if new.status <> 'superseded'
      or new.effective_from is distinct from old.effective_from
      or new.published_at is distinct from old.published_at
      or new.based_on_version_id is distinct from old.based_on_version_id then
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
