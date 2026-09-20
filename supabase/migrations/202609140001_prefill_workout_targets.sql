-- New sessions begin with exact objective prescribed values. Finishing keeps
-- the remaining entries; explicit changes, clears and deleted sets are saved
-- verbatim. Rep ranges, actual effort and heart rate are never guessed.
-- The existing early resume return prevents any refill of a started session.
-- This changes only the start function, preserving all stored plans/history,
-- session media/instruction snapshots, permissions and revisioned save guards.

create or replace function public.start_scheduled_workout(
  target_scheduled_workout_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  scheduled_occurrence public.scheduled_workouts%rowtype;
  existing_session_id uuid;
  session_id uuid;
  workout_title_value text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select occurrence.*
  into scheduled_occurrence
  from public.scheduled_workouts occurrence
  where occurrence.id = target_scheduled_workout_id
    and occurrence.athlete_id = current_user_id
  for update;
  if not found then
    raise exception 'Scheduled workout is invalid';
  end if;

  perform profile.id
  from public.profiles profile
  where profile.id = current_user_id
  for update;

  if scheduled_occurrence.planned_date is null then
    raise exception 'Undated workout cannot be started';
  end if;
  if scheduled_occurrence.status = 'skipped' then
    raise exception 'Skipped workout must be restored before it can be started';
  end if;
  if scheduled_occurrence.status = 'completed' then
    raise exception 'Completed workout cannot be started again';
  end if;
  if scheduled_occurrence.status = 'in_progress' then
    select session.id
    into existing_session_id
    from public.workout_sessions session
    where session.scheduled_workout_id = scheduled_occurrence.id
      and session.athlete_id = current_user_id
      and session.status = 'in_progress';
    if existing_session_id is null then
      raise exception 'In-progress scheduled workout is missing its session';
    end if;
    return existing_session_id;
  end if;
  if scheduled_occurrence.status is distinct from 'planned' then
    raise exception 'Only a planned workout can be started';
  end if;

  select session.id
  into existing_session_id
  from public.workout_sessions session
  where session.athlete_id = current_user_id
    and session.status = 'in_progress'
  order by session.started_at desc, session.id
  limit 1
  for update;
  if existing_session_id is not null then
    raise exception 'Finish the in-progress workout before starting another';
  end if;

  select workout.title
  into workout_title_value
  from public.workouts workout
  join public.program_weeks week on week.id = workout.program_week_id
  where workout.id = scheduled_occurrence.workout_id
    and week.program_version_id = scheduled_occurrence.program_version_id;
  if workout_title_value is null then
    raise exception 'Workout content is unavailable';
  end if;

  -- Session drafts support at most 250 rows per exercise. Reject an oversized
  -- legacy round count explicitly instead of truncating its completed work.
  if exists (
    select item.id
    from public.workout_sections section
    join public.workout_items item on item.section_id = section.id
    join public.prescribed_entries prescribed on prescribed.workout_item_id = item.id
    where section.workout_id = scheduled_occurrence.workout_id
      and item.entry_mode = 'intervals'
    group by item.id
    having count(*) = 1 and max(prescribed.rounds) > 250
  ) then
    raise exception 'An interval exercise cannot contain more than 250 rounds';
  end if;

  insert into public.workout_sessions (
    athlete_id,
    scheduled_workout_id,
    assignment_id,
    program_version_id,
    workout_id,
    workout_title,
    status
  ) values (
    current_user_id,
    scheduled_occurrence.id,
    scheduled_occurrence.assignment_id,
    scheduled_occurrence.program_version_id,
    scheduled_occurrence.workout_id,
    workout_title_value,
    'in_progress'
  ) returning id into session_id;

  with source_items as materialized (
    select
      item.id,
      item.snapshot_name,
      concat_ws(E'\n',
        nullif(btrim(item.snapshot_cue), ''),
        nullif(target_notes.value, nullif(btrim(item.snapshot_cue), ''))
      ) as snapshot_cue,
      item.entry_mode,
      item.tracking_fields,
      row_number() over (
        order by section.position, item.position, item.id
      )::integer - 1 as session_position
    from public.workout_sections section
    join public.workout_items item on item.section_id = section.id
    cross join lateral (
      select case
        -- Old clients commonly repeat one shared target on every prescribed
        -- row. Keep that instruction once, also deduplicating it against cue.
        when count(distinct note.value) = 1 then min(note.value)
        -- Different row instructions must retain their original association;
        -- joining them as one unlabelled global note would change the plan.
        else string_agg(
          case item.entry_mode when 'sets' then 'Set '
            when 'intervals' then 'Round ' else 'Entry ' end
          || (note.position + 1)::text || ': ' || note.value,
          E'\n' order by note.position
        )
      end as value
      from (
        select prescribed.position, nullif(btrim(prescribed.target_text), '') as value
        from public.prescribed_entries prescribed
        where prescribed.workout_item_id = item.id
          and nullif(btrim(prescribed.target_text), '') is not null
      ) note
    ) target_notes
    where section.workout_id = scheduled_occurrence.workout_id
  ),
  inserted_items as (
    insert into public.session_item_logs (
      workout_session_id,
      source_workout_item_id,
      snapshot_name,
      snapshot_cue,
      entry_mode,
      tracking_fields,
      position
    )
    select
      session_id,
      item.id,
      item.snapshot_name,
      item.snapshot_cue,
      item.entry_mode,
      item.tracking_fields,
      item.session_position
    from source_items item
    order by item.session_position
    returning id, source_workout_item_id, entry_mode, tracking_fields
  ),
  prescribed_seed as (
    select inserted.id as session_item_log_id, inserted.entry_mode,
      inserted.tracking_fields, prescribed.position as prescribed_position,
      prescribed.reps_min, prescribed.reps_max, prescribed.load_kg,
      prescribed.duration_seconds, prescribed.distance_metres,
      prescribed.rounds, prescribed.work_seconds,
      count(prescribed.id) over (partition by inserted.id) as prescribed_count,
      row_number() over (partition by inserted.id order by prescribed.position) as prescribed_index
    from inserted_items inserted
    left join public.prescribed_entries prescribed
      on prescribed.workout_item_id = inserted.source_workout_item_id
    where inserted.entry_mode <> 'none'
  ),
  entry_seed as (
    -- Repeated prescribed rows are individual sets/rounds. A legacy interval
    -- with one prescription and N rounds expands into N individual entries.
    -- A missing prescription retains one empty row, without inventing a dose.
    select seed.*, case
      when seed.entry_mode = 'intervals' and seed.prescribed_count <= 1 then round.position
      else coalesce(seed.prescribed_position, 0)
    end as position
    from prescribed_seed seed
    cross join lateral generate_series(0, case
      when seed.entry_mode = 'intervals' and seed.prescribed_count <= 1
        then greatest(1, coalesce(seed.rounds, 1))
      else 1 end - 1) as round(position)
    where seed.entry_mode <> 'result' or seed.prescribed_index = 1
  )
  insert into public.session_entries (
    session_item_log_id, position, reps, load_kg, duration_seconds,
    distance_metres, rounds
  )
  select entry.session_item_log_id, entry.position,
    case when 'reps' = any(entry.tracking_fields)
      and (entry.reps_min is null or entry.reps_max is null or entry.reps_min = entry.reps_max)
      and coalesce(entry.reps_min, entry.reps_max) = trunc(coalesce(entry.reps_min, entry.reps_max))
      then coalesce(entry.reps_min, entry.reps_max) end,
    case when 'load' = any(entry.tracking_fields) then entry.load_kg end,
    case when 'duration' = any(entry.tracking_fields) then
      case when entry.entry_mode = 'intervals' then coalesce(entry.work_seconds, entry.duration_seconds)
        else entry.duration_seconds end end,
    case when 'distance' = any(entry.tracking_fields) then entry.distance_metres end,
    case when entry.entry_mode = 'intervals' and 'rounds' = any(entry.tracking_fields) then 1 end
  from entry_seed entry;

  update public.scheduled_workouts
  set status = 'in_progress'
  where id = scheduled_occurrence.id
    and athlete_id = current_user_id
    and status = 'planned';
  if not found then
    raise exception 'Scheduled workout changed while it was being started';
  end if;

  return session_id;
end;
$$;

revoke all on function public.start_scheduled_workout(uuid) from public, anon;
grant execute on function public.start_scheduled_workout(uuid) to authenticated;
