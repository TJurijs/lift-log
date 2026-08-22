-- Programs are finite sequences of explicit weeks. Existing repeating programs
-- keep their content and history, but become ordinary fixed-week programs.

update public.programs
set planning_mode = 'fixed_weeks', updated_at = now()
where planning_mode = 'repeating_week';

update public.program_templates
set planning_mode = 'fixed_weeks', updated_at = now()
where planning_mode = 'repeating_week';

alter table public.programs
  drop constraint if exists programs_planning_mode_check;
alter table public.programs
  add constraint programs_planning_mode_check
  check (planning_mode = 'fixed_weeks');

alter table public.program_templates
  drop constraint if exists program_templates_planning_mode_check;
alter table public.program_templates
  add constraint program_templates_planning_mode_check
  check (planning_mode = 'fixed_weeks');

-- Keep the established RPC signature for older clients, but reject attempts to
-- recreate the retired repeating-program model.
create or replace function public.create_blank_program(
  target_athlete_id uuid,
  target_title text,
  target_planning_mode text default 'fixed_weeks'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  resolved_athlete_id uuid := coalesce(target_athlete_id, (select auth.uid()));
  program_id uuid;
  version_id uuid;
  phase_id uuid;
  author_name text;
  source_kind text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if resolved_athlete_id <> current_user_id and not public.is_active_coach(resolved_athlete_id) then
    raise exception 'Not authorized to create this program';
  end if;
  if length(trim(coalesce(target_title, ''))) not between 1 and 120 then
    raise exception 'Program title must be between 1 and 120 characters';
  end if;
  if coalesce(target_planning_mode, 'fixed_weeks') <> 'fixed_weeks' then
    raise exception 'Repeating programs are no longer supported';
  end if;

  select profile.display_name into author_name
  from public.profiles profile where profile.id = current_user_id;
  source_kind := case when resolved_athlete_id = current_user_id then 'self' else 'coach' end;

  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label
  ) values (
    resolved_athlete_id, current_user_id, trim(target_title), '', 'fixed_weeks', true,
    source_kind,
    case when source_kind = 'self' then 'Created by you' else 'Created by ' || author_name end
  ) returning id into program_id;

  insert into public.program_versions (program_id, authored_by_id, version_number, status)
  values (program_id, current_user_id, 1, 'draft') returning id into version_id;
  insert into public.program_phases (program_version_id, name, position)
  values (version_id, 'Plan', 0) returning id into phase_id;
  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (version_id, phase_id, 1, 'Week 1');
  return program_id;
end;
$$;

-- Library instances also materialize with the fixed invariant even if a stale
-- caller or imported template record predates this migration.
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

  select * into template_row from public.program_templates template
  where template.id = target_template_id and template.is_active;
  if template_row.id is null then raise exception 'Program template is unavailable'; end if;

  insert into public.programs (
    athlete_id, created_by_id, title, description, planning_mode, is_current,
    source_type, source_label, template_id
  ) values (
    current_user_id, current_user_id, template_row.title, template_row.description,
    'fixed_weeks', true, 'library', template_row.source_label, template_row.id
  ) returning id into program_id;
  insert into public.program_versions (program_id, authored_by_id, version_number, status)
  values (program_id, current_user_id, 1, 'draft') returning id into published_version_id;
  perform private.populate_program_from_template(published_version_id, template_row.id);
  update public.program_versions
  set status = 'published', effective_from = current_date, published_at = now()
  where id = published_version_id;
  return program_id;
end;
$$;

