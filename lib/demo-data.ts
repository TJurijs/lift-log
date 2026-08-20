import type { AthleteSummary, CompletedSession, Exercise, Program, WorkspaceData } from "./domain";

export const globalExercises: Exercise[] = [
  { id: "back-squat", name: "Back squat", category: "Strength", cue: "Brace, sit between the hips, drive evenly.", scope: "global", defaultMode: "sets", defaultFields: ["reps", "load", "rpe"] },
  { id: "bench-press", name: "Bench press", category: "Strength", cue: "Set the upper back and keep the feet planted.", scope: "global", defaultMode: "sets", defaultFields: ["reps", "load", "rpe"] },
  { id: "romanian-deadlift", name: "Romanian deadlift", category: "Strength", cue: "Push the hips back and keep the bar close.", scope: "global", defaultMode: "sets", defaultFields: ["reps", "load", "rpe"] },
  { id: "push-up", name: "Push-up", category: "Bodyweight", cue: "Move as one line and finish with long arms.", scope: "global", defaultMode: "sets", defaultFields: ["reps", "rpe"] },
  { id: "pull-up", name: "Pull-up", category: "Bodyweight", cue: "Start long, pull the chest toward the bar.", scope: "global", defaultMode: "sets", defaultFields: ["reps", "rpe"] },
  { id: "zone-2-bike", name: "Zone 2 bike", category: "Cardio", cue: "Keep a sustainable conversational pace.", scope: "global", defaultMode: "result", defaultFields: ["duration", "distance", "rpe"] },
  { id: "easy-run", name: "Easy run", category: "Cardio", cue: "Relaxed pace; finish feeling like you could continue.", scope: "global", defaultMode: "result", defaultFields: ["duration", "distance", "rpe"] },
  { id: "rowing-intervals", name: "Rowing intervals", category: "Conditioning", cue: "Repeatable effort across every interval.", scope: "global", defaultMode: "intervals", defaultFields: ["rounds", "duration", "distance", "rpe"] },
  { id: "plank", name: "Plank", category: "Core", cue: "Ribs down, glutes tight, breathe behind the brace.", scope: "global", defaultMode: "result", defaultFields: ["duration", "rpe"] },
  { id: "mobility-flow", name: "Full-body mobility flow", category: "Mobility", cue: "Move slowly through a comfortable range.", scope: "global", defaultMode: "none", defaultFields: [] },
  { id: "snatch", name: "Snatch", category: "Weightlifting", cue: "Stay balanced through the pull and receive actively.", scope: "global", defaultMode: "sets", defaultFields: ["reps", "load", "rpe"] },
  { id: "clean-jerk", name: "Clean & jerk", category: "Weightlifting", cue: "Finish the pull, meet the bar, then drive vertically.", scope: "global", defaultMode: "sets", defaultFields: ["reps", "load", "rpe"] },
];

export const initialPersonalExercises: Exercise[] = [
  { id: "tempo-goblet-squat", name: "Tempo goblet squat", category: "Personal", cue: "3 seconds down, pause, stand smoothly.", scope: "personal", ownerName: "Alex Morgan", defaultMode: "sets", defaultFields: ["reps", "load", "rpe"] },
  { id: "hill-carry", name: "Hill carry", category: "Personal", cue: "Walk tall and keep the breathing controlled.", scope: "personal", ownerName: "Alex Morgan", defaultMode: "intervals", defaultFields: ["rounds", "duration", "rpe"] },
];

const preparation = {
  id: "prepare",
  title: "Preparation",
  items: [
    { id: "prep-1", title: "5 min easy bike", cue: "Raise temperature gradually.", mode: "none" as const, fields: [], prescription: {} },
    { id: "prep-2", title: "Hip and shoulder mobility flow", cue: "Move comfortably; nothing needs to be logged.", mode: "none" as const, fields: [], prescription: {} },
  ],
};

