import { writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://www.catalystathletics.com";
const sections = [
  { id: 8, slug: "Snatch-Exercises", name: "Snatch Exercises" },
  { id: 9, slug: "Clean-Exercises", name: "Clean Exercises" },
  { id: 10, slug: "Jerk-Exercises", name: "Jerk Exercises" },
  { id: 11, slug: "General-Exercises", name: "General Exercises" },
  { id: 12, slug: "Trunk-Ab-Back", name: "Trunk (Ab & Back)" },
  { id: 16, slug: "Jumping-Plyometrics", name: "Jumping & Plyometrics" },
  { id: 13, slug: "Accessory-LowerWhole-Body", name: "Accessory - Lower/Whole Body" },
  { id: 17, slug: "Accessory-Upper-Body", name: "Accessory - Upper Body" },
  { id: 18, slug: "Accessory-Prep-Prehab", name: "Accessory - Prep & Prehab" },
  { id: 19, slug: "Carries", name: "Carries" },
];

const expectedExerciseCount = 624;
const outputPath = path.resolve(
  process.argv[2] ??
    "supabase/migrations/202608300006_catalyst_exercise_catalog.sql",
);

function decodeHtml(value) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html",
      "User-Agent": "LiftLog exercise catalogue importer (+https://liftlog.cc)",
    },
  });
  if (response.ok) return response.text();
  if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    return fetchText(url, attempt + 1);
  }
  throw new Error(`Could not fetch ${url}: ${response.status}`);
}

function sectionExerciseLinks(html, section) {
  const result = [];
  const pattern = /href="(\/exercise\/(\d+)\/([^"/]+)\/)"/g;
  for (const match of html.matchAll(pattern)) {
    result.push({
      externalId: match[2],
      path: match[1],
      slug: match[3],
      section,
    });
  }
  return [...new Map(result.map((item) => [item.externalId, item])).values()];
}

function exerciseName(html, fallbackSlug) {
  const openGraph = html.match(
    /<meta\s+property="og:title"\s+content="([^"]+)"/i,
  )?.[1];
  if (openGraph) {
    return decodeHtml(openGraph)
      .replace(/\s+Exercise Demo Video\s*&\s*Info.*$/i, "")
      .trim();
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) {
    return decodeHtml(title)
      .replace(/\s+-\s+Olympic Weightlifting Exercise Library.*$/i, "")
      .trim();
  }
  return decodeURIComponent(fallbackSlug).replaceAll("-", " ");
}

