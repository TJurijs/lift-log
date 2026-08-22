-- Coaches assign a stable snapshot of one of their own published programs.
-- Every athlete receives an independent program instance: later edits to the
-- coach's source program cannot rewrite an athlete's published or scheduled
-- history, and the athlete still decides whether to make the copy schedulable.

alter table public.programs
  add column assigned_from_program_id uuid
  references public.programs(id) on delete set null;

alter table public.programs
  add constraint programs_assignment_source_check check (
    assigned_from_program_id is null or source_type = 'coach'
  );

create unique index idx_programs_one_assignment_per_source
  on public.programs (athlete_id, assigned_from_program_id)
  where assigned_from_program_id is not null and archived_at is null;

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
    or new.assigned_from_program_id is distinct from old.assigned_from_program_id then
    raise exception 'Program ownership and source cannot be changed';
  end if;
  return new;
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
declare
  current_user_id uuid := (select auth.uid());
  source_program public.programs%rowtype;
  source_version_id uuid;
  coach_name text;
  normalized_athlete_ids uuid[];
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
    and program.archived_at is null;
  if source_program.id is null then
    raise exception 'Only one of your own programs can be assigned';
  end if;

  select version.id into source_version_id
  from public.program_versions version
  where version.program_id = source_program.id
    and version.status = 'published'
  order by version.version_number desc
  limit 1;
  if source_version_id is null then
    raise exception 'Publish the program before assigning it';
  end if;

  -- Validate the complete batch before inserting anything. An invalid target
  -- therefore cannot leave earlier athletes with partial assignments.
  if exists (
    select 1
    from unnest(normalized_athlete_ids) requested_id
    where requested_id = current_user_id
      or not public.is_active_coach(requested_id)
  ) then
    raise exception 'Programs can only be assigned to athletes you currently coach';
  end if;

  select profile.display_name into coach_name
  from public.profiles profile
  where profile.id = current_user_id;

  foreach athlete_cursor in array normalized_athlete_ids loop
    new_program_id := null;

    -- The partial unique index and matching conflict predicate make retries
    -- idempotent, including two requests racing for the same athlete.
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

    -- Deliberately do not insert into program_availability or prepare calendar
    -- occurrences. Scheduling remains an explicit athlete action.
    athlete_id := athlete_cursor;
    assigned_program_id := new_program_id;
    created := true;
    return next;
  end loop;
end;
$$;

revoke all on function public.assign_own_program_to_athletes(uuid, uuid[]) from public;
grant execute on function public.assign_own_program_to_athletes(uuid, uuid[]) to authenticated;
