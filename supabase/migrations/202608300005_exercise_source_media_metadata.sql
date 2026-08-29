-- Keep third-party catalogue provenance separate from Lift Log's editable
-- presentation fields. The flexible metadata object preserves source grouping
-- details without making the application depend on Catalyst's current IA.

alter table public.exercises
  add column source_provider text,
  add column source_external_id text,
  add column source_url text,
  add column video_url text,
  add column source_metadata jsonb not null default '{}'::jsonb;

create unique index idx_exercises_global_external_source
  on public.exercises (source_provider, source_external_id)
  where scope = 'global'
    and source_provider is not null
    and source_external_id is not null;

drop function public.search_exercises(
  text, text, text[], text[], text[], text[], integer, text, uuid
);

create function public.search_exercises(
  search_text text default '',
  scope_filter text default 'all',
  discipline_filters text[] default null,
  category_filters text[] default null,
  mode_filters text[] default null,
  tracking_filters text[] default null,
  page_limit integer default 50,
  after_name text default null,
  after_id uuid default null
)
returns table (
  id uuid,
  scope text,
  owner_id uuid,
  name text,
  category text,
  cue text,
  default_entry_mode text,
  default_tracking_fields text[],
  discipline text,
  tags text[],
  source_provider text,
  source_external_id text,
  source_url text,
  video_url text,
  source_metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    exercise.source_metadata
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
$$;

revoke all on function public.search_exercises(
  text, text, text[], text[], text[], text[], integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.search_exercises(
  text, text, text[], text[], text[], text[], integer, text, uuid
) to authenticated;
