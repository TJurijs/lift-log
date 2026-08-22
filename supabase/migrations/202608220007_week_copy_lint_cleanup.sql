-- PostgreSQL creates the integer FOR-loop variable implicitly. Avoid declaring
-- a same-named variable so strict database lint remains clean.
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
  copied_week_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if copy_count is null or copy_count not between 1 and 51 then
    raise exception 'Copy count must be between 1 and 51';
  end if;

  select source.program_version_id into source_version_id
  from public.program_weeks source where source.id = source_week_id;
  if source_version_id is null then raise exception 'Source week not found'; end if;

  perform 1 from public.program_versions version
  where version.id = source_version_id for update;
  if not public.can_edit_version(source_version_id) then
    raise exception 'Program version is not editable';
  end if;

  select source.phase_id into source_phase_id
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

revoke all on function public.duplicate_program_week_times(uuid, integer) from public;
grant execute on function public.duplicate_program_week_times(uuid, integer) to authenticated;
