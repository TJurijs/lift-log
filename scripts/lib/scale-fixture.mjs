import { createHash } from "node:crypto";

export const SCALE_FIXTURE_SCHEMA_VERSION = 3;
export const SCALE_FIXTURE_NAMESPACE = "liftlog-scale-v1";

export const SCALE_SCENARIOS = Object.freeze({
  "program-40": Object.freeze({
    kind: "program-tree",
    description: "Forty-workout ordered sequence with realistic nested content",
    weeks: 1,
    workoutsPerWeek: 40,
    sectionsPerWorkout: 1,
    itemsPerWorkout: 8,
    prescriptionsPerItem: 3,
  }),
  "program-208-stress": Object.freeze({
    kind: "program-tree",
    description: "Two-hundred-eight-workout sequence used for clone and detail stress",
    weeks: 1,
    workoutsPerWeek: 208,
    sectionsPerWorkout: 1,
    itemsPerWorkout: 8,
    prescriptionsPerItem: 3,
  }),
  "coach-50x150": Object.freeze({
    kind: "roster-history",
    description: "One coach, fifty athletes, and 150 completed trainings per athlete",
    athletes: 50,
    trainingsPerAthlete: 150,
    itemsPerTraining: 8,
    entriesPerItem: 3,
    anchorDate: "2026-01-05",
  }),
  "exercise-5000": Object.freeze({
    kind: "exercise-library",
    description: "Five thousand deterministic exercises for paging and DOM-windowing checks",
    exercises: 5000,
  }),
});

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function deterministicUuid(key) {
  const bytes = createHash("sha256")
    .update(`${SCALE_FIXTURE_NAMESPACE}:${key}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function datePlus(anchorDate, days) {
  const date = new Date(`${anchorDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function countProgramTree(scenario) {
  const workouts = scenario.weeks * scenario.workoutsPerWeek;
  const sections = workouts * scenario.sectionsPerWorkout;
  const items = workouts * scenario.itemsPerWorkout;
  const prescriptions = items * scenario.prescriptionsPerItem;
  return {
    program: 1,
    program_version: 1,
    program_phase: 1,
    program_week: scenario.weeks,
    workout: workouts,
    workout_section: sections,
    workout_item: items,
    prescribed_entry: prescriptions,
  };
}

function countRosterHistory(scenario) {
  const trainings = scenario.athletes * scenario.trainingsPerAthlete;
  const itemLogs = trainings * scenario.itemsPerTraining;
  return {
    synthetic_account: scenario.athletes + 1,
    coach_relationship: scenario.athletes,
    scheduled_workout: trainings,
    workout_session: trainings,
    session_item_log: itemLogs,
    session_entry: itemLogs * scenario.entriesPerItem,
  };
}

export function scenarioRowCounts(name) {
  const scenario = SCALE_SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scale scenario: ${name}`);
  if (scenario.kind === "program-tree") return countProgramTree(scenario);
  if (scenario.kind === "roster-history") return countRosterHistory(scenario);
  return { exercise: scenario.exercises };
}

function totalRows(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export function createScaleFixtureManifest(names = Object.keys(SCALE_SCENARIOS)) {
  const scenarios = names.map((name) => {
    const definition = SCALE_SCENARIOS[name];
    if (!definition) throw new Error(`Unknown scale scenario: ${name}`);
    const rowCounts = scenarioRowCounts(name);
    return {
      name,
      ...definition,
      rowCounts,
      totalRows: totalRows(rowCounts),
    };
  });
  const manifestWithoutDigest = {
    schemaVersion: SCALE_FIXTURE_SCHEMA_VERSION,
    namespace: SCALE_FIXTURE_NAMESPACE,
    scenarios,
    totalRows: scenarios.reduce((sum, scenario) => sum + scenario.totalRows, 0),
  };
  return {
    ...manifestWithoutDigest,
    digest: createHash("sha256").update(stableJson(manifestWithoutDigest)).digest("hex"),
  };
}

function* generateProgramTree(name, scenario) {
  const programId = deterministicUuid(`${name}:program`);
  const versionId = deterministicUuid(`${name}:version`);
  const phaseId = deterministicUuid(`${name}:phase`);
  yield { type: "program", id: programId, scenario: name };
  yield { type: "program_version", id: versionId, programId, versionNumber: 1 };
  yield { type: "program_phase", id: phaseId, versionId, position: 0 };

  for (let week = 1; week <= scenario.weeks; week += 1) {
    const weekId = deterministicUuid(`${name}:week:${week}`);
    yield { type: "program_week", id: weekId, versionId, phaseId, weekIndex: week };
    for (let workout = 0; workout < scenario.workoutsPerWeek; workout += 1) {
      const workoutId = deterministicUuid(`${name}:week:${week}:workout:${workout}`);
      yield { type: "workout", id: workoutId, weekId, position: workout };
      for (let section = 0; section < scenario.sectionsPerWorkout; section += 1) {
        const sectionId = deterministicUuid(
          `${name}:week:${week}:workout:${workout}:section:${section}`,
        );
        yield { type: "workout_section", id: sectionId, workoutId, position: section };
      }
      for (let item = 0; item < scenario.itemsPerWorkout; item += 1) {
        const section = item % scenario.sectionsPerWorkout;
        const sectionId = deterministicUuid(
          `${name}:week:${week}:workout:${workout}:section:${section}`,
        );
        const itemId = deterministicUuid(
          `${name}:week:${week}:workout:${workout}:item:${item}`,
        );
        yield { type: "workout_item", id: itemId, sectionId, position: item };
        for (let entry = 0; entry < scenario.prescriptionsPerItem; entry += 1) {
          yield {
            type: "prescribed_entry",
            id: deterministicUuid(`${name}:item:${itemId}:entry:${entry}`),
            itemId,
            position: entry,
          };
        }
      }
    }
  }
}

function* generateRosterHistory(name, scenario) {
  const coachId = deterministicUuid(`${name}:coach`);
  yield { type: "synthetic_account", id: coachId, role: "coach", key: "scale-coach" };
  for (let athlete = 1; athlete <= scenario.athletes; athlete += 1) {
    const athleteKey = `scale-athlete-${String(athlete).padStart(3, "0")}`;
    const athleteId = deterministicUuid(`${name}:athlete:${athlete}`);
    yield { type: "synthetic_account", id: athleteId, role: "athlete", key: athleteKey };
    yield {
      type: "coach_relationship",
      id: deterministicUuid(`${name}:relationship:${athlete}`),
      coachId,
      athleteId,
    };
    for (let training = 1; training <= scenario.trainingsPerAthlete; training += 1) {
      const scheduleId = deterministicUuid(`${name}:athlete:${athlete}:schedule:${training}`);
      const sessionId = deterministicUuid(`${name}:athlete:${athlete}:session:${training}`);
      const completedForDate = datePlus(scenario.anchorDate, training - 1);
      yield {
        type: "scheduled_workout",
        id: scheduleId,
        athleteId,
        sequenceNumber: training,
        plannedDate: completedForDate,
        status: "completed",
      };
      yield {
        type: "workout_session",
        id: sessionId,
        athleteId,
        scheduleId,
        completedForDate,
        status: "completed",
      };
      for (let item = 0; item < scenario.itemsPerTraining; item += 1) {
        const itemLogId = deterministicUuid(
          `${name}:athlete:${athlete}:session:${training}:item:${item}`,
        );
        yield { type: "session_item_log", id: itemLogId, sessionId, position: item };
        for (let entry = 0; entry < scenario.entriesPerItem; entry += 1) {
          yield {
            type: "session_entry",
            id: deterministicUuid(`${name}:item-log:${itemLogId}:entry:${entry}`),
            itemLogId,
            position: entry,
          };
        }
      }
    }
  }
}

function* generateExerciseLibrary(name, scenario) {
  for (let exercise = 1; exercise <= scenario.exercises; exercise += 1) {
    yield {
      type: "exercise",
      id: deterministicUuid(`${name}:exercise:${exercise}`),
      key: `scale-exercise-${String(exercise).padStart(5, "0")}`,
      scope: exercise % 5 === 0 ? "personal" : "global",
    };
  }
}

export function* generateScenarioRecords(name) {
  const scenario = SCALE_SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scale scenario: ${name}`);
  if (scenario.kind === "program-tree") yield* generateProgramTree(name, scenario);
  else if (scenario.kind === "roster-history") yield* generateRosterHistory(name, scenario);
  else yield* generateExerciseLibrary(name, scenario);
}
