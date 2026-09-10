-- NULL retains the existing single-video behavior. An explicit [] clears the
-- custom list; a nonempty array enables the new ordered, optionally named links.
-- Historical single URLs are not converted into custom-player snapshots.
alter table public.exercises add column video_links jsonb default null;
alter table public.session_item_logs add column snapshot_video_links jsonb default null;

alter table public.exercises add constraint exercises_video_links_shape check (
  video_links is null or (jsonb_typeof(video_links) = 'array' and jsonb_array_length(video_links) <= 10)
);
alter table public.session_item_logs add constraint session_item_video_links_shape check (
  snapshot_video_links is null or (jsonb_typeof(snapshot_video_links) = 'array' and jsonb_array_length(snapshot_video_links) <= 10)
);

create or replace function private.is_safe_exercise_video_url(value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  authority text;
  hostname text;
  port text;
  address inet;
begin
  if value is null or length(value) = 0 or length(value) > 2048
    or value !~* '^https?://'
    or value ~ '[[:space:][:cntrl:]]' or position(E'\\' in value) > 0 then
    return false;
  end if;
  authority := substring(value from '(?i)^https?://([^/?#]+)');
  if authority is null or position('@' in authority) > 0 then return false; end if;
  if left(authority, 1) = '[' then
    if authority !~ '^\[[0-9a-fA-F:.]+\](:[0-9]+)?$' then return false; end if;
    hostname := substring(authority from '^\[([^]]+)\]');
    begin
      address := hostname::inet;
      if family(address) <> 6 then return false; end if;
    exception when invalid_text_representation then return false;
    end;
    port := substring(authority from '\]:([0-9]+)$');
  else
    if authority !~ '^[a-zA-Z0-9_.-]+(:[0-9]+)?$' then return false; end if;
    hostname := split_part(authority, ':', 1);
    if length(hostname) > 253 or hostname ~ '^\.|\.\.|^-' then return false; end if;
    if exists (select 1 from unnest(string_to_array(rtrim(hostname, '.'), '.')) label
      where length(label) = 0 or length(label) > 63 or label ~ '^[-]|[-]$') then return false; end if;
    if hostname ~ '^[0-9.]+$' then
      begin
        address := hostname::inet;
        if family(address) <> 4 or hostname !~ '^([0-9]+\.){3}[0-9]+$' then return false; end if;
      exception when invalid_text_representation then return false;
      end;
    end if;
    port := substring(authority from ':([0-9]+)$');
  end if;
  if port is not null and (length(port) > 5 or port::integer > 65535) then return false; end if;
  return true;
end;
$$;

create or replace function private.normalize_exercise_video_links(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry jsonb;
  url text;
  label text;
  seen_urls text[] := array[]::text[];
  result jsonb := '[]'::jsonb;
begin
  if value is null then return null; end if;
  if jsonb_typeof(value) is distinct from 'array' then
    raise exception 'Exercise video links must be a JSON array';
  end if;
  if jsonb_array_length(value) > 10 then raise exception 'An exercise can have at most 10 video links'; end if;
  for entry in select item from jsonb_array_elements(value) item loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry -> 'url') is distinct from 'string'
      or exists (select 1 from jsonb_object_keys(entry) key where key not in ('url', 'label')) then
      raise exception 'Each exercise video link needs a URL and optional label';
    end if;
    url := btrim(entry ->> 'url');
    if not private.is_safe_exercise_video_url(url) then
      raise exception 'Video links must be absolute HTTP or HTTPS URLs without credentials, at most 2048 characters';
    end if;
    if entry ? 'label' and (jsonb_typeof(entry -> 'label') is distinct from 'string'
      or length(btrim(entry ->> 'label')) > 80) then
      raise exception 'Video labels must be strings of at most 80 characters';
    end if;
    label := nullif(btrim(entry ->> 'label'), '');
    if url = any(seen_urls) then continue; end if;
    seen_urls := array_append(seen_urls, url);
    result := result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('url', url, 'label', label)));
  end loop;
  return result;
end;
$$;

