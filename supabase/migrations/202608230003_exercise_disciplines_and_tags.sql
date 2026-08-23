-- The library uses one canonical movement record. Discipline is the primary
-- browsing family; tags allow movement-specific filtering without duplicates.

alter table public.exercises
  add column discipline text check (discipline in ('weightlifting', 'gym', 'functional')),
  add column tags text[] not null default '{}';

create index idx_exercises_global_discipline
  on public.exercises (discipline, category, name)
  where scope = 'global' and archived_at is null;

update public.exercises
set
  discipline = case
    when category = 'Weightlifting' then 'weightlifting'
    when category in ('Functional fitness', 'Gymnastics', 'Conditioning', 'Cardio') then 'functional'
    else 'gym'
  end,
  tags = case
    when category = 'Weightlifting' and name = 'Clean & jerk' then array['Clean', 'Jerk']::text[]
    when category = 'Weightlifting' and name ilike '%snatch%' then array['Snatch']::text[]
    when category = 'Weightlifting' and name ilike '%clean%' then array['Clean']::text[]
    when category = 'Weightlifting' and name ilike '%jerk%' then array['Jerk']::text[]
    when category = 'Weightlifting' then array['Strength support']::text[]
    when category = 'Bodybuilding' then array['Hypertrophy']::text[]
    when category = 'Strength' then array['Strength']::text[]
    when category = 'Gymnastics' then array['Gymnastics']::text[]
    when category in ('Conditioning', 'Cardio') then array['Conditioning']::text[]
    when category = 'Functional fitness' then array['Mixed modal']::text[]
    when category = 'Core' then array['Core']::text[]
    when category = 'Mobility' then array['Mobility']::text[]
    else array[category]::text[]
  end
where scope = 'global' and archived_at is null;
