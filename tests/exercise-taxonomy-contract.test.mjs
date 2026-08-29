import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const programViewPath = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
const categoryIconsPath = new URL(
  "../app/exercise-category-icons.tsx",
  import.meta.url,
);
async function readAppSource() {
  const [app, programView, categoryIcons] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(programViewPath, "utf8"),
    readFile(categoryIconsPath, "utf8"),
  ]);
  return `${app}\n${programView}\n${categoryIcons}`;
}
const repositoryPath = new URL("../lib/repository.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/202608230003_exercise_disciplines_and_tags.sql",
  import.meta.url,
);

test("exercise browsing uses three primary disciplines with compact rows and tags", async () => {
  const [app, repository, migration] = await Promise.all([
    readAppSource(),
    readFile(repositoryPath, "utf8"),
    readFile(migrationPath, "utf8"),
  ]);

  assert.match(migration, /discipline in \('weightlifting', 'gym', 'functional'\)/);
  assert.match(migration, /add column tags text\[\] not null default '\{\}'/);
  assert.match(migration, /idx_exercises_global_discipline/);
  assert.match(repository, /category, discipline, tags,[\s\S]*cue/);
  assert.match(app, /Weightlifting[\s\S]*Gym[\s\S]*Functional/);
  assert.match(app, /className="exercise-list panel"/);
  assert.match(app, /className="exercise-list-row"/);
  assert.match(app, /label="Exercise sources"[\s\S]*label: `Library \(\$\{global\.length\}/);
  assert.match(app, /label: `My exercises \(\$\{personal\.length\}/);
  assert.match(app, /hasMore \? "\+" : ""/);
  assert.match(app, /repository[\s\S]*\.searchExercises\(\{/);
  assert.equal(
    app.match(/disciplines: exerciseFilters\.disciplines/g)?.length,
    2,
    "initial search and Load more must use the same server-side disciplines",
  );
  assert.equal(app.match(/categories: exerciseFilters\.categories/g)?.length, 2);
  assert.equal(
    app.match(/modes: entryModesForFormats\(exerciseFilters\.formats\)/g)?.length,
    2,
  );
  assert.equal(
    app.match(/tracking: trackingFiltersForExerciseSearch\(exerciseFilters\)/g)
      ?.length,
    2,
  );
  assert.match(
    app,
    /const exerciseFilterCategories = \[[\s\S]*"Weightlifting"[\s\S]*\.\.\.exerciseCategories/,
  );
  assert.match(app, /const exerciseFormatOptions: LoggingFormat\[\] = \[/);
  assert.match(app, /const exerciseTrackingOptions: TrackingField\[\] = \[/);
  assert.doesNotMatch(
    app,
    /new Set\(source\.map\(\(exercise\) => exercise\.category\)\)/,
  );
  assert.doesNotMatch(app, /const filtered = useMemo\(\(\) =>/);
  assert.match(app, /Copy \$\{exercise\.name\} to My exercises/);
  assert.match(app, /function ExerciseDetailsModal/);
  assert.match(app, /Edit \$\{exercise\.name\}[\s\S]*?onClick=\{\(\) => onEdit\(exercise\)\}/);
  assert.match(app, /Training style[\s\S]*Category/);
  assert.match(app, /<span>Format<\/span>/);
  assert.match(app, /Track during workout/);
  assert.match(app, /function ExerciseCategoryIcon/);
  assert.match(app, /function ExercisePickerRow[\s\S]*?<ExerciseCategoryMark category=\{exercise\.category\}/);
  assert.match(app, /exercise-list-identity[\s\S]*?<ExerciseCategoryMark category=\{exercise\.category\}/);
  assert.match(app, /const WorkoutLogItem[\s\S]*?<ExerciseCategoryMark category=\{category \?\? item\.category\}/);
  assert.doesNotMatch(app, /function ExercisePickerRow[\s\S]*?<SourceTag source=\{sourceFromExercise\(exercise\)\} compact \/>/);
  assert.doesNotMatch(app, /Filter exercises by category/);
  assert.doesNotMatch(app, /className="exercise-grid"/);
});

test("exercise editing keeps training style and category as separate controlled fields", async () => {
  const app = await readAppSource();

  assert.match(app, /const exerciseCategories = \[/);
  assert.match(
    app,
    /function ExerciseModal[\s\S]*aria-label="Training style"[\s\S]*aria-label="Category"/,
  );
  assert.match(
    app,
    /onSave\([\s\S]*name\.trim\(\),[\s\S]*discipline,[\s\S]*category,[\s\S]*entryModeForLoggingFormat\(format\),[\s\S]*trackingFieldsForLoggingFormat\(format, trackingFields\),[\s\S]*cue\.trim\(\),/,
  );
  assert.match(app, /discipline: ExerciseDiscipline/);
  assert.doesNotMatch(app, /placeholder="e\.g\. Weightlifting"/);
});

test("saving a personal exercise returns to the exercise list", async () => {
  const app = await readAppSource();

  assert.match(
    app,
    /async function addPersonalExercise[\s\S]*setExerciseDetailTarget\(null\);[\s\S]*setModal\(null\);[\s\S]*saved to your library/,
  );
  assert.match(
    app,
    /async function updatePersonalExercise[\s\S]*setExerciseDetailTarget\(null\);[\s\S]*setModal\(null\);[\s\S]*updated/,
  );
});
