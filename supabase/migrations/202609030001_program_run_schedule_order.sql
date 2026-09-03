-- Preserve the immutable program order when assigning occurrence sequence
-- numbers. The canonical request JSON is deliberately UUID-sorted for
-- idempotency comparisons, so it must not determine presentation order.
create or replace function public.schedule_program_run_workouts(
  target_run_id uuid,
  target_workout_dates jsonb,
  target_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_run public.program_runs%rowtype;
  normalized_dates jsonb;
  requested record;
  slot public.program_run_workouts%rowtype;
  next_sequence integer;
  request_receipt public.program_run_schedule_requests%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if target_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  select run.* into target_run
  from public.program_runs run
  where run.id = target_run_id
    and (
      run.athlete_id = current_user_id
      or (
        run.created_by_id = current_user_id
        and exists (
          select 1 from public.coach_relationships relationship
          where relationship.athlete_id = run.athlete_id
            and relationship.coach_id = current_user_id
            and relationship.ended_at is null
        )
      )
    )
  for update;
  if not found then raise exception 'Active program run was not found'; end if;
  normalized_dates := private.canonical_program_run_dates(
    target_run.program_version_id, target_workout_dates
  );
  perform private.validate_program_run_date_order(
    target_run.id, normalized_dates
  );

  insert into public.program_run_schedule_requests (
    requested_by_id, request_key, program_run_id, canonical_schedule
  ) values (
    current_user_id, target_idempotency_key, target_run.id, normalized_dates
  )
  on conflict (requested_by_id, request_key) do nothing
  returning * into request_receipt;

  if not found then
    select receipt.* into request_receipt
    from public.program_run_schedule_requests receipt
    where receipt.requested_by_id = current_user_id
      and receipt.request_key = target_idempotency_key;
    if request_receipt.program_run_id is distinct from target_run.id
      or request_receipt.canonical_schedule is distinct from normalized_dates then
      raise exception 'Idempotency key was already used for another schedule change';
    end if;
    return jsonb_build_object('runId', target_run.id);
  end if;

  if target_run.status in ('completed', 'ended') then
    raise exception 'Active program run was not found';
  end if;

  perform profile.id from public.profiles profile
  where profile.id = target_run.athlete_id for update;
  select coalesce(max(occurrence.sequence_number), 0)
  into next_sequence
  from public.scheduled_workouts occurrence
  where occurrence.athlete_id = target_run.athlete_id
    and occurrence.program_version_id = target_run.program_version_id;

  perform pg_catalog.set_config('liftlog.program_run_bulk_sync', 'on', true);
  for requested in
    select
      (entry ->> 'workoutId')::uuid as workout_id,
      nullif(entry ->> 'plannedDate', '')::date as planned_date
    from jsonb_array_elements(normalized_dates) entry
    join public.program_run_workouts ordered_slot
      on ordered_slot.program_run_id = target_run.id
      and ordered_slot.workout_id = (entry ->> 'workoutId')::uuid
      and ordered_slot.status in ('unscheduled', 'scheduled')
    order by ordered_slot.position, ordered_slot.id
  loop
    select candidate.* into slot
    from public.program_run_workouts candidate
    where candidate.program_run_id = target_run.id
      and candidate.workout_id = requested.workout_id
      and candidate.status in ('unscheduled', 'scheduled')
    order by candidate.position
    limit 1
    for update;
    if not found then raise exception 'Only future run workouts can be rescheduled'; end if;

    if slot.scheduled_workout_id is null and requested.planned_date is not null then
      next_sequence := next_sequence + 1;
      insert into public.scheduled_workouts (
        athlete_id, scheduled_by_id, assignment_id, program_version_id,
        workout_id, planned_date, sequence_number, status, request_key,
        program_run_id, program_run_workout_id
      ) values (
        target_run.athlete_id, current_user_id, target_run.legacy_assignment_id,
        target_run.program_version_id, slot.workout_id, requested.planned_date,
        next_sequence, 'planned', gen_random_uuid(), target_run.id, slot.id
      );
    elsif slot.scheduled_workout_id is not null then
      update public.scheduled_workouts
      set planned_date = requested.planned_date
      where id = slot.scheduled_workout_id and status = 'planned';
      if not found then raise exception 'Only future run workouts can be rescheduled'; end if;
    end if;
  end loop;
  perform pg_catalog.set_config('liftlog.program_run_bulk_sync', 'off', true);
  perform private.refresh_program_run_status(target_run.id);
  return jsonb_build_object('runId', target_run.id);
end;
$$;