function youtubeVideoUrl(html) {
  const embedId = html.match(
    /(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/i,
  )?.[1];
  return embedId ? `https://www.youtube.com/watch?v=${embedId}` : null;
}

const mobilityPattern =
  /stretch|mobility|mobilization|foam roll|rolling|release|massage|activation|warm-?up|prep|rehab|prehab|dislocate|pass-?through|rotation|rotator|scapular|ankle|hip flow|wrist|breathing/i;
const gymnasticsPattern =
  /muscle-?up|handstand|ring support|ring row|ring dip|skin the cat|lever|planche|l-?sit|toes?[- ]to[- ]bar/i;
const bodyweightPattern =
  /push-?up|pull-?up|chin-?up|dip$|bodyweight|air squat|pistol|inverted row|plank|side plank|bird dog|dead bug|bear crawl/i;
const functionalPattern =
  /sled|rope|tire|sandbag|turkish get-?up|step-?up|crawl|burpee|thruster|wall ball|kettlebell|medicine ball|med ball|sprint|shuttle/i;
const bodybuildingPattern =
  /curl|fly|raise|extension|pressdown|pulldown|pullover|kickback|shrug|calf|leg press|leg curl|chest press|pec deck|machine|cable|dumbbell|triceps|biceps|rear delt|lateral/i;

function classifyExercise(name, sectionId) {
  if ([8, 9, 10].includes(sectionId)) return "Weightlifting";
  if (
    sectionId === 11 &&
    /(^|[^a-z])(snatch|clean|jerk|push press|first pull|good morning pull)([^a-z]|$)/i.test(
      name,
    )
  )
    return "Weightlifting";
  if (sectionId === 12) return "Core";
  if (sectionId === 16) return "Functional fitness";
  if (sectionId === 18) return "Mobility";
  if (sectionId === 19) return "Functional fitness";
  if (mobilityPattern.test(name)) return "Mobility";
  if (gymnasticsPattern.test(name)) return "Gymnastics";
  if (bodyweightPattern.test(name)) return "Bodyweight";
  if (functionalPattern.test(name)) return "Functional fitness";
  if (bodybuildingPattern.test(name)) return "Bodybuilding";
  if (sectionId === 17) return "Bodybuilding";
  return "Strength";
}

function disciplineForCategory(category) {
  if (category === "Weightlifting") return "weightlifting";
  if (
    ["Functional fitness", "Gymnastics", "Conditioning", "Cardio"].includes(
      category,
    )
  )
    return "functional";
  return "gym";
}

const timedMovementPattern =
  /stretch|mobility|mobilization|foam roll|rolling|release|massage|breathing|plank|\bhold\b|wall sit|isometric/i;
const distanceMovementPattern = /sprint|shuttle|run\b/i;
const unloadedBodyweightPattern =
  /^(?:strict )?(?:push-?up|pull-?up|chin-?up|dip|air squat|pistol|inverted row)\b|bodyweight/i;

function defaultsForExercise(name, sectionId) {
  if (sectionId === 19) {
    return { mode: "result", fields: ["distance", "load", "rpe"] };
  }
  if (/sled/i.test(name)) {
    return { mode: "result", fields: ["distance", "load", "rpe"] };
  }
  if (distanceMovementPattern.test(name)) {
    return { mode: "result", fields: ["distance", "duration", "rpe"] };
  }
  if (timedMovementPattern.test(name)) {
    return {
      mode: "result",
      fields:
        sectionId === 18
          ? ["duration"]
          : [8, 9, 10, 11, 13, 17].includes(sectionId)
            ? ["duration", "load", "rpe"]
            : ["duration", "rpe"],
    };
  }
  if ([12, 16, 18].includes(sectionId) || unloadedBodyweightPattern.test(name)) {
    return { mode: "sets", fields: ["reps", "rpe"] };
  }
  return { mode: "sets", fields: ["reps", "load", "rpe"] };
}

function tagsForExercise(section, category) {
  const tags = [section.name];
  if (section.id === 8) tags.push("Snatch");
  if (section.id === 9) tags.push("Clean");
  if (section.id === 10) tags.push("Jerk");
  if (category !== section.name) tags.push(category);
  return [...new Set(tags)];
}

function sqlString(value) {
  return value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
}

function sqlArray(values) {
  return `array[${values.map(sqlString).join(", ")}]::text[]`;
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

const sectionPages = await mapConcurrent(sections, 4, async (section) => ({
  section,
  html: await fetchText(
    `${baseUrl}/exercises/section/${section.id}/${section.slug}/`,
  ),
}));
const links = sectionPages.flatMap(({ section, html }) =>
  sectionExerciseLinks(html, section),
);
const uniqueLinks = [
  ...new Map(links.map((item) => [item.externalId, item])).values(),
];
if (uniqueLinks.length !== expectedExerciseCount) {
  throw new Error(
    `Expected ${expectedExerciseCount} Catalyst exercises, found ${uniqueLinks.length}`,
  );
}

const exercises = await mapConcurrent(uniqueLinks, 8, async (item, index) => {
  const sourceUrl = `${baseUrl}${item.path}`;
  const html = await fetchText(sourceUrl);
  const name = exerciseName(html, item.slug);
  const category = classifyExercise(name, item.section.id);
  const defaults = defaultsForExercise(name, item.section.id);
  if ((index + 1) % 50 === 0 || index + 1 === uniqueLinks.length) {
    process.stdout.write(`Mapped ${index + 1}/${uniqueLinks.length}\n`);
  }
  return {
    ...item,
    name,
    category,
    discipline: disciplineForCategory(category),
    tags: tagsForExercise(item.section, category),
    mode: defaults.mode,
    fields: defaults.fields,
    sourceUrl,
    videoUrl: youtubeVideoUrl(html),
  };
});

const duplicateNames = Object.entries(
  Object.groupBy(exercises, (item) => item.name.trim().toLowerCase()),
).filter(([, items]) => items.length > 1);

const missingVideos = exercises.filter((exercise) => !exercise.videoUrl);
const values = exercises
  .sort((left, right) => left.name.localeCompare(right.name))
  .map(
    (exercise) =>
      `  (${[
        sqlString(exercise.externalId),
        sqlString(exercise.name),
        sqlString(exercise.category),
        sqlString(exercise.discipline),
        sqlArray(exercise.tags),
        sqlString(exercise.mode),
        sqlArray(exercise.fields),
        sqlString(exercise.sourceUrl),
        sqlString(exercise.videoUrl),
        sqlString(String(exercise.section.id)),
        sqlString(exercise.section.name),
      ].join(", ")})`,
  )
  .join(",\n");

const sql = `-- Generated by scripts/generate-catalyst-exercise-migration.mjs.
-- Catalogue snapshot: ${new Date().toISOString().slice(0, 10)}.
-- Exercise names and public demo links are attributed to Catalyst Athletics;
-- Lift Log does not copy Catalyst's written exercise descriptions.

create temporary table catalyst_exercise_import (
  external_id text primary key,
  name text not null,
  category text not null,
  discipline text not null,
  tags text[] not null,
  default_entry_mode text not null,
  default_tracking_fields text[] not null,
  source_url text not null,
  video_url text,
  source_section_id text not null,
  source_section_name text not null
) on commit drop;

insert into catalyst_exercise_import (
  external_id, name, category, discipline, tags, default_entry_mode,
  default_tracking_fields, source_url, video_url, source_section_id,
  source_section_name
) values
${values};

update public.exercises exercise
set
  category = source.category,
  discipline = source.discipline,
  tags = source.tags,
  source_provider = 'catalyst-athletics',
  source_external_id = source.external_id,
  source_url = source.source_url,
  video_url = source.video_url,
  source_metadata = jsonb_build_object(
    'sectionId', source.source_section_id,
    'sectionName', source.source_section_name
  ),
  updated_at = now()
from catalyst_exercise_import source
where exercise.scope = 'global'
  and exercise.owner_id is null
  and lower(trim(exercise.name)) = lower(trim(source.name))
  and source.external_id = (
    select min(candidate.external_id)
    from catalyst_exercise_import candidate
    where lower(trim(candidate.name)) = lower(trim(source.name))
  )
  and (
    exercise.source_provider is null
    or exercise.source_provider = 'catalyst-athletics'
  );

insert into public.exercises (
  scope, owner_id, name, category, discipline, tags, cue,
  default_entry_mode, default_tracking_fields, source_provider,
  source_external_id, source_url, video_url, source_metadata
)
select
  'global', null, source.name, source.category, source.discipline, source.tags,
  '', source.default_entry_mode, source.default_tracking_fields,
  'catalyst-athletics', source.external_id, source.source_url, source.video_url,
  jsonb_build_object(
    'sectionId', source.source_section_id,
    'sectionName', source.source_section_name
  )
from catalyst_exercise_import source
where not exists (
  select 1
  from public.exercises exercise
  where exercise.scope = 'global'
    and exercise.owner_id is null
    and exercise.source_provider = 'catalyst-athletics'
    and exercise.source_external_id = source.external_id
);

alter table public.workout_items disable trigger guard_workout_items_draft;

update public.workout_items item
set source_exercise_id = exercise.id
from (
  select distinct on (lower(trim(source.name))) source.id, source.name
  from public.exercises source
  where source.scope = 'global'
    and source.owner_id is null
    and source.archived_at is null
  order by lower(trim(source.name)), source.created_at, source.id
) exercise
where item.source_exercise_id is null
  and lower(trim(item.snapshot_name)) = lower(trim(exercise.name));

alter table public.workout_items enable trigger guard_workout_items_draft;
`;

await writeFile(outputPath, sql, "utf8");
process.stdout.write(
  `Wrote ${exercises.length} exercises to ${outputPath}\n` +
    `${exercises.length - missingVideos.length} include YouTube videos; ` +
    `${missingVideos.length} have no YouTube embed.\n`,
);
if (missingVideos.length) {
  process.stdout.write(
    `Missing videos: ${missingVideos.map((item) => `${item.name} (${item.sourceUrl})`).join(", ")}\n`,
  );
}
if (duplicateNames.length) {
  process.stdout.write(
    `Preserved duplicate source names: ${duplicateNames
      .map(([name, items]) => `${name} (${items.map((item) => item.externalId).join(", ")})`)
      .join("; ")}\n`,
  );
}
