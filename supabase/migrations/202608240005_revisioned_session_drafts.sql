-- Autosave is a complete, revisioned session snapshot. The new path is
-- additive for a coordinated rollout: legacy entry writes and the legacy
-- completion RPC remain available until a later contract migration.

alter table public.workout_sessions
  add column draft_revision bigint not null default 0
    check (draft_revision >= 0),
  add column draft_write_token uuid,
  add column draft_write_payload_hash text,
  add column draft_saved_at timestamptz,
  add column completion_token uuid;

alter table public.workout_sessions
  add constraint workout_sessions_draft_confirmation_check check (
    (draft_revision = 0)
    or (
      draft_write_token is not null
      and draft_write_payload_hash is not null
      and draft_saved_at is not null
    )
  );

create or replace function private.validate_workout_draft_payload(
  target_session_id uuid,
  draft_payload jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  payload_item_ids uuid[];
  session_item_ids uuid[];
  payload_item_count integer;
  distinct_item_count integer;
  payload_entry_count integer;
begin
  if jsonb_typeof(draft_payload) is distinct from 'object' then
    raise exception 'Workout draft payload must be a JSON object';
  end if;
  if octet_length(draft_payload::text) > 1000000 then
    raise exception 'Workout draft payload exceeds 1 MB';
  end if;
  if not (draft_payload ? 'items')
    or jsonb_typeof(draft_payload -> 'items') is distinct from 'array' then
    raise exception 'Workout draft payload must contain an items array';
  end if;
  if not (draft_payload ? 'sessionRpe')
    or jsonb_typeof(draft_payload -> 'sessionRpe') not in ('number', 'null') then
    raise exception 'Workout draft sessionRpe must be a JSON number or null';
  end if;
  if not (draft_payload ? 'sessionNote')
    or jsonb_typeof(draft_payload -> 'sessionNote') is distinct from 'string' then
    raise exception 'Workout draft sessionNote must be a string';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(draft_payload) payload_key(name)
    where payload_key.name not in ('items', 'sessionRpe', 'sessionNote')
  ) then
    raise exception 'Workout draft payload contains unsupported properties';
  end if;
  if draft_payload ->> 'sessionRpe' is not null and (
    (draft_payload ->> 'sessionRpe')::numeric < 1
    or (draft_payload ->> 'sessionRpe')::numeric > 10
    or (draft_payload ->> 'sessionRpe')::numeric
      <> trunc((draft_payload ->> 'sessionRpe')::numeric)
  ) then
    raise exception 'Workout draft sessionRpe must be a whole number between 1 and 10';
  end if;
  if length(draft_payload ->> 'sessionNote') > 4000 then
    raise exception 'Workout draft sessionNote cannot exceed 4000 characters';
  end if;

  payload_item_count := jsonb_array_length(draft_payload -> 'items');
  if payload_item_count > 250 then
    raise exception 'Workout draft cannot contain more than 250 items';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    where jsonb_typeof(payload_item.value) is distinct from 'object'
  ) then
    raise exception 'Every workout draft item must be a JSON object';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    where not (payload_item.value ? 'itemLogId')
      or jsonb_typeof(payload_item.value -> 'itemLogId') is distinct from 'string'
      or not (payload_item.value ? 'entries')
      or jsonb_typeof(payload_item.value -> 'entries') is distinct from 'array'
  ) then
    raise exception 'Every workout draft item needs itemLogId and entries';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    cross join lateral jsonb_object_keys(payload_item.value) item_key(name)
    where item_key.name not in ('itemLogId', 'entries')
  ) then
    raise exception 'Workout draft item contains unsupported properties';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    where payload_item.value ->> 'itemLogId'
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'Workout draft itemLogId must be a UUID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    where jsonb_array_length(payload_item.value -> 'entries') > 250
  ) then
    raise exception 'A workout item cannot contain more than 250 entries';
  end if;

  select
    coalesce(
      array_agg(
        (payload_item.value ->> 'itemLogId')::uuid
        order by (payload_item.value ->> 'itemLogId')::uuid
      ),
      array[]::uuid[]
    ),
    count(distinct (payload_item.value ->> 'itemLogId')::uuid)::integer
  into payload_item_ids, distinct_item_count
  from jsonb_array_elements(draft_payload -> 'items') payload_item(value);

  if distinct_item_count <> payload_item_count then
    raise exception 'Workout draft contains duplicate itemLogId values';
  end if;

  select coalesce(array_agg(item.id order by item.id), array[]::uuid[])
  into session_item_ids
  from public.session_item_logs item
  where item.workout_session_id = target_session_id;

  if payload_item_ids is distinct from session_item_ids then
    raise exception 'Workout draft must contain the complete session item set';
  end if;

  select count(*)::integer
  into payload_entry_count
  from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
  cross join lateral jsonb_array_elements(
    payload_item.value -> 'entries'
  ) payload_entry(value);
  if payload_entry_count > 5000 then
    raise exception 'Workout draft cannot contain more than 5000 entries';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    cross join lateral jsonb_array_elements(
      payload_item.value -> 'entries'
    ) payload_entry(value)
    where jsonb_typeof(payload_entry.value) is distinct from 'object'
  ) then
    raise exception 'Every workout draft entry must be a JSON object';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    cross join lateral jsonb_array_elements(
      payload_item.value -> 'entries'
    ) payload_entry(value)
    cross join lateral jsonb_object_keys(payload_entry.value) entry_key(name)
    where entry_key.name not in (
      'position',
      'reps',
      'loadKg',
      'durationSeconds',
      'distanceMetres',
      'rounds',
      'heartRate',
      'rpe'
    )
  ) then
    raise exception 'Workout draft entry contains unsupported properties';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    cross join lateral jsonb_array_elements(
      payload_item.value -> 'entries'
    ) payload_entry(value)
    where not (payload_entry.value ? 'position')
      or jsonb_typeof(payload_entry.value -> 'position') is distinct from 'number'
      or coalesce(payload_entry.value ->> 'position', '') !~ '^(0|[1-9][0-9]{0,3})$'
  ) then
    raise exception 'Workout draft entry position must be an integer from 0 to 4999';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    cross join lateral jsonb_array_elements(
      payload_item.value -> 'entries'
    ) payload_entry(value)
    where (payload_entry.value ->> 'position')::integer >= 5000
  ) then
    raise exception 'Workout draft entry position must be an integer from 0 to 4999';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    cross join lateral jsonb_array_elements(
      payload_item.value -> 'entries'
    ) payload_entry(value)
    cross join lateral (
      values
        ('reps'),
        ('loadKg'),
        ('durationSeconds'),
        ('distanceMetres'),
        ('rounds'),
        ('heartRate'),
        ('rpe')
    ) allowed_field(name)
    where payload_entry.value ? allowed_field.name
      and jsonb_typeof(payload_entry.value -> allowed_field.name)
        not in ('number', 'null')
  ) then
    raise exception 'Workout draft values must be JSON numbers or null';
  end if;

  -- Integer-backed columns reject fractions before any cast can occur.
  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    cross join lateral jsonb_array_elements(
      payload_item.value -> 'entries'
    ) payload_entry(value)
    cross join lateral (
      values ('durationSeconds'), ('rounds'), ('heartRate')
    ) integer_field(name)
    where payload_entry.value ->> integer_field.name is not null
      and payload_entry.value ->> integer_field.name !~ '^(0|[1-9][0-9]{0,9})$'
  ) then
    raise exception 'Duration, rounds, and heart rate must be whole numbers';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    cross join lateral jsonb_array_elements(
      payload_item.value -> 'entries'
    ) payload_entry(value)
    where (
        payload_entry.value ->> 'reps' is not null
        and (
          (payload_entry.value ->> 'reps')::numeric < 0
          or (payload_entry.value ->> 'reps')::numeric > 100000
        )
      )
      or (
        payload_entry.value ->> 'loadKg' is not null
        and (
          (payload_entry.value ->> 'loadKg')::numeric < 0
          or (payload_entry.value ->> 'loadKg')::numeric > 100000
        )
      )
      or (
        payload_entry.value ->> 'durationSeconds' is not null
        and (payload_entry.value ->> 'durationSeconds')::numeric > 604800
      )
      or (
        payload_entry.value ->> 'distanceMetres' is not null
        and (
          (payload_entry.value ->> 'distanceMetres')::numeric < 0
          or (payload_entry.value ->> 'distanceMetres')::numeric > 10000000
        )
      )
      or (
        payload_entry.value ->> 'rounds' is not null
        and (payload_entry.value ->> 'rounds')::numeric > 100000
      )
      or (
        payload_entry.value ->> 'heartRate' is not null
        and (
          (payload_entry.value ->> 'heartRate')::numeric < 1
          or (payload_entry.value ->> 'heartRate')::numeric > 400
        )
      )
      or (
        payload_entry.value ->> 'rpe' is not null
        and (
          (payload_entry.value ->> 'rpe')::numeric < 1
          or (payload_entry.value ->> 'rpe')::numeric > 10
          or (payload_entry.value ->> 'rpe')::numeric
            <> trunc((payload_entry.value ->> 'rpe')::numeric)
        )
      )
  ) then
    raise exception 'Workout draft contains an out-of-range value';
  end if;

  if exists (
    with expanded_entries as (
      select
        (payload_item.value ->> 'itemLogId')::uuid as item_log_id,
        (payload_entry.value ->> 'position')::integer as position
      from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
      cross join lateral jsonb_array_elements(
        payload_item.value -> 'entries'
      ) payload_entry(value)
    )
    select 1
    from expanded_entries entry
    group by entry.item_log_id, entry.position
    having count(*) > 1
  ) then
    raise exception 'Workout draft contains duplicate entry positions';
  end if;

  if exists (
    with expanded_entries as (
      select
        (payload_item.value ->> 'itemLogId')::uuid as item_log_id,
        (payload_entry.value ->> 'position')::integer as position
      from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
      cross join lateral jsonb_array_elements(
        payload_item.value -> 'entries'
      ) payload_entry(value)
    )
    select 1
    from expanded_entries entry
    group by entry.item_log_id
    having min(entry.position) <> 0
      or max(entry.position) <> count(*) - 1
  ) then
    raise exception 'Workout draft entry positions must be contiguous from zero';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    join public.session_item_logs item
      on item.id = (payload_item.value ->> 'itemLogId')::uuid
    where (
        item.entry_mode = 'none'
        and jsonb_array_length(payload_item.value -> 'entries') <> 0
      )
      or (
        item.entry_mode in ('result', 'intervals')
        and jsonb_array_length(payload_item.value -> 'entries') > 1
      )
  ) then
    raise exception 'Workout draft entry count does not match its item mode';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
    cross join lateral jsonb_array_elements(
      payload_item.value -> 'entries'
    ) payload_entry(value)
    join public.session_item_logs item
      on item.id = (payload_item.value ->> 'itemLogId')::uuid
    where (
        payload_entry.value ->> 'reps' is not null
        and not ('reps' = any(item.tracking_fields))
      )
      or (
        payload_entry.value ->> 'loadKg' is not null
        and not ('load' = any(item.tracking_fields))
      )
      or (
        payload_entry.value ->> 'durationSeconds' is not null
        and not ('duration' = any(item.tracking_fields))
      )
      or (
        payload_entry.value ->> 'distanceMetres' is not null
        and not ('distance' = any(item.tracking_fields))
      )
      or (
        payload_entry.value ->> 'rounds' is not null
        and not ('rounds' = any(item.tracking_fields))
      )
      or (
        payload_entry.value ->> 'heartRate' is not null
        and not ('heartRate' = any(item.tracking_fields))
      )
      or (
        payload_entry.value ->> 'rpe' is not null
        and not ('rpe' = any(item.tracking_fields))
      )
  ) then
    raise exception 'Workout draft contains a value that this item does not track';
  end if;
