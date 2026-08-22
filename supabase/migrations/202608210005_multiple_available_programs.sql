-- A program marked current is available to the athlete; availability is not exclusive.
drop index if exists public.idx_programs_one_current;

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
  if target_planning_mode not in ('repeating_week', 'fixed_weeks') then raise exception 'Invalid planning mode'; end if;

  select profile.display_name into author_name from public.profiles profile where profile.id = current_user_id;
  source_kind := case when resolved_athlete_id = current_user_id then 'self' else 'coach' end;
  insert into public.programs (athlete_id, created_by_id, title, description, planning_mode, is_current, source_type, source_label)
  values (resolved_athlete_id, current_user_id, trim(target_title), '', target_planning_mode, true, source_kind,
    case when source_kind = 'self' then 'Created by you' else 'Created by ' || author_name end)
  returning id into program_id;
  insert into public.program_versions (program_id, authored_by_id, version_number, status)
  values (program_id, current_user_id, 1, 'draft') returning id into version_id;
  insert into public.program_phases (program_version_id, name, position)
  values (version_id, 'Plan', 0) returning id into phase_id;
  insert into public.program_weeks (program_version_id, phase_id, week_index, label)
  values (version_id, phase_id, 1, 'Week 1');
  return program_id;
end;
$$;

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
  sequence_value integer := 0;
  workout_row record;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into template_row from public.program_templates template where template.id = target_template_id and template.is_active;
  if template_row.id is null then raise exception 'Program template is unavailable'; end if;

  insert into public.programs (athlete_id, created_by_id, title, description, planning_mode, is_current, source_type, source_label, template_id)
  values (current_user_id, current_user_id, template_row.title, template_row.description,
    template_row.planning_mode, true, 'library', template_row.source_label, template_row.id)
  returning id into program_id;
  insert into public.program_versions (program_id, authored_by_id, version_number, status)
  values (program_id, current_user_id, 1, 'draft') returning id into published_version_id;
  perform private.populate_program_from_template(published_version_id, template_row.id);
  update public.program_versions set status = 'published', effective_from = current_date, published_at = now()
  where id = published_version_id;

  for workout_row in
    select workout.id from public.program_weeks week
    join public.workouts workout on workout.program_week_id = week.id
    where week.program_version_id = published_version_id order by week.week_index, workout.position
  loop
    sequence_value := sequence_value + 1;
    insert into public.scheduled_workouts (athlete_id, scheduled_by_id, program_version_id, workout_id, planned_date, sequence_number, status)
    values (current_user_id, current_user_id, published_version_id, workout_row.id, null, sequence_value, 'planned');
  end loop;
  perform public.create_program_draft(program_id);
  return program_id;
end;
$$;

revoke all on function public.create_blank_program(uuid, text, text) from public;
revoke all on function public.create_program_from_template(uuid) from public;
grant execute on function public.create_blank_program(uuid, text, text) to authenticated;
grant execute on function public.create_program_from_template(uuid) to authenticated;