create or replace function private.normalize_exercise_video_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.video_links is not distinct from old.video_links
    and new.video_url is distinct from old.video_url then
    -- A legacy client changed the single URL without sending the new list.
    new.video_links := null;
  end if;
  new.video_links := private.normalize_exercise_video_links(new.video_links);
  if new.video_links is not null then
    new.video_url := new.video_links -> 0 ->> 'url';
  elsif new.video_url is not null and (tg_op = 'INSERT' or new.video_url is distinct from old.video_url) then
    new.video_url := nullif(btrim(new.video_url), '');
    if new.video_url is not null and not private.is_safe_exercise_video_url(new.video_url) then
      raise exception 'Video links must be absolute HTTP or HTTPS URLs without credentials, at most 2048 characters';
    end if;
  end if;
  return new;
end;
$$;

create trigger normalize_exercise_video_columns
before insert or update on public.exercises
for each row execute function private.normalize_exercise_video_columns();

create or replace function private.resolve_exercise_video_snapshot(target_workout_item_id uuid, target_name text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('url', exercise.video_url, 'links', exercise.video_links)
      from public.workout_items item join public.exercises exercise on exercise.id = item.source_exercise_id
      where item.id = target_workout_item_id limit 1),
    (select jsonb_build_object('url', exercise.video_url, 'links', exercise.video_links)
      from public.exercises exercise where exercise.scope = 'global' and exercise.archived_at is null
        and lower(trim(exercise.name)) = lower(trim(target_name))
      order by exercise.created_at, exercise.id limit 1),
    jsonb_build_object('url', null, 'links', null)
  );
$$;

create or replace function private.set_session_item_video_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  media jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.snapshot_video_url is distinct from old.snapshot_video_url
      or new.snapshot_video_links is distinct from old.snapshot_video_links then
      raise exception 'Session exercise videos are immutable snapshots';
    end if;
    return new;
  end if;
  media := private.resolve_exercise_video_snapshot(new.source_workout_item_id, new.snapshot_name);
  new.snapshot_video_url := media ->> 'url';
  new.snapshot_video_links := nullif(media -> 'links', 'null'::jsonb);
  return new;
end;
$$;

drop trigger set_session_item_video_snapshot on public.session_item_logs;
create trigger set_session_item_video_snapshot before insert or update on public.session_item_logs
for each row execute function private.set_session_item_video_snapshot();