end;
$$;

create or replace function public.save_workout_session_draft(
  target_session_id uuid,
  expected_revision bigint,
  write_token uuid,
  draft_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_status text;
  current_revision bigint;
  current_write_token uuid;
  current_payload_hash text;
  current_saved_at timestamptz;
  requested_payload_hash text := encode(
    extensions.digest(draft_payload::text, 'sha256'),
    'hex'
  );
  next_revision bigint;
  saved_at_value timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if expected_revision is null or expected_revision < 0 then
    raise exception 'Expected workout draft revision must be zero or greater';
  end if;
  if write_token is null then
    raise exception 'Workout draft write token is required';
  end if;

  select
    session.status,
    session.draft_revision,
    session.draft_write_token,
    session.draft_write_payload_hash,
    session.draft_saved_at
  into
    current_status,
    current_revision,
    current_write_token,
    current_payload_hash,
    current_saved_at
  from public.workout_sessions session
  where session.id = target_session_id
    and session.athlete_id = current_user_id
  for update;
  if not found then
    raise exception 'Workout session not found';
  end if;

  if current_write_token is not distinct from write_token then
    if current_payload_hash is distinct from requested_payload_hash then
      raise exception 'Workout draft token was already used with a different payload';
    end if;
    return jsonb_build_object(
      'revision', current_revision,
      'savedAt', current_saved_at
    );
  end if;
  if current_status <> 'in_progress' then
    raise exception 'Workout draft can only be saved while the session is in progress';
  end if;
  if expected_revision is distinct from current_revision then
    raise exception using
      errcode = '40001',
      message = 'Workout draft revision is stale';
  end if;

  perform private.validate_workout_draft_payload(
    target_session_id,
    draft_payload
  );

  insert into public.session_entries (
    session_item_log_id,
    position,
    reps,
    load_kg,
    duration_seconds,
    distance_metres,
    rounds,
    heart_rate,
    rpe
  )
  select
    (payload_item.value ->> 'itemLogId')::uuid,
    (payload_entry.value ->> 'position')::integer,
    (payload_entry.value ->> 'reps')::numeric,
    (payload_entry.value ->> 'loadKg')::numeric,
    (payload_entry.value ->> 'durationSeconds')::integer,
    (payload_entry.value ->> 'distanceMetres')::numeric,
    (payload_entry.value ->> 'rounds')::integer,
    (payload_entry.value ->> 'heartRate')::integer,
    (payload_entry.value ->> 'rpe')::numeric
  from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
  cross join lateral jsonb_array_elements(
    payload_item.value -> 'entries'
  ) payload_entry(value)
  on conflict (session_item_log_id, position) do update
  set
    reps = excluded.reps,
    load_kg = excluded.load_kg,
    duration_seconds = excluded.duration_seconds,
    distance_metres = excluded.distance_metres,
    rounds = excluded.rounds,
    heart_rate = excluded.heart_rate,
    rpe = excluded.rpe;

  delete from public.session_entries existing_entry
  using public.session_item_logs item
  where existing_entry.session_item_log_id = item.id
    and item.workout_session_id = target_session_id
    and not exists (
      select 1
      from jsonb_array_elements(draft_payload -> 'items') payload_item(value)
      cross join lateral jsonb_array_elements(
        payload_item.value -> 'entries'
      ) payload_entry(value)
      where (payload_item.value ->> 'itemLogId')::uuid = item.id
        and (payload_entry.value ->> 'position')::integer
          = existing_entry.position
    );

  next_revision := current_revision + 1;
  saved_at_value := clock_timestamp();
  update public.workout_sessions
  set
    draft_revision = next_revision,
    draft_write_token = write_token,
    draft_write_payload_hash = requested_payload_hash,
    draft_saved_at = saved_at_value,
    session_rpe = (draft_payload ->> 'sessionRpe')::numeric,
    athlete_note = draft_payload ->> 'sessionNote'
  where id = target_session_id;

  return jsonb_build_object(
    'revision', next_revision,
    'savedAt', saved_at_value
  );
end;
$$;

create or replace function public.complete_workout_session_confirmed(
  target_session_id uuid,
  expected_revision bigint,
  completion_token uuid,
  final_rpe numeric,
  final_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_completion_token uuid := completion_token;
  current_status text;
  current_revision bigint;
  stored_completion_token uuid;
  stored_session_rpe numeric;
  stored_session_note text;
  scheduled_id uuid;
  scheduled_date date;
  completed_version_id uuid;
  completed_program_id uuid;
  completed_planning_mode text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if expected_revision is null or expected_revision <= 0 then
    raise exception 'Expected workout draft revision must be one or greater';
  end if;
  if requested_completion_token is null then
    raise exception 'Workout completion token is required';
  end if;
  if final_rpe is not null and (
    final_rpe < 1
    or final_rpe > 10
    or final_rpe <> trunc(final_rpe)
  ) then
    raise exception 'Session RPE must be a whole number between 1 and 10';
  end if;
  if length(coalesce(final_note, '')) > 4000 then
    raise exception 'Session note cannot exceed 4000 characters';
  end if;

  select
    session.status,
    session.draft_revision,
    session.completion_token,
    session.session_rpe,
    session.athlete_note,
    session.scheduled_workout_id
  into
    current_status,
    current_revision,
    stored_completion_token,
    stored_session_rpe,
    stored_session_note,
    scheduled_id
  from public.workout_sessions session
  where session.id = target_session_id
    and session.athlete_id = current_user_id
  for update;
  if not found then
    raise exception 'Workout session not found';
  end if;

  if current_status = 'completed' then
    if stored_completion_token is not distinct from requested_completion_token then
      if expected_revision is distinct from current_revision
        or final_rpe is distinct from stored_session_rpe
        or coalesce(final_note, '') is distinct from stored_session_note then
        raise exception 'Completion token was already used with different values';
      end if;
      return target_session_id;
    end if;
    raise exception 'Workout session was already completed';
  end if;
  if current_status <> 'in_progress' then
    raise exception 'In-progress session not found';
  end if;
  if current_revision = 0 then
    raise exception 'Workout completion requires a confirmed draft';
  end if;
  if expected_revision is distinct from current_revision then
    raise exception using
      errcode = '40001',
      message = 'Workout draft revision is stale';
  end if;
  if final_rpe is distinct from stored_session_rpe
    or coalesce(final_note, '') is distinct from stored_session_note then
    raise exception 'Completion values must match the confirmed workout draft';
  end if;

  if scheduled_id is not null then
    select scheduled.planned_date
    into scheduled_date
    from public.scheduled_workouts scheduled
    where scheduled.id = scheduled_id
      and scheduled.athlete_id = current_user_id;
  end if;

  update public.workout_sessions
  set
    status = 'completed',
    completed_at = now(),
    completed_for_date = coalesce(scheduled_date, current_date),
    session_rpe = final_rpe,
    athlete_note = coalesce(final_note, ''),
    completion_token = requested_completion_token
  where id = target_session_id;

  if scheduled_id is not null then
    update public.scheduled_workouts
    set status = 'completed'
    where id = scheduled_id
      and athlete_id = current_user_id
    returning program_version_id into completed_version_id;

    select program.id, program.planning_mode
    into completed_program_id, completed_planning_mode
    from public.program_versions version
    join public.programs program on program.id = version.program_id
    where version.id = completed_version_id;

    if completed_planning_mode = 'fixed_weeks' and not exists (
      select 1
      from public.scheduled_workouts scheduled
      where scheduled.program_version_id = completed_version_id
        and scheduled.athlete_id = current_user_id
        and scheduled.status in ('planned', 'in_progress')
    ) then
      delete from public.program_availability availability
      where availability.athlete_id = current_user_id
        and availability.program_id = completed_program_id;
    end if;
  end if;

  return target_session_id;
end;
$$;

revoke all on function private.validate_workout_draft_payload(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_workout_session_draft(uuid, bigint, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_workout_session_confirmed(
  uuid,
  bigint,
  uuid,
  numeric,
  text
) from public, anon, authenticated;

grant execute on function public.save_workout_session_draft(
  uuid,
  bigint,
  uuid,
  jsonb
) to authenticated;
grant execute on function public.complete_workout_session_confirmed(
  uuid,
  bigint,
  uuid,
  numeric,
  text
) to authenticated;

-- Session item snapshots are created only by the transactional start RPC.
-- Neither the rollback UI nor the revisioned client mutates them directly.
revoke insert, update, delete on public.session_item_logs from authenticated;

-- Compatibility/rollback window: the old UI can still save entries directly
-- and invoke the three-argument completion RPC. A later contract migration must
-- revoke both after the compatible frontend has passed its smoke gate.
grant insert, update, delete on public.session_entries to authenticated;
grant execute on function public.complete_workout_session(uuid, numeric, text)
  to authenticated;

select pg_catalog.set_config('search_path', 'public', false);