export const initialProgram: Program = {
  id: "foundation",
  athleteId: "demo-alex",
  versionId: "foundation-draft-v1",
  versionStatus: "draft",
  title: "Foundation",
  description: "A balanced three-day plan for strength, aerobic fitness, and movement quality.",
  mode: "fixed",
  phase: "Base",
  activeWeek: 3,
  ownerName: "Alex Morgan",
  createdByName: "Alex Morgan",
  weeks: Array.from({ length: 6 }, (_, index) => ({
    id: `demo-week-${index + 1}`,
    index: index + 1,
    label: index < 2 ? "Ease in" : index < 5 ? "Build" : "Consolidate",
    workouts: [
      {
        id: `w${index + 1}-full`, title: "Full body", dayLabel: "Monday", durationMinutes: 50,
        sections: [preparation, { id: "main-a", title: "Main work", items: [
          { id: "squat-a", exerciseId: "back-squat", title: "Back squat", cue: "Controlled descent · rest 2–3 min", mode: "sets", fields: ["reps", "load", "rpe"], prescription: { sets: 4, reps: "5", targetRpe: "7–8" } },
          { id: "press-a", exerciseId: "bench-press", title: "Bench press", cue: "Leave two clean reps in reserve.", mode: "sets", fields: ["reps", "load", "rpe"], prescription: { sets: 3, reps: "8", targetRpe: "7" } },
        ]}, { id: "finish-a", title: "Finish", items: [{ id: "walk-a", title: "5 min relaxed walk", cue: "Let breathing settle.", mode: "none", fields: [], prescription: {} }] }],
      },
      {
        id: `w${index + 1}-engine`, title: "Strength + engine", dayLabel: "Thursday", durationMinutes: 55,
        sections: [preparation, { id: "main-b", title: "Strength", items: [
          { id: "squat-b", exerciseId: "back-squat", title: "Back squat", cue: "Controlled descent · rest 2–3 min", mode: "sets", fields: ["reps", "load", "rpe"], prescription: { sets: 4, reps: "5", targetRpe: "7–8" } },
          { id: "push-b", exerciseId: "push-up", title: "Push-up", cue: "Stop before form changes.", mode: "sets", fields: ["reps", "rpe"], prescription: { sets: 3, reps: "10–15", targetRpe: "8" } },
        ]}, { id: "conditioning-b", title: "Conditioning", items: [
          { id: "bike-b", exerciseId: "zone-2-bike", title: "Zone 2 bike", cue: "Conversational pace.", mode: "result", fields: ["duration", "distance", "rpe"], prescription: { durationMinutes: 20, targetRpe: "5–6" } },
        ]}, { id: "finish-b", title: "Cooldown", items: [{ id: "cool-b", title: "Easy stretch and breathing", cue: "2–5 minutes, no tracking required.", mode: "none", fields: [], prescription: {} }] }],
      },
      {
        id: `w${index + 1}-cardio`, title: "Cardio + core", dayLabel: "Weekend", durationMinutes: 45,
        sections: [{ id: "run-c", title: "Aerobic work", items: [
          { id: "run-c1", exerciseId: "easy-run", title: "Easy run", cue: "Keep the whole effort conversational.", mode: "result", fields: ["duration", "distance", "rpe"], prescription: { durationMinutes: 30, targetRpe: "5" } },
        ]}, { id: "core-c", title: "Core", items: [
          { id: "plank-c", exerciseId: "plank", title: "Plank", cue: "Strong position and calm breathing.", mode: "result", fields: ["duration", "rpe"], prescription: { durationMinutes: 1, targetRpe: "7" } },
        ]}],
      },
    ],
  })),
};

export const completedSessions: CompletedSession[] = [
  { id: "s1", workoutTitle: "Full body", date: "2026-08-03", durationMinutes: 48, rpe: 7 },
  { id: "s2", workoutTitle: "Strength + engine", date: "2026-08-06", durationMinutes: 56, rpe: 7.5 },
  { id: "s3", workoutTitle: "Cardio + core", date: "2026-08-09", durationMinutes: 42, rpe: 6 },
  { id: "s4", workoutTitle: "Full body", date: "2026-08-11", durationMinutes: 51, rpe: 7.5 },
  { id: "s5", workoutTitle: "Strength + engine", date: "2026-08-14", durationMinutes: 58, rpe: 8, note: "Last squat set was challenging but clean." },
  { id: "s6", workoutTitle: "Full body", date: "2026-08-18", durationMinutes: 49, rpe: 7 },
];

export const athleteSummaries: AthleteSummary[] = [
  { id: "athlete-1", name: "Marta Ozola", initials: "MO", programTitle: "Weightlifting base", completedThisWeek: 3, plannedThisWeek: 3, latestRpe: 7.5, lastTrainingLabel: "Today", trend: "strong" },
  { id: "athlete-2", name: "Leo Grant", initials: "LG", programTitle: "Two-day strength", completedThisWeek: 1, plannedThisWeek: 2, latestRpe: 9, lastTrainingLabel: "2 days ago", trend: "watch" },
  { id: "athlete-3", name: "Sara Klein", initials: "SK", programTitle: "Return to running", completedThisWeek: 2, plannedThisWeek: 3, latestRpe: 6, lastTrainingLabel: "Yesterday", trend: "steady" },
];

export const demoWorkspace: WorkspaceData = {
  draftProgram: initialProgram,
  activeProgram: initialProgram,
  globalExercises,
  personalExercises: initialPersonalExercises,
  completedSessions,
  coachConnection: {
    relationshipId: "demo-relationship",
    coachId: "demo-coach",
    name: "Nina Kovacs",
    initials: "NK",
    connectedSince: "2026-07-12",
  },
  coachedAthletes: athleteSummaries,
  activeSession: null,
};