-- All week-building entry points share the same finite-program ceiling.
create or replace function public.add_program_week(target_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  phase_id uuid;
  existing_count integer;
  next_index integer;
  new_week_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  perform 1 from public.program_versions version
  where version.id = target_version_id for update;
  if not found or not public.can_edit_version(target_version_id) then
    raise exception 'Program version is not editable';
  end if;

  select count(*)::integer, coalesce(max(week.week_index), 0) + 1
  into existing_count, next_index
  from public.program_weeks week where week.program_version_id = target_version_id;
  if existing_count >= 52 then raise exception 'A program can contain at most 52 weeks'; end if;

  select phase.id into phase_id from public.program_phases phase
  where phase.program_version_id = target_version_id order by phase.position limit 1;
  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (target_version_id, phase_id, next_index, 'Week ' || next_index)
  returning id into new_week_id;
  return new_week_id;
end;
$$;

-- Append one or more independent deep copies of an editable source week. A
-- single function call is one PostgreSQL transaction: either all requested
-- weeks and their nested workouts are copied, or none are.
create or replace function public.duplicate_program_week_times(
  source_week_id uuid,
  copy_count integer
)
returns table (week_id uuid, week_index integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_version_id uuid;
  source_phase_id uuid;
  existing_count integer;
  maximum_index integer;
  copy_offset integer;
  copied_week_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if copy_count is null or copy_count not between 1 and 51 then
    raise exception 'Copy count must be between 1 and 51';
  end if;

  select source.program_version_id into source_version_id
  from public.program_weeks source where source.id = source_week_id;
  if source_version_id is null then raise exception 'Source week not found'; end if;

  -- Serialize structural edits to the same draft version.
  perform 1 from public.program_versions version
  where version.id = source_version_id for update;
  if not public.can_edit_version(source_version_id) then
    raise exception 'Program version is not editable';
  end if;

  select source.phase_id
  into source_phase_id
  from public.program_weeks source
  where source.id = source_week_id and source.program_version_id = source_version_id
  for update;
  if not found then raise exception 'Source week not found'; end if;

  perform 1 from public.program_weeks existing
  where existing.program_version_id = source_version_id
  order by existing.week_index
  for update;

  select count(*)::integer, coalesce(max(existing.week_index), 0)
  into existing_count, maximum_index
  from public.program_weeks existing
  where existing.program_version_id = source_version_id;

  if existing_count <> maximum_index then
    raise exception 'Program week indices must be contiguous';
  end if;
  if existing_count + copy_count > 52 then
    raise exception 'A program can contain at most 52 weeks';
  end if;

  for copy_offset in 1..copy_count loop
    week_index := maximum_index + copy_offset;
    insert into public.program_weeks (program_version_id, phase_id, week_index, label)
    values (source_version_id, source_phase_id, week_index, 'Week ' || week_index)
    returning id into copied_week_id;
    perform private.clone_week_contents(source_week_id, copied_week_id);
    week_id := copied_week_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.create_blank_program(uuid, text, text) from public;
revoke all on function public.create_program_from_template(uuid) from public;
revoke all on function public.add_program_week(uuid) from public;
revoke all on function public.duplicate_program_week_times(uuid, integer) from public;
grant execute on function public.create_blank_program(uuid, text, text) to authenticated;
grant execute on function public.create_program_from_template(uuid) to authenticated;
grant execute on function public.add_program_week(uuid) to authenticated;
grant execute on function public.duplicate_program_week_times(uuid, integer) to authenticated;

-- The fixed-program completion migration ran before these rows were converted.
-- Reconcile converted programs that already have a terminal published cycle,
-- while leaving their scheduled-workout and session history untouched.
delete from public.program_availability availability
using public.programs program
where program.id = availability.program_id
  and program.athlete_id = availability.athlete_id
  and program.planning_mode = 'fixed_weeks'
  and exists (
    select 1
    from public.program_versions version
    where version.id = (
      select latest.id
      from public.program_versions latest
      where latest.program_id = program.id and latest.status = 'published'
      order by latest.version_number desc
      limit 1
    )
      and exists (
        select 1 from public.scheduled_workouts scheduled
        where scheduled.program_version_id = version.id
          and scheduled.athlete_id = availability.athlete_id
      )
      and not exists (
        select 1 from public.scheduled_workouts scheduled
        where scheduled.program_version_id = version.id
          and scheduled.athlete_id = availability.athlete_id
          and scheduled.status in ('planned', 'in_progress')
      )
  );