-- Planned content can show the library's current videos. An active workout
-- always uses the media captured at session start, including an explicit [].
create or replace function private.session_workout_content_payload(target_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with source as (
    select private.workout_content_payload(session.workout_id) as payload
    from public.workout_sessions session where session.id = target_session_id
  )
  select jsonb_set(source.payload, '{sections}', coalesce((
    select jsonb_agg(jsonb_set(section.value, '{items}', coalesce((
      select jsonb_agg(case when log.id is null then item.value else
        item.value || jsonb_build_object('videoUrl', log.snapshot_video_url, 'videoLinks', log.snapshot_video_links)
      end order by item.position)
      from jsonb_array_elements(section.value -> 'items') with ordinality item(value, position)
      left join public.session_item_logs log on log.workout_session_id = target_session_id
        and log.source_workout_item_id::text = item.value ->> 'id'
    ), '[]'::jsonb)) order by section.position)
    from jsonb_array_elements(source.payload -> 'sections') with ordinality section(value, position)
  ), '[]'::jsonb)) from source;
$$;

revoke all on function private.is_safe_exercise_video_url(text) from public, anon, authenticated;
revoke all on function private.normalize_exercise_video_links(jsonb) from public, anon, authenticated;
revoke all on function private.normalize_exercise_video_columns() from public, anon, authenticated;
revoke all on function private.resolve_exercise_video_snapshot(uuid, text) from public, anon, authenticated;
revoke all on function private.set_session_item_video_snapshot() from public, anon, authenticated;
revoke all on function private.session_workout_content_payload(uuid) from public, anon, authenticated;

-- Extend current bounded projections without changing authorization or paging.

CREATE OR REPLACE FUNCTION private.program_version_content_payload(target_program_version_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with prescribed_payload as (
    select prescribed.workout_item_id,
      jsonb_agg(jsonb_build_object(
        'id', prescribed.id, 'position', prescribed.position,
        'repsMin', prescribed.reps_min, 'repsMax', prescribed.reps_max,
        'loadKg', prescribed.load_kg, 'durationSeconds', prescribed.duration_seconds,
        'distanceMetres', prescribed.distance_metres, 'rounds', prescribed.rounds,
        'workSeconds', prescribed.work_seconds, 'restSeconds', prescribed.rest_seconds,
        'targetRpeMin', prescribed.target_rpe_min,
        'targetRpeMax', prescribed.target_rpe_max, 'targetText', prescribed.target_text
      ) order by prescribed.position, prescribed.id) as entries
    from public.prescribed_entries prescribed
    join public.workout_items item on item.id = prescribed.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    where week.program_version_id = target_program_version_id
    group by prescribed.workout_item_id
  ), item_payload as (
    select item.section_id,
      jsonb_agg(jsonb_build_object(
        'id', item.id, 'sourceExerciseId', item.source_exercise_id,
        'exerciseCategory', exercise.category, 'videoUrl', exercise.video_url, 'videoLinks', exercise.video_links,
        'name', item.snapshot_name, 'cue', item.snapshot_cue,
        'entryMode', item.entry_mode, 'trackingFields', item.tracking_fields,
        'position', item.position,
        'prescribedEntries', coalesce(prescribed.entries, '[]'::jsonb)
      ) order by item.position, item.id) as items
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join public.exercises exercise on exercise.id = item.source_exercise_id
    left join prescribed_payload prescribed on prescribed.workout_item_id = item.id
    where week.program_version_id = target_program_version_id
    group by item.section_id
  ), section_payload as (
    select section.workout_id,
      jsonb_agg(jsonb_build_object(
        'id', section.id, 'title', section.title, 'kind', section.section_kind,
        'notes', section.notes, 'position', section.position,
        'items', coalesce(item.items, '[]'::jsonb)
      ) order by section.position, section.id) as sections
    from public.workout_sections section
    join public.workouts workout on workout.id = section.workout_id
    join public.program_weeks week on week.id = workout.program_week_id
    left join item_payload item on item.section_id = section.id
    where week.program_version_id = target_program_version_id
    group by section.workout_id
  ), workout_payload as (
    select workout.program_week_id,
      jsonb_agg(jsonb_build_object(
        'id', workout.id, 'title', workout.title,
        'scheduleLabel', workout.schedule_label, 'dayOfWeek', workout.day_of_week,
        'position', workout.position, 'estimatedMinutes', workout.estimated_minutes,
        'sections', coalesce(section.sections, '[]'::jsonb)
      ) order by workout.position, workout.id) as workouts
    from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    left join section_payload section on section.workout_id = workout.id
    where week.program_version_id = target_program_version_id
    group by workout.program_week_id
  ), week_payload as (
    select jsonb_agg(jsonb_build_object(
      'id', week.id, 'phaseId', week.phase_id, 'weekIndex', week.week_index,
      'label', week.label, 'workouts', coalesce(workout.workouts, '[]'::jsonb)
    ) order by week.week_index, week.id) as weeks
    from public.program_weeks week
    left join workout_payload workout on workout.program_week_id = week.id
    where week.program_version_id = target_program_version_id
  ), phase_payload as (
    select jsonb_agg(jsonb_build_object(
      'id', phase.id, 'name', phase.name, 'position', phase.position
    ) order by phase.position, phase.id) as phases
    from public.program_phases phase
    where phase.program_version_id = target_program_version_id
  )
  select jsonb_build_object(
    'phases', coalesce(phase.phases, '[]'::jsonb),
    'weeks', coalesce(week.weeks, '[]'::jsonb)
  )
  from phase_payload phase cross join week_payload week;
$function$;

CREATE OR REPLACE FUNCTION private.workout_content_payload(target_workout_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with prescribed_payload as (
    select prescribed.workout_item_id,
      jsonb_agg(jsonb_build_object(
        'id', prescribed.id, 'position', prescribed.position,
        'repsMin', prescribed.reps_min, 'repsMax', prescribed.reps_max,
        'loadKg', prescribed.load_kg, 'durationSeconds', prescribed.duration_seconds,
        'distanceMetres', prescribed.distance_metres, 'rounds', prescribed.rounds,
        'workSeconds', prescribed.work_seconds, 'restSeconds', prescribed.rest_seconds,
        'targetRpeMin', prescribed.target_rpe_min,
        'targetRpeMax', prescribed.target_rpe_max, 'targetText', prescribed.target_text
      ) order by prescribed.position, prescribed.id) as entries
    from public.prescribed_entries prescribed
    join public.workout_items item on item.id = prescribed.workout_item_id
    join public.workout_sections section on section.id = item.section_id
    where section.workout_id = target_workout_id
    group by prescribed.workout_item_id
  ), item_payload as (
    select item.section_id,
      jsonb_agg(jsonb_build_object(
        'id', item.id, 'sourceExerciseId', item.source_exercise_id,
        'exerciseCategory', exercise.category, 'videoUrl', exercise.video_url, 'videoLinks', exercise.video_links,
        'name', item.snapshot_name, 'cue', item.snapshot_cue,
        'entryMode', item.entry_mode, 'trackingFields', item.tracking_fields,
        'position', item.position,
        'prescribedEntries', coalesce(prescribed.entries, '[]'::jsonb)
      ) order by item.position, item.id) as items
    from public.workout_items item
    join public.workout_sections section on section.id = item.section_id
    left join public.exercises exercise on exercise.id = item.source_exercise_id
    left join prescribed_payload prescribed on prescribed.workout_item_id = item.id
    where section.workout_id = target_workout_id
    group by item.section_id
  ), section_payload as (
    select section.workout_id,
      jsonb_agg(jsonb_build_object(
        'id', section.id, 'title', section.title, 'kind', section.section_kind,
        'notes', section.notes, 'position', section.position,
        'items', coalesce(item.items, '[]'::jsonb)
      ) order by section.position, section.id) as sections
    from public.workout_sections section
    left join item_payload item on item.section_id = section.id
    where section.workout_id = target_workout_id
    group by section.workout_id
  )
  select jsonb_build_object(
    'id', workout.id, 'title', workout.title,
    'scheduleLabel', workout.schedule_label, 'dayOfWeek', workout.day_of_week,
    'position', workout.position, 'estimatedMinutes', workout.estimated_minutes,
    'sections', coalesce(section.sections, '[]'::jsonb)
  )
  from public.workouts workout
  left join section_payload section on section.workout_id = workout.id
  where workout.id = target_workout_id;
$function$;

CREATE OR REPLACE FUNCTION public.append_workout_exercise(target_section_id uuid, target_exercise_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_version_id uuid;
  source_exercise public.exercises%rowtype;
  new_item_id uuid;
  next_position integer;
  item_count integer;
  prescribed_payload jsonb;
begin
  -- Match the section lock used by workout-wide reorder, and serialize with
  -- publication before checking edit access to the selected draft revision.
  select week.program_version_id into target_version_id
  from public.workout_sections section
  join public.workouts workout on workout.id = section.workout_id
  join public.program_weeks week on week.id = workout.program_week_id
  join public.program_versions version on version.id = week.program_version_id
  where section.id = target_section_id
  for update of section
  for share of version;
  if not public.can_edit_version(target_version_id) then
    raise exception 'Program version is not editable';
  end if;

  -- A security-definer endpoint must explicitly enforce exercise visibility.
  -- Resolve defaults on the server so stale catalogue data cannot determine
  -- either the saved snapshot or its initial prescription.
  select exercise.* into source_exercise
  from public.exercises exercise
  where exercise.id = target_exercise_id
    and exercise.archived_at is null
    and (exercise.scope = 'global' or exercise.owner_id = (select auth.uid()));
  if not found then raise exception 'Exercise is unavailable'; end if;

  select coalesce(max(item.position), -1) + 1, count(*)
  into next_position, item_count
  from public.workout_items item
  where item.section_id = target_section_id;
  if item_count >= 100 then
    raise exception 'A workout can contain at most 100 exercises';
  end if;

  insert into public.workout_items (
    section_id, source_exercise_id, snapshot_name, snapshot_cue,
    entry_mode, tracking_fields, position
  ) values (
    target_section_id, source_exercise.id, source_exercise.name, source_exercise.cue,
    source_exercise.default_entry_mode, source_exercise.default_tracking_fields,
    next_position
  ) returning id into new_item_id;

  -- Choose useful empty structure without inventing a training dose. Timed
  -- and distance sets start with one row and may be repeated by the author.
  if source_exercise.default_entry_mode = 'sets'
    and 'reps' = any(source_exercise.default_tracking_fields) then
    insert into public.prescribed_entries (workout_item_id, position)
    select new_item_id, position from generate_series(0, 2) position;
  elsif source_exercise.default_entry_mode <> 'none' then
    insert into public.prescribed_entries (workout_item_id, position)
    values (new_item_id, 0);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.id, 'position', entry.position,
    'repsMin', entry.reps_min, 'repsMax', entry.reps_max,
    'targetRpeMin', entry.target_rpe_min, 'targetRpeMax', entry.target_rpe_max,
    'rounds', entry.rounds, 'workSeconds', entry.work_seconds,
    'restSeconds', entry.rest_seconds, 'durationSeconds', entry.duration_seconds
  ) order by entry.position), '[]'::jsonb)
  into prescribed_payload
  from public.prescribed_entries entry
  where entry.workout_item_id = new_item_id;

  return jsonb_build_object(
    'id', new_item_id, 'sourceExerciseId', source_exercise.id,
    'name', source_exercise.name, 'cue', source_exercise.cue,
    'exerciseCategory', source_exercise.category, 'videoUrl', source_exercise.video_url, 'videoLinks', source_exercise.video_links,
    'entryMode', source_exercise.default_entry_mode,
    'trackingFields', source_exercise.default_tracking_fields,
    'position', next_position, 'prescribedEntries', prescribed_payload
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_authored_coach_session_detail(target_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result_payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  select jsonb_build_object(
    'id', session.id,
    'programRunId', session.program_run_id,
    'programRunWorkoutId', session.program_run_workout_id,
    'programVersionId', session.program_version_id,
    'workoutId', session.workout_id,
    'scheduledWorkoutId', session.scheduled_workout_id,
    'workoutTitle', session.workout_title,
    'startedAt', session.started_at,
    'completedAt', session.completed_at,
    'completedForDate', session.completed_for_date,
    'sessionRpe', session.session_rpe,
    'items', coalesce((
      select jsonb_agg(item_payload.payload order by item_payload.position, item_payload.id)
      from (
        select item.id, item.position, jsonb_build_object(
          'id', item.id,
          'title', item.snapshot_name,
          'cue', item.snapshot_cue,
          'exerciseCategory', item.snapshot_category,
          'videoUrl', item.snapshot_video_url, 'videoLinks', item.snapshot_video_links,
          'mode', item.entry_mode,
          'fields', item.tracking_fields,
          'position', item.position,
          'entries', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', entry.id,
              'position', entry.position,
              'reps', entry.reps,
              'loadKg', entry.load_kg,
              'durationSeconds', entry.duration_seconds,
              'distanceMetres', entry.distance_metres,
              'rounds', entry.rounds,
              'heartRate', entry.heart_rate,
              'rpe', entry.rpe
            ) order by entry.position, entry.id)
            from public.session_entries entry
            where entry.session_item_log_id = item.id
          ), '[]'::jsonb)
        ) as payload
        from public.session_item_logs item
        where item.workout_session_id = session.id
      ) item_payload
    ), '[]'::jsonb)
  ) into result_payload
  from public.workout_sessions session
  where session.id = target_session_id
    and session.status = 'completed'
    and public.can_read_authored_session(session.id);

  return result_payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_workspace_bootstrap()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := (select auth.uid());
  result_payload jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  with active_session as materialized (
    select session.*
    from public.workout_sessions session
    where session.athlete_id = current_user_id
      and session.status = 'in_progress'
    order by session.started_at desc, session.id
    limit 1
  )
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profile.id,
      'firstName', profile.first_name,
      'lastName', profile.last_name,
      'displayName', profile.display_name,
      'liftlogId', profile.liftlog_id,
      'weekStartsOnSunday', profile.week_starts_on_sunday,
      'weightUnit', profile.weight_unit,
      'distanceUnit', profile.distance_unit,
      'timezone', profile.timezone
    ),
    'coachingAccess', jsonb_build_object(
      'hasCoach', exists (
        select 1
        from public.coach_relationships relationship
        where relationship.athlete_id = current_user_id
          and relationship.ended_at is null
      ),
      'coachedAthleteCount', (
        select count(*)
        from public.coach_relationships relationship
        where relationship.coach_id = current_user_id
          and relationship.ended_at is null
      ),
      'pendingInviteCount', (
        select count(*)
        from public.coach_invites invite
        where invite.invited_profile_id = current_user_id
          and invite.status = 'pending'
          and invite.expires_at > now()
      )
    ),
    'activeSession', (
      select jsonb_build_object(
        'id', session.id,
        'draftRevision', session.draft_revision,
        'draftWriteToken', session.draft_write_token,
        'draftSavedAt', session.draft_saved_at,
        'assignmentId', session.assignment_id,
        'programRunId', session.program_run_id,
        'programRunWorkoutId', session.program_run_workout_id,
        'programVersionId', session.program_version_id,
        'workoutId', session.workout_id,
        'scheduledWorkoutId', session.scheduled_workout_id,
        'workoutTitle', session.workout_title,
        'startedAt', session.started_at,
        'sessionRpe', session.session_rpe,
        'sessionNote', session.athlete_note,
        'itemLogIds', coalesce((
          select jsonb_object_agg(
            item.source_workout_item_id::text,
            item.id
            order by item.position, item.id
          ) filter (where item.source_workout_item_id is not null)
          from public.session_item_logs item
          where item.workout_session_id = session.id
        ), '{}'::jsonb),
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'itemLogId', item.id,
              'sourceWorkoutItemId', item.source_workout_item_id,
              'name', item.snapshot_name,
              'cue', item.snapshot_cue,
              'videoUrl', item.snapshot_video_url, 'videoLinks', item.snapshot_video_links,
              'entryMode', item.entry_mode,
              'trackingFields', item.tracking_fields,
              'position', item.position,
              'note', item.athlete_note,
              'entries', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', entry.id,
                    'position', entry.position,
                    'reps', entry.reps,
                    'loadKg', entry.load_kg,
                    'durationSeconds', entry.duration_seconds,
                    'distanceMetres', entry.distance_metres,
                    'rounds', entry.rounds,
                    'heartRate', entry.heart_rate,
                    'rpe', entry.rpe,
                    'note', entry.note
                  ) order by entry.position, entry.id
                )
                from public.session_entries entry
                where entry.session_item_log_id = item.id
              ), '[]'::jsonb)
            ) order by item.position, item.id
          )
          from public.session_item_logs item
          where item.workout_session_id = session.id
        ), '[]'::jsonb)
      )
      from active_session session
    ),
    'activeWorkout', (
      select private.session_workout_content_payload(session.id)
      from active_session session
    ),
    'nextWorkouts', coalesce((
      select jsonb_agg(next_workout.payload order by next_workout.sort_status, next_workout.planned_date, next_workout.id)
      from (
        select
          occurrence.id,
          occurrence.planned_date,
          case when occurrence.status = 'in_progress' then 0 else 1 end as sort_status,
          jsonb_build_object(
            'id', occurrence.id,
            'assignmentId', occurrence.assignment_id,
            'programRunId', occurrence.program_run_id,
            'programRunWorkoutId', occurrence.program_run_workout_id,
            'scheduledById', occurrence.scheduled_by_id,
            'sourceType', case
              when occurrence.program_run_id is not null then coalesce((
                select case
                  when run.created_by_id <> run.athlete_id then 'coach'
                  else 'self'
                end
                from public.program_runs run
                where run.id = occurrence.program_run_id
              ), 'self')
              when occurrence.assignment_id is not null then 'coach'
              when occurrence.scheduled_by_id <> occurrence.athlete_id then 'coach'
              else 'self'
            end,
            'programVersionId', occurrence.program_version_id,
            'workoutId', occurrence.workout_id,
            'workoutTitle', workout.title,
            'estimatedMinutes', workout.estimated_minutes,
            'programTitle', version.title,
            'plannedDate', occurrence.planned_date,
            'sequenceNumber', occurrence.sequence_number,
            'status', occurrence.status
          ) as payload
        from public.scheduled_workouts occurrence
        join public.workouts workout on workout.id = occurrence.workout_id
        join public.program_versions version on version.id = occurrence.program_version_id
        where occurrence.athlete_id = current_user_id
          and occurrence.status in ('planned', 'in_progress')
          and occurrence.planned_date is not null
        order by sort_status, occurrence.planned_date, occurrence.id
        limit 6
      ) next_workout
    ), '[]'::jsonb)
  )
  into result_payload
  from public.profiles profile
  where profile.id = current_user_id;

  return result_payload;
