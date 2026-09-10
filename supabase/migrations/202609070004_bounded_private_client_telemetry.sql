-- Diagnostics contain allowlisted numbers/enums only. Account identity is used
-- only in the private short-lived rate limiter, never in stored event records.
create table private.client_telemetry_events (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default clock_timestamp(),
  release_sha text not null,
  environment text not null check (environment in ('local','development','production','test')),
  kind text not null check (kind in ('performance','error')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
create index client_telemetry_events_recorded_at_idx on private.client_telemetry_events(recorded_at);
create index client_telemetry_events_environment_recorded_idx on private.client_telemetry_events(environment, recorded_at);
create table private.client_telemetry_rate_limits (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  minute_start timestamptz not null,
  event_count integer not null check (event_count between 1 and 20),
  primary key (actor_id, minute_start)
);
alter table private.client_telemetry_events enable row level security;
alter table private.client_telemetry_rate_limits enable row level security;
revoke all on private.client_telemetry_events, private.client_telemetry_rate_limits from public, anon, authenticated;
revoke all on sequence private.client_telemetry_events_id_seq from public, anon, authenticated;
grant select on private.client_telemetry_events to service_role;

create function private.prune_client_telemetry()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare removed_events bigint; removed_limits bigint;
begin
  delete from private.client_telemetry_events where recorded_at < clock_timestamp() - interval '7 days';
  get diagnostics removed_events = row_count;
  delete from private.client_telemetry_rate_limits where minute_start < date_trunc('minute', clock_timestamp()) - interval '2 minutes';
  get diagnostics removed_limits = row_count;
  return jsonb_build_object('removedEvents', removed_events, 'removedRateLimits', removed_limits);
end;
$$;
revoke all on function private.prune_client_telemetry() from public, anon, authenticated;
grant execute on function private.prune_client_telemetry() to service_role;

create function public.collect_client_telemetry(events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  entry jsonb;
  body jsonb;
  field text;
  batch_size integer;
  allocated integer;
  minute_bucket timestamptz := date_trunc('minute', clock_timestamp());
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if events is null or jsonb_typeof(events) <> 'array' or pg_column_size(events) > 16384 then
    raise exception 'Telemetry must be a bounded event array';
  end if;
  batch_size := jsonb_array_length(events);
  if batch_size < 1 or batch_size > 10 then raise exception 'Telemetry batches require 1 to 10 events'; end if;
  for entry in select value from jsonb_array_elements(events) loop
    if jsonb_typeof(entry) <> 'object' then raise exception 'Invalid telemetry event'; end if;
    if exists (select 1 from jsonb_object_keys(entry) key
      where key not in ('schemaVersion','releaseSha','environment','recordedAt','kind','payload')) then
      raise exception 'Telemetry contains unsupported fields';
    end if;
    if entry->'schemaVersion' is distinct from '1'::jsonb
      or jsonb_typeof(entry->'releaseSha') is distinct from 'string'
      or (entry->>'releaseSha') !~ '^([a-f0-9]{7,40}|local|development|test)$'
      or coalesce(entry->>'environment','') not in ('local','development','production','test')
      or coalesce(entry->>'kind','') not in ('performance','error')
      or jsonb_typeof(entry->'payload') is distinct from 'object' then
      raise exception 'Invalid telemetry event';
    end if;
    -- Client time is never persisted; this field is accepted only for compatibility
    -- with the local envelope and has no effect on retention or reports.
    if entry ? 'recordedAt' and (
      jsonb_typeof(entry->'recordedAt') is distinct from 'string'
      or (entry->>'recordedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    ) then raise exception 'Invalid telemetry timestamp'; end if;
    body := entry->'payload';
    if entry->>'kind' = 'error' then
      if exists (select 1 from jsonb_object_keys(body) key where key not in ('category','operation','fatal','retryable'))
        or coalesce(body->>'category','') not in ('render','network','authentication','storage','conflict','unknown')
        or coalesce(body->>'operation','') not in ('bootstrap','navigation','detail','save','sync','authentication','render','unknown')
        or jsonb_typeof(body->'fatal') is distinct from 'boolean'
        or jsonb_typeof(body->'retryable') is distinct from 'boolean' then
        raise exception 'Invalid telemetry error';
      end if;
    else
      if exists (select 1 from jsonb_object_keys(body) key where key not in (
        'name','durationMs','outcome','requestCount','retries','cardinalityBucket','roleBucket','phase'
      )) or coalesce(body->>'name','') not in ('bootstrap','navigation','detail','save','long-task','interaction')
        or jsonb_typeof(body->'durationMs') is distinct from 'number' then
        raise exception 'Invalid telemetry performance event';
      end if;
      if (body->>'durationMs')::numeric < 0 or (body->>'durationMs')::numeric > 86400000 then
        raise exception 'Invalid telemetry duration';
      end if;
      foreach field in array array['requestCount','retries'] loop
        if body ? field then
          if jsonb_typeof(body->field) is distinct from 'number' then raise exception 'Invalid telemetry count'; end if;
          if (body->>field)::numeric < 0 or (body->>field)::numeric > 100000
            or (body->>field)::numeric <> trunc((body->>field)::numeric) then
            raise exception 'Invalid telemetry count';
          end if;
        end if;
      end loop;
      if (body ? 'outcome' and coalesce(body->>'outcome','') not in ('success','failure','cancelled'))
        or (body ? 'cardinalityBucket' and coalesce(body->>'cardinalityBucket','') not in ('0','1-10','11-50','51-250','251+'))
        or (body ? 'roleBucket' and coalesce(body->>'roleBucket','') not in ('athlete','coach','both','unknown'))
        or (body ? 'phase' and coalesce(body->>'phase','') not in ('shell','repository')) then
        raise exception 'Invalid telemetry performance category';
      end if;
    end if;
  end loop;

  perform private.prune_client_telemetry();
  insert into private.client_telemetry_rate_limits (actor_id, minute_start, event_count)
  values (actor, minute_bucket, batch_size)
  on conflict (actor_id, minute_start) do update
    set event_count = private.client_telemetry_rate_limits.event_count + excluded.event_count
    where private.client_telemetry_rate_limits.event_count + excluded.event_count <= 20
  returning event_count into allocated;
  if allocated is null then return jsonb_build_object('accepted', 0, 'rateLimited', true); end if;

  insert into private.client_telemetry_events (release_sha, environment, kind, payload)
  select submitted.value->>'releaseSha', submitted.value->>'environment',
    submitted.value->>'kind', submitted.value->'payload'
  from jsonb_array_elements(events) submitted(value);
  return jsonb_build_object('accepted', batch_size, 'rateLimited', false);
end;
$$;
revoke all on function public.collect_client_telemetry(jsonb) from public, anon;
grant execute on function public.collect_client_telemetry(jsonb) to authenticated;

-- Supabase preloads pg_cron in its primary postgres database. Separate local
-- migration-rehearsal databases cannot install that extension; their schema is
-- still validated, while the primary database supplies the actual retention job.
do $$
begin
  if current_database() = coalesce(current_setting('cron.database_name', true), 'postgres') then
    create extension if not exists pg_cron;
    perform cron.schedule('liftlog-client-telemetry-retention', '*/15 * * * *',
      'select private.prune_client_telemetry()');
  end if;
end;
$$;