end;
$function$;

-- Adding a result column requires recreating this exact existing signature.
drop function public.search_exercises(text, text, text[], text[], text[], text[], integer, text, uuid);
CREATE OR REPLACE FUNCTION public.search_exercises(search_text text DEFAULT ''::text, scope_filter text DEFAULT 'all'::text, discipline_filters text[] DEFAULT NULL::text[], category_filters text[] DEFAULT NULL::text[], mode_filters text[] DEFAULT NULL::text[], tracking_filters text[] DEFAULT NULL::text[], page_limit integer DEFAULT 50, after_name text DEFAULT NULL::text, after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, scope text, owner_id uuid, name text, category text, cue text, default_entry_mode text, default_tracking_fields text[], discipline text, tags text[], source_provider text, source_external_id text, source_url text, video_url text, source_metadata jsonb, video_links jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  normalized_search text := lower(trim(coalesce(search_text, '')));
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if length(normalized_search) > 100 then
    raise exception 'Exercise search is too long';
  end if;
  if scope_filter not in ('all', 'global', 'personal') then
    raise exception 'Exercise scope is invalid';
  end if;
  if coalesce(cardinality(discipline_filters), 0) > 3
    or not coalesce(
      discipline_filters <@ array['weightlifting', 'gym', 'functional']::text[],
      true
    ) then
    raise exception 'Exercise discipline is invalid';
  end if;
  if coalesce(cardinality(category_filters), 0) > 20
    or exists (
      select 1 from unnest(coalesce(category_filters, '{}'::text[])) category
      where length(trim(category)) = 0 or length(category) > 80
    ) then
    raise exception 'Exercise category filter is invalid';
  end if;
  if coalesce(cardinality(mode_filters), 0) > 4
    or not coalesce(
      mode_filters <@ array['none', 'sets', 'result', 'intervals']::text[],
      true
    ) then
    raise exception 'Exercise logging filter is invalid';
  end if;
  if coalesce(cardinality(tracking_filters), 0) > 8
    or not coalesce(
      tracking_filters <@ array[
        'reps', 'load', 'duration', 'distance', 'rounds', 'heartRate', 'rpe'
      ]::text[],
      true
    ) then
    raise exception 'Exercise tracking filter is invalid';
  end if;
  if (after_name is null) <> (after_id is null) then
    raise exception 'Exercise cursor is incomplete';
  end if;

  return query
  select
    exercise.id,
    exercise.scope,
    exercise.owner_id,
    exercise.name,
    exercise.category,
    exercise.cue,
    exercise.default_entry_mode,
    exercise.default_tracking_fields,
    exercise.discipline,
    exercise.tags,
    exercise.source_provider,
    exercise.source_external_id,
    exercise.source_url,
    exercise.video_url,
    exercise.source_metadata,
    exercise.video_links
  from public.exercises exercise
  where exercise.archived_at is null
    and (
      exercise.scope = 'global'
      or (exercise.scope = 'personal' and exercise.owner_id = current_user_id)
    )
    and (scope_filter = 'all' or exercise.scope = scope_filter)
    and (
      coalesce(cardinality(discipline_filters), 0) = 0
      or exercise.discipline = any(discipline_filters)
    )
    and (
      coalesce(cardinality(category_filters), 0) = 0
      or exercise.category = any(category_filters)
    )
    and (
      coalesce(cardinality(mode_filters), 0) = 0
      or exercise.default_entry_mode = any(mode_filters)
    )
    and exercise.default_tracking_fields
      @> coalesce(tracking_filters, '{}'::text[])
    and (
      normalized_search = ''
      or (
        lower(exercise.name) >= normalized_search
        and lower(exercise.name) < normalized_search || U&'\FFFF'
      )
    )
    and (
      after_name is null
      or (lower(exercise.name), exercise.id)
        > (lower(after_name), after_id)
    )
  order by lower(exercise.name), exercise.id
  limit least(greatest(coalesce(page_limit, 50), 1), 100);
end;
$function$;

revoke all on function public.search_exercises(text, text, text[], text[], text[], text[], integer, text, uuid) from public, anon, authenticated;
grant execute on function public.search_exercises(text, text, text[], text[], text[], text[], integer, text, uuid) to authenticated;
