import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Copy,
  Dumbbell,
  Ellipsis,
  FlaskConical,
  LayoutDashboard,
  Link2,
  ListPlus,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Timer,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ActiveSession,
  AthleteSummary,
  CoachConnection,
  CompletedSession,
  EntryMode,
  Exercise,
  PlannedWorkout,
  Program,
  SessionSetValue,
  TrackingField,
  ViewName,
  WorkoutItem,
  WorkspaceData,
} from "../lib/domain";
import type { AppViewer } from "../lib/auth";
import type { LiftLogRepository } from "../lib/repository";

const navItems: Array<{ id: ViewName; label: string; icon: typeof Activity }> = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "program", label: "Program", icon: Dumbbell },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "exercises", label: "Exercises", icon: BookOpen },
  { id: "coaching", label: "Coaching", icon: Users },
];

type ModalName = "exercise" | "workout" | "invite" | null;
type SetLog = SessionSetValue;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function prescriptionLabel(item: WorkoutItem) {
  const target = item.prescription;
  if (item.mode === "sets") return `${target.sets ?? 1} × ${target.reps ?? "open"}`;
  if (item.mode === "intervals") return `${target.rounds ?? 1} rounds`;
  if (target.distance) return `${target.distance} ${target.distanceUnit ?? "m"}`;
  if (target.durationMinutes) return `${target.durationMinutes} min`;
  return "Open";
}

function modeLabel(mode: EntryMode) {
  return { none: "Instructions", sets: "Sets", result: "Single result", intervals: "Intervals" }[mode];
}

function starterSetLogs(workout: PlannedWorkout, activeSession: ActiveSession | null) {
  if (activeSession?.workoutId === workout.id) return activeSession.setLogs;
  const logs: Record<string, SetLog[]> = {};
  workout.sections.flatMap((section) => section.items).forEach((item) => {
    if (item.mode === "sets") {
      logs[item.id] = Array.from({ length: item.prescription.sets ?? 1 }, () => ({
        reps: item.prescription.reps?.split("–")[0] ?? "",
        load: "",
        rpe: "",
      }));
    }
  });
  return logs;
}

function workoutForToday(program: Program, activeSession: ActiveSession | null) {
  const allWorkouts = program.weeks.flatMap((week) => week.workouts);
  const resumed = activeSession ? allWorkouts.find((workout) => workout.id === activeSession.workoutId) : undefined;
  if (resumed) return resumed;
  const activeWeek = program.weeks[program.activeWeek - 1] ?? program.weeks[0];
  const today = new Date();
  const todayLabel = today.toLocaleDateString("en", { weekday: "long" });
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return activeWeek?.workouts.find((workout) => workout.plannedDate === todayDate)
    ?? activeWeek?.workouts.find((workout) => workout.dayLabel === todayLabel)
    ?? activeWeek?.workouts[0]
    ?? allWorkouts[0];
}

export default function LiftLogApp({ viewer, onSignOut, onOpenTestPersonas, initialWorkspace, repository }: {
  viewer: AppViewer;
  onSignOut: () => void;
  onOpenTestPersonas?: () => void;
  initialWorkspace: WorkspaceData;
  repository: LiftLogRepository | null;
}) {
  const [activeView, setActiveView] = useState<ViewName>("today");
  const [workspace, setWorkspace] = useState<WorkspaceData>(initialWorkspace);
  const [program, setProgram] = useState<Program>(initialWorkspace.draftProgram);
  const initialWeek = initialWorkspace.draftProgram.weeks[initialWorkspace.draftProgram.activeWeek - 1] ?? initialWorkspace.draftProgram.weeks[0];
  const [selectedWeek, setSelectedWeek] = useState(initialWeek?.index ?? 1);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(initialWeek?.workouts[0]?.id ?? "");
  const [personalExercises, setPersonalExercises] = useState<Exercise[]>(initialWorkspace.personalExercises);
  const [exerciseScope, setExerciseScope] = useState<"global" | "personal">("global");
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [modal, setModal] = useState<ModalName>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(initialWorkspace.activeSession);
  const [workoutStarted, setWorkoutStarted] = useState(Boolean(initialWorkspace.activeSession));
  const [workoutComplete, setWorkoutComplete] = useState(false);
  const [sessionRpe, setSessionRpe] = useState(initialWorkspace.activeSession?.sessionRpe ?? "7");
  const [sessionNote, setSessionNote] = useState(initialWorkspace.activeSession?.sessionNote ?? "");
  const [toast, setToast] = useState("");
  const [coachMode, setCoachMode] = useState<"athlete" | "coach">("athlete");
  const [selectedAthlete, setSelectedAthlete] = useState<AthleteSummary | null>(initialWorkspace.coachedAthletes[0] ?? null);

  const currentWeek = program.weeks[selectedWeek - 1] ?? program.weeks[0];
  const todayProgram = workspace.activeProgram;
  const todayWorkout = workoutForToday(todayProgram, activeSession);
  const selectedWorkout = currentWeek?.workouts.find((workout) => workout.id === selectedWorkoutId) ?? currentWeek?.workouts[0];

  const [setLogs, setSetLogs] = useState<Record<string, SetLog[]>>(() => todayWorkout ? starterSetLogs(todayWorkout, activeSession) : {});
  const [resultLogs, setResultLogs] = useState<Record<string, Record<string, string>>>(initialWorkspace.activeSession?.resultLogs ?? {});

  useEffect(() => {
    if (!repository || !activeSession || !workoutStarted) return;
    const saveTimer = window.setTimeout(() => {
      void repository.saveSessionDraft(activeSession, setLogs, resultLogs).catch(() => {
        notify("Autosave paused — check your connection");
      });
    }, 650);
    return () => window.clearTimeout(saveTimer);
  }, [activeSession, repository, resultLogs, setLogs, workoutStarted]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function selectProgram(nextProgram: Program) {
    const nextWeek = nextProgram.weeks[nextProgram.activeWeek - 1] ?? nextProgram.weeks[0];
    setProgram(nextProgram);
    setSelectedWeek(nextWeek?.index ?? 1);
    setSelectedWorkoutId(nextWeek?.workouts[0]?.id ?? "");
  }

  function applyWorkspace(nextWorkspace: WorkspaceData) {
    const nextWorkout = workoutForToday(nextWorkspace.activeProgram, nextWorkspace.activeSession);
    setWorkspace(nextWorkspace);
    setPersonalExercises(nextWorkspace.personalExercises);
    setActiveSession(nextWorkspace.activeSession);
    setSetLogs(nextWorkout ? starterSetLogs(nextWorkout, nextWorkspace.activeSession) : {});
    setResultLogs(nextWorkspace.activeSession?.resultLogs ?? {});
    setSessionRpe(nextWorkspace.activeSession?.sessionRpe ?? "7");
    setSessionNote(nextWorkspace.activeSession?.sessionNote ?? "");
    setWorkoutStarted(Boolean(nextWorkspace.activeSession));
    setSelectedAthlete((previous) => nextWorkspace.coachedAthletes.find((athlete) => athlete.id === previous?.id) ?? nextWorkspace.coachedAthletes[0] ?? null);
    if (program.athleteId === viewer.id) selectProgram(nextWorkspace.draftProgram);
  }

  async function reloadCurrentProgram() {
    if (!repository) return;
    if (program.athleteId === viewer.id) {
      applyWorkspace(await repository.loadWorkspace());
      return;
    }
    selectProgram(await repository.loadProgramForAthlete(program.athleteId));
  }

  function navigate(view: ViewName) {
    if (view === "program" && program.athleteId !== viewer.id) selectProgram(workspace.draftProgram);
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateSet(itemId: string, index: number, field: keyof SetLog, value: string) {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: previous[itemId].map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row),
    }));
  }

  function addSet(itemId: string) {
    setSetLogs((previous) => ({ ...previous, [itemId]: [...(previous[itemId] ?? []), { reps: "", load: "", rpe: "" }] }));
  }

  function removeSet(itemId: string, index: number) {
    setSetLogs((previous) => ({ ...previous, [itemId]: previous[itemId].filter((_, rowIndex) => rowIndex !== index) }));
  }

  function updateResult(itemId: string, field: string, value: string) {
    setResultLogs((previous) => ({ ...previous, [itemId]: { ...(previous[itemId] ?? {}), [field]: value } }));
  }

  async function startWorkout() {
    if (!todayWorkout) return;
    if (!repository) {
      setWorkoutStarted(true);
      return;
    }
    try {
      const session = await repository.startOrResumeSession(todayWorkout, todayProgram.versionId);
      if (!session) throw new Error("The workout session was not created.");
      setActiveSession(session);
      setSetLogs(starterSetLogs(todayWorkout, session));
      setResultLogs(session.resultLogs);
      setSessionRpe(session.sessionRpe);
      setSessionNote(session.sessionNote);
      setWorkoutStarted(true);
      notify("Workout started · changes save automatically");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The workout could not be started");
    }
  }

  async function finishWorkout() {
    if (repository && activeSession) {
      try {
        await repository.saveSessionDraft(activeSession, setLogs, resultLogs);
        await repository.completeSession(activeSession.id, sessionRpe, sessionNote);
        const nextWorkspace = await repository.loadWorkspace();
        applyWorkspace(nextWorkspace);
      } catch (error) {
        notify(error instanceof Error ? error.message : "The session could not be completed");
        return;
      }
    }
    setActiveSession(null);
    setWorkoutComplete(true);
    setWorkoutStarted(false);
    notify("Session saved to your training history");
  }

  async function addWorkout(title: string, dayLabel: string) {
    if (!currentWeek) return;
    let workout: PlannedWorkout;
    if (repository) {
      try {
        workout = await repository.addWorkout(program, currentWeek.id, title, dayLabel);
      } catch (error) {
        notify(error instanceof Error ? error.message : "The workout could not be added");
        return;
      }
    } else {
      workout = {
        id: `workout-${Date.now()}`,
        title,
        dayLabel,
        durationMinutes: 45,
        sections: [{ id: `section-${Date.now()}`, title: "Main work", items: [] }],
      };
    }
    setProgram((previous) => ({
      ...previous,
      weeks: previous.weeks.map((week) => week.index === selectedWeek ? { ...week, workouts: [...week.workouts, workout] } : week),
    }));
    setSelectedWorkoutId(workout.id);
    setModal(null);
    notify("Workout added to this week");
  }

  async function addExerciseToWorkout(exercise: Exercise) {
    if (!selectedWorkout) return;
    const targetSection = selectedWorkout.sections.at(-1);
    if (!targetSection) return;
    let item: WorkoutItem;
    if (repository) {
      try {
        item = await repository.addWorkoutItem(targetSection, exercise);
      } catch (error) {
        notify(error instanceof Error ? error.message : "The exercise could not be added");
        return;
      }
    } else {
      item = {
        id: `item-${Date.now()}`,
        exerciseId: exercise.id,
        title: exercise.name,
        cue: exercise.cue,
        mode: exercise.defaultMode,
        fields: exercise.defaultFields,
        prescription: exercise.defaultMode === "sets" ? { sets: 3, reps: "8", targetRpe: "7–8" } : exercise.defaultMode === "intervals" ? { rounds: 5, workSeconds: 60, restSeconds: 60 } : exercise.defaultMode === "result" ? { durationMinutes: 20 } : {},
      };
    }
    setProgram((previous) => ({
      ...previous,
      weeks: previous.weeks.map((week) => week.index !== selectedWeek ? week : {
        ...week,
        workouts: week.workouts.map((workout) => workout.id !== selectedWorkout.id ? workout : {
          ...workout,
          sections: workout.sections.length
            ? workout.sections.map((section, index) => index === workout.sections.length - 1 ? { ...section, items: [...section.items, item] } : section)
            : [{ id: `section-${Date.now()}`, title: "Main work", items: [item] }],
        }),
      }),
    }));
    notify(`${exercise.name} added to ${selectedWorkout.title}`);
  }

  async function removeWorkoutItem(itemId: string) {
    if (!selectedWorkout) return;
    if (repository) {
      try {
        await repository.removeWorkoutItem(itemId);
      } catch (error) {
        notify(error instanceof Error ? error.message : "The item could not be removed");
        return;
      }
    }
    setProgram((previous) => ({
      ...previous,
      weeks: previous.weeks.map((week) => week.index !== selectedWeek ? week : {
        ...week,
        workouts: week.workouts.map((workout) => workout.id !== selectedWorkout.id ? workout : {
          ...workout,
          sections: workout.sections.map((section) => ({ ...section, items: section.items.filter((item) => item.id !== itemId) })),
        }),
      }),
    }));
  }

  async function duplicateWeek() {
    if (!currentWeek) return;
    const source = program.weeks[selectedWeek - 2] ?? currentWeek;
    if (repository) {
      try {
        await repository.duplicateWeek(source.id, currentWeek.id);
        await reloadCurrentProgram();
        notify(`Week ${source.index} copied into week ${selectedWeek}`);
      } catch (error) {
        notify(error instanceof Error ? error.message : "The week could not be copied");
      }
      return;
    }
    setProgram((previous) => ({
      ...previous,
      weeks: previous.weeks.map((week) => week.index === selectedWeek ? {
        ...week,
        workouts: source.workouts.map((workout, index) => ({ ...workout, id: `copied-${Date.now()}-${index}` })),
      } : week),
    }));
    notify(`Week ${source.index} copied into week ${selectedWeek}`);
  }

  async function addPersonalExercise(name: string, category: string, mode: EntryMode, cue: string) {
    let exercise: Exercise;
    if (repository) {
      try {
        exercise = await repository.createPersonalExercise({ name, category, mode, cue });
      } catch (error) {
        notify(error instanceof Error ? error.message : "The exercise could not be saved");
        return;
      }
    } else {
      const fields: TrackingField[] = mode === "sets" ? ["reps", "load", "rpe"] : mode === "result" ? ["duration", "distance", "rpe"] : mode === "intervals" ? ["rounds", "duration", "rpe"] : [];
      exercise = { id: `personal-${Date.now()}`, name, category: category || "Custom", cue, scope: "personal", ownerName: viewer.name, defaultMode: mode, defaultFields: fields };
    }
    setPersonalExercises((previous) => [...previous, exercise]);
    setExerciseScope("personal");
    setModal(null);
    notify(`${name} saved to your library`);
  }

  async function publishProgram() {
    if (!repository) {
      notify("Program published for the local demo");
      return;
    }
    try {
      await repository.publishProgram(program.versionId);
      await reloadCurrentProgram();
      notify("Program published · a fresh editable draft is ready");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The program could not be published");
    }
  }

  async function removeCoachAccess(connection: CoachConnection) {
    if (repository) {
      try {
        await repository.endCoachRelationship(connection.relationshipId);
        applyWorkspace(await repository.loadWorkspace());
      } catch (error) {
        notify(error instanceof Error ? error.message : "Coach access could not be removed");
        return;
      }
    } else {
      setWorkspace((previous) => ({
        ...previous,
        coachConnections: previous.coachConnections.filter((item) => item.relationshipId !== connection.relationshipId),
      }));
    }
    notify("Coach access removed");
  }

  async function createCoachInvite(email: string) {
    if (repository) return repository.createCoachInvite(email);
    return `${window.location.origin}/?coach_invite=demo-${Date.now()}`;
  }

  async function openAthleteProgram(athlete: AthleteSummary) {
    if (!repository) {
      navigate("program");
      return;
    }
    try {
      selectProgram(await repository.loadProgramForAthlete(athlete.id));
      setActiveView("program");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      notify(error instanceof Error ? error.message : "The athlete program could not be opened");
    }
  }

  return (
    <main className="app-shell">
      <Sidebar activeView={activeView} onNavigate={navigate} viewer={viewer} onSignOut={onSignOut} onOpenTestPersonas={onOpenTestPersonas} coachCount={workspace.coachedAthletes.length} />

      <section className="app-content">
        {viewer.isTest && <div className="test-data-banner"><FlaskConical size={15} /><span><strong>Test account</strong> Fictional development data can be reset at any time.</span>{onOpenTestPersonas && <button onClick={onOpenTestPersonas}>Switch persona</button>}</div>}
        <div className="mobile-topbar">
          <button className="brand-mark" onClick={() => navigate("today")}>LL</button>
          <strong>Lift Log</strong>
          <button className="avatar mobile-avatar" aria-label={onOpenTestPersonas ? "Open test accounts" : `Sign out ${viewer.name}`} title={onOpenTestPersonas ? "Test accounts" : "Sign out"} onClick={onOpenTestPersonas ?? onSignOut}>{viewer.initials}</button>
        </div>

        {activeView === "today" && todayWorkout && (
          <TodayView
            program={todayProgram}
            workout={todayWorkout}
            completedSessions={workspace.completedSessions}
            workoutStarted={workoutStarted}
            workoutComplete={workoutComplete}
            setLogs={setLogs}
            resultLogs={resultLogs}
            sessionRpe={sessionRpe}
            sessionNote={sessionNote}
            onStart={startWorkout}
            onFinish={finishWorkout}
            onReset={() => { setWorkoutComplete(false); setWorkoutStarted(false); }}
            onUpdateSet={updateSet}
            onAddSet={addSet}
            onRemoveSet={removeSet}
            onUpdateResult={updateResult}
            onSessionRpe={setSessionRpe}
            onSessionNote={setSessionNote}
            onNavigate={navigate}
          />
        )}
        {activeView === "today" && !todayWorkout && <EmptyTodayView onNavigate={navigate} />}
        {activeView === "program" && currentWeek && (
          <ProgramView
            program={program}
            currentWeek={currentWeek}
            selectedWeek={selectedWeek}
            selectedWorkout={selectedWorkout}
            exercises={[...workspace.globalExercises, ...personalExercises]}
            onSelectWeek={(week) => { setSelectedWeek(week); setSelectedWorkoutId(program.weeks[week - 1].workouts[0]?.id ?? ""); }}
            onSelectWorkout={setSelectedWorkoutId}
            onAddWorkout={() => setModal("workout")}
            onDuplicateWeek={duplicateWeek}
            onAddExercise={addExerciseToWorkout}
            onRemoveItem={removeWorkoutItem}
            onPublish={publishProgram}
          />
        )}
        {activeView === "calendar" && <CalendarView sessions={workspace.completedSessions} onNavigate={navigate} />}
        {activeView === "exercises" && (
          <ExercisesView
            scope={exerciseScope}
            query={exerciseQuery}
            global={workspace.globalExercises}
            personal={personalExercises}
            onScope={setExerciseScope}
            onQuery={setExerciseQuery}
            onAdd={() => setModal("exercise")}
          />
        )}
        {activeView === "coaching" && (
          <CoachingView
            mode={coachMode}
            coachConnections={workspace.coachConnections}
            athletes={workspace.coachedAthletes}
            selectedAthlete={selectedAthlete}
            onMode={setCoachMode}
            onInvite={() => setModal("invite")}
            onDisconnect={removeCoachAccess}
            onSelectAthlete={setSelectedAthlete}
            onEditAthlete={openAthleteProgram}
          />
        )}
      </section>

      {modal === "exercise" && <ExerciseModal onClose={() => setModal(null)} onSave={addPersonalExercise} />}
      {modal === "workout" && <WorkoutModal onClose={() => setModal(null)} onSave={addWorkout} />}
      {modal === "invite" && <InviteModal onClose={() => setModal(null)} onInvite={createCoachInvite} />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </main>
  );
}

function Sidebar({ activeView, onNavigate, viewer, onSignOut, onOpenTestPersonas, coachCount }: { activeView: ViewName; onNavigate: (view: ViewName) => void; viewer: AppViewer; onSignOut: () => void; onOpenTestPersonas?: () => void; coachCount: number }) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate("today")}><span className="brand-mark">LL</span><span><strong>Lift Log</strong><small>Training workspace</small></span></button>
      <nav className="main-nav" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={cn("nav-item", activeView === item.id && "active")} onClick={() => onNavigate(item.id)}><Icon size={18} /><span>{item.label}</span>{item.id === "coaching" && coachCount > 0 && <em>{coachCount}</em>}</button>;
        })}
      </nav>
      <div className="sidebar-callout"><Sparkles size={17} /><div><strong>Build your next week</strong><small>Your program is ready to edit.</small></div><button onClick={() => onNavigate("program")} aria-label="Open program"><ChevronRight size={16} /></button></div>
      {onOpenTestPersonas && <button className="test-persona-open" onClick={onOpenTestPersonas}><FlaskConical size={15} />Test accounts</button>}
      <div className="profile-menu"><span className="avatar">{viewer.initials}</span><div><strong>{viewer.name}</strong><small>{viewer.isDemo ? "Local demo workspace" : viewer.isTest ? "Test population" : viewer.email}</small></div><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={17} /></button></div>
    </aside>
  );
}

function PageHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{children && <div className="page-actions">{children}</div>}</header>;
}

function EmptyTodayView({ onNavigate }: { onNavigate: (view: ViewName) => void }) {
  return <><PageHeader eyebrow="Today" title="No workout planned" description="Your program is ready for a session whenever you are." /><div className="panel empty-state"><Dumbbell size={28} /><h3>Build your first workout</h3><p>Add a workout and choose exercises from the reusable library.</p><button className="button primary" onClick={() => onNavigate("program")}><Plus size={15} />Open program builder</button></div></>;
}

function TodayView({ program, workout, completedSessions, workoutStarted, workoutComplete, setLogs, resultLogs, sessionRpe, sessionNote, onStart, onFinish, onReset, onUpdateSet, onAddSet, onRemoveSet, onUpdateResult, onSessionRpe, onSessionNote, onNavigate }: {
  program: Program; workout: PlannedWorkout; completedSessions: CompletedSession[]; workoutStarted: boolean; workoutComplete: boolean; setLogs: Record<string, SetLog[]>; resultLogs: Record<string, Record<string, string>>; sessionRpe: string; sessionNote: string;
  onStart: () => void; onFinish: () => void; onReset: () => void; onUpdateSet: (itemId: string, index: number, field: keyof SetLog, value: string) => void; onAddSet: (itemId: string) => void; onRemoveSet: (itemId: string, index: number) => void; onUpdateResult: (itemId: string, field: string, value: string) => void; onSessionRpe: (value: string) => void; onSessionNote: (value: string) => void; onNavigate: (view: ViewName) => void;
}) {
  const dateLabel = new Date().toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" });
  const activeWeek = program.weeks[program.activeWeek - 1] ?? program.weeks[0];
  const workoutIndex = Math.max(0, activeWeek.workouts.findIndex((item) => item.id === workout.id));
  const monday = new Date();
  const weekday = monday.getDay() || 7;
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - weekday + 1);
  const completedThisWeek = completedSessions.filter((session) => new Date(`${session.date}T12:00:00`) >= monday).length;
  const plannedCount = activeWeek.workouts.length;
  const progress = plannedCount ? Math.min(100, Math.round(completedThisWeek / plannedCount * 100)) : 0;
  const lastSession = completedSessions[0];
  return <>
    <PageHeader eyebrow={dateLabel} title={workoutComplete ? "Session complete" : "Today’s training"} description={`Week ${program.activeWeek} of ${program.title} · ${program.phase} phase`}>
      <button className="button secondary" onClick={() => onNavigate("program")}><Pencil size={15} />Edit plan</button>
    </PageHeader>
    {workoutComplete && <div className="success-banner"><span><Check size={20} /></span><div><strong>Nice work. Your session is logged.</strong><p>RPE {sessionRpe} · {workout.durationMinutes} planned minutes</p></div><button className="button ghost" onClick={onReset}>View again</button></div>}
    <div className="today-layout">
      <article className="workout-card">
        <div className="workout-heading"><div><p className="eyebrow">Session {workoutIndex + 1} of {activeWeek.workouts.length}</p><h2>{workout.title}</h2><p>{workout.dayLabel} · follow the prescription and adjust to how you feel today.</p></div><span className="time-pill"><Clock3 size={14} />~ {workout.durationMinutes} min</span></div>
        {workout.sections.map((section) => <section className="workout-section" key={section.id}><div className="section-heading"><span>{section.title}</span><small>{section.items.length} {section.items.length === 1 ? "item" : "items"}</small></div>{section.items.map((item) => <WorkoutLogItem key={item.id} item={item} active={workoutStarted} setLogs={setLogs[item.id] ?? []} resultLog={resultLogs[item.id] ?? {}} onUpdateSet={onUpdateSet} onAddSet={onAddSet} onRemoveSet={onRemoveSet} onUpdateResult={onUpdateResult} />)}</section>)}
        {!workoutStarted && !workoutComplete && <button className="button primary full" onClick={onStart}><Activity size={17} />Start workout</button>}
        {workoutStarted && <div className="session-finish"><label><span>How did the whole session feel?</span><div className="rpe-selector">{[5,6,7,8,9,10].map((rpe) => <button key={rpe} className={sessionRpe === String(rpe) ? "selected" : ""} onClick={() => onSessionRpe(String(rpe))}>{rpe}</button>)}</div></label><label><span>Session notes <em>optional</em></span><textarea value={sessionNote} onChange={(event) => onSessionNote(event.target.value)} placeholder="What felt good? Anything to adjust next time?" /></label><button className="button primary full" onClick={onFinish}><Check size={17} />Finish and save session</button></div>}
      </article>
      <aside className="today-rail">
        <div className="panel week-card"><div className="panel-heading"><div><p className="eyebrow">This week</p><h3>{completedThisWeek} of {plannedCount} sessions</h3></div><span>{progress}%</span></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="week-session-list">{activeWeek.workouts.map((item, index) => <button key={item.id} className={cn(index < completedThisWeek && "done", item.id === workout.id && "current")} onClick={() => onNavigate("program")}><span>{index < completedThisWeek ? <Check size={14} /> : index + 1}</span><div><strong>{item.title}</strong><small>{item.dayLabel} · {item.durationMinutes} min</small></div><ChevronRight size={15} /></button>)}</div></div>
        <div className="stats-grid"><div className="panel stat-card"><small>Last session</small><strong>{lastSession ? `RPE ${lastSession.rpe || "—"}` : "No logs"}</strong><span>{lastSession?.workoutTitle ?? "Start when ready"}</span></div><div className="panel stat-card"><small>Total sessions</small><strong>{completedSessions.length}</strong><span>{completedSessions.length ? "History synced" : "Ready to begin"}</span></div></div>
        <div className="panel coach-note"><div className="panel-heading"><div><p className="eyebrow">Plan guidance</p><h3>Train the intent</h3></div><MessageSquareText size={18} /></div><p>Use the target RPE as a guide and leave a note after the session when something should change next time.</p><small>Saved with this program</small></div>
      </aside>
    </div>
  </>;
}

function WorkoutLogItem({ item, active, setLogs, resultLog, onUpdateSet, onAddSet, onRemoveSet, onUpdateResult }: { item: WorkoutItem; active: boolean; setLogs: SetLog[]; resultLog: Record<string, string>; onUpdateSet: (itemId: string, index: number, field: keyof SetLog, value: string) => void; onAddSet: (itemId: string) => void; onRemoveSet: (itemId: string, index: number) => void; onUpdateResult: (itemId: string, field: string, value: string) => void }) {
  if (item.mode === "none") return <div className="instruction-item"><span className="instruction-dot" /><div><strong>{item.title}</strong><small>{item.cue}</small></div></div>;
  return <div className="log-item"><div className="exercise-heading"><div><strong>{item.title}</strong><small>{item.cue}</small></div><span>{prescriptionLabel(item)}{item.prescription.targetRpe ? ` · RPE ${item.prescription.targetRpe}` : ""}</span></div>
    {item.mode === "sets" && <div className={cn("set-table", `tracking-${item.fields.length}`)}><div className="set-header"><span>Set</span>{item.fields.includes("reps") && <span>Reps</span>}{item.fields.includes("load") && <span>Load kg</span>}{item.fields.includes("rpe") && <span>RPE</span>}<span /></div>{setLogs.map((row, index) => <div className="set-row" key={index}><span>{index + 1}</span>{item.fields.includes("reps") && <input disabled={!active} inputMode="numeric" value={row.reps} onChange={(event) => onUpdateSet(item.id, index, "reps", event.target.value)} placeholder="—" />}{item.fields.includes("load") && <input disabled={!active} inputMode="decimal" value={row.load} onChange={(event) => onUpdateSet(item.id, index, "load", event.target.value)} placeholder="—" />}{item.fields.includes("rpe") && <input disabled={!active} inputMode="decimal" value={row.rpe} onChange={(event) => onUpdateSet(item.id, index, "rpe", event.target.value)} placeholder="—" />}<button disabled={!active || setLogs.length === 1} aria-label={`Remove set ${index + 1}`} onClick={() => onRemoveSet(item.id, index)}><X size={14} /></button></div>)}{active && <button className="add-row" onClick={() => onAddSet(item.id)}><Plus size={14} />Add set</button>}</div>}
    {(item.mode === "result" || item.mode === "intervals") && <div className="result-fields">{item.mode === "intervals" && <ResultInput label="Rounds" unit="rounds" disabled={!active} value={resultLog.rounds ?? ""} onChange={(value) => onUpdateResult(item.id, "rounds", value)} />}{item.fields.includes("duration") && <ResultInput label="Duration" unit="min" disabled={!active} value={resultLog.duration ?? ""} onChange={(value) => onUpdateResult(item.id, "duration", value)} />}{item.fields.includes("distance") && <ResultInput label="Distance" unit="km" disabled={!active} value={resultLog.distance ?? ""} onChange={(value) => onUpdateResult(item.id, "distance", value)} />}{item.fields.includes("heartRate") && <ResultInput label="Avg HR" unit="bpm" disabled={!active} value={resultLog.heartRate ?? ""} onChange={(value) => onUpdateResult(item.id, "heartRate", value)} />}{item.fields.includes("rpe") && <ResultInput label="RPE" unit="/ 10" disabled={!active} value={resultLog.rpe ?? ""} onChange={(value) => onUpdateResult(item.id, "rpe", value)} />}</div>}
  </div>;
}

function ResultInput({ label, unit, disabled, value, onChange }: { label: string; unit: string; disabled: boolean; value: string; onChange: (value: string) => void }) {
  return <label className="result-input"><span>{label}</span><div><input disabled={disabled} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} placeholder="—" /><small>{unit}</small></div></label>;
}

function ProgramView({ program, currentWeek, selectedWeek, selectedWorkout, exercises, onSelectWeek, onSelectWorkout, onAddWorkout, onDuplicateWeek, onAddExercise, onRemoveItem, onPublish }: {
  program: Program; currentWeek: Program["weeks"][number]; selectedWeek: number; selectedWorkout?: PlannedWorkout; exercises: Exercise[]; onSelectWeek: (week: number) => void; onSelectWorkout: (id: string) => void; onAddWorkout: () => void; onDuplicateWeek: () => void; onAddExercise: (exercise: Exercise) => void; onRemoveItem: (id: string) => void; onPublish: () => void;
}) {
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerResults = exercises.filter((exercise) => exercise.name.toLowerCase().includes(pickerQuery.toLowerCase())).slice(0, 6);
  return <>
    <PageHeader eyebrow={program.ownerName === program.createdByName ? "Your active plan" : `Planning for ${program.ownerName}`} title={program.title} description={program.description}><span className="status-pill"><i />Draft changes saved</span><button className="button primary small" onClick={onPublish}><Check size={15} />Publish plan</button></PageHeader>
    <div className="program-summary panel"><div><span className="program-icon"><Dumbbell size={21} /></span><div><strong>{program.mode === "fixed" ? `${program.weeks.length}-week program` : "Repeating week"}</strong><small>{program.weeks[0].workouts.length} sessions each week · Created by {program.createdByName}</small></div></div><div className="summary-metrics"><span><small>Current phase</small><strong>{program.phase}</strong></span><span><small>Active week</small><strong>{program.activeWeek} of {program.weeks.length}</strong></span><button className="icon-button"><Ellipsis size={18} /></button></div></div>
    <div className="week-tabs"><button className="icon-button" onClick={() => onSelectWeek(Math.max(1, selectedWeek - 1))} disabled={selectedWeek === 1}><ArrowLeft size={16} /></button><div>{program.weeks.map((week) => <button key={week.index} className={selectedWeek === week.index ? "active" : ""} onClick={() => onSelectWeek(week.index)}><small>Week</small><strong>{week.index}</strong></button>)}</div><button className="icon-button" onClick={() => onSelectWeek(Math.min(program.weeks.length, selectedWeek + 1))} disabled={selectedWeek === program.weeks.length}><ArrowRight size={16} /></button></div>
    <div className="builder-layout">
      <aside className="workout-list panel"><div className="panel-heading"><div><p className="eyebrow">Week {selectedWeek}</p><h3>{currentWeek.label}</h3></div><button className="icon-button" onClick={onAddWorkout} aria-label="Add workout"><Plus size={17} /></button></div><div className="workout-list-items">{currentWeek.workouts.map((workout, index) => <button key={workout.id} className={selectedWorkout?.id === workout.id ? "active" : ""} onClick={() => onSelectWorkout(workout.id)}><span>{index + 1}</span><div><strong>{workout.title}</strong><small>{workout.dayLabel} · {workout.durationMinutes} min</small></div><ChevronRight size={16} /></button>)}</div><button className="button secondary full" onClick={onAddWorkout}><Plus size={15} />Add workout</button><button className="text-button" onClick={onDuplicateWeek}><Copy size={14} />Copy previous week</button></aside>
      <section className="builder-editor panel">{selectedWorkout ? <><div className="editor-heading"><div><p className="eyebrow">{selectedWorkout.dayLabel}</p><h2>{selectedWorkout.title}</h2><p>Estimated {selectedWorkout.durationMinutes} minutes</p></div><button className="icon-button"><Settings2 size={18} /></button></div>{selectedWorkout.sections.map((section) => <div className="builder-section" key={section.id}><div className="builder-section-heading"><span>{section.title}</span><button className="text-button"><Pencil size={12} />Rename</button></div>{section.items.length ? section.items.map((item) => <div className="builder-item" key={item.id}><span className="drag-handle">⠿</span><div className="builder-item-icon">{item.mode === "sets" ? <Dumbbell size={16} /> : item.mode === "none" ? <ListPlus size={16} /> : <Timer size={16} />}</div><div><strong>{item.title}</strong><small>{modeLabel(item.mode)} · {prescriptionLabel(item)}</small></div><button className="icon-button danger" aria-label={`Remove ${item.title}`} onClick={() => onRemoveItem(item.id)}><Trash2 size={15} /></button></div>) : <div className="empty-inline">No items in this section yet.</div>}</div>)}</> : <div className="empty-state"><Dumbbell size={28} /><h3>Select a workout</h3><p>Choose a session from the left to start editing.</p></div>}</section>
      <aside className="exercise-picker panel"><div className="panel-heading"><div><p className="eyebrow">Exercise library</p><h3>Add an item</h3></div></div><label className="search-field"><Search size={16} /><input value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="Search exercises" /></label><div className="picker-results">{pickerResults.map((exercise) => <button key={exercise.id} onClick={() => onAddExercise(exercise)}><span className="scope-dot">{exercise.scope === "global" ? "G" : "P"}</span><div><strong>{exercise.name}</strong><small>{exercise.category} · {modeLabel(exercise.defaultMode)}</small></div><Plus size={15} /></button>)}</div><small className="picker-help">Global exercises and your personal library are both available here.</small></aside>
    </div>
  </>;
}

function CalendarView({ sessions, onNavigate }: { sessions: CompletedSession[]; onNavigate: (view: ViewName) => void }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sessions[0]?.id ?? null);
  const now = new Date();
  const baseDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = baseDate.toLocaleDateString("en", { month: "long", year: "numeric" });
  const selected = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0];
  const monthSessions = sessions.filter((session) => {
    const date = new Date(`${session.date}T12:00:00`);
    return date.getFullYear() === year && date.getMonth() === month;
  });
  const ratedSessions = monthSessions.filter((session) => session.rpe > 0);
  const averageRpe = ratedSessions.length ? ratedSessions.reduce((sum, session) => sum + session.rpe, 0) / ratedSessions.length : 0;
  const cells = Array.from({ length: firstDay + days }, (_, index) => index < firstDay ? null : index - firstDay + 1);
  return <>
    <PageHeader eyebrow="Training history" title="Calendar" description="Your planned work and completed sessions in one place."><button className="button secondary" onClick={() => onNavigate("today")}><Activity size={15} />Log today</button></PageHeader>
    <div className="calendar-stats"><div className="panel"><span><TrendingUp size={18} /></span><div><small>Sessions this month</small><strong>{monthSessions.length}</strong></div><em>{monthSessions.length ? "Synced history" : "No sessions yet"}</em></div><div className="panel"><span><Activity size={18} /></span><div><small>Average session RPE</small><strong>{averageRpe ? averageRpe.toFixed(1) : "—"}</strong></div><em>{averageRpe ? "From completed logs" : "Add RPE after training"}</em></div><div className="panel"><span><CalendarDays size={18} /></span><div><small>Training days</small><strong>{new Set(monthSessions.map((session) => session.date)).size}</strong></div><em>This calendar month</em></div></div>
    <div className="calendar-layout"><section className="calendar-card panel"><div className="calendar-heading"><button className="icon-button" onClick={() => setMonthOffset((value) => value - 1)}><ArrowLeft size={16} /></button><h2>{monthName}</h2><button className="icon-button" onClick={() => setMonthOffset((value) => value + 1)}><ArrowRight size={16} /></button></div><div className="calendar-grid">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => <span className="calendar-dow" key={day}>{day}</span>)}{cells.map((day, index) => {if (!day) return <span className="calendar-day empty" key={`empty-${index}`} />; const date = `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`; const session = sessions.find((item) => item.date === date); const isToday = date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`; return <button className={cn("calendar-day", session && "trained", isToday && "today", selectedSessionId === session?.id && "selected")} key={date} onClick={() => session && setSelectedSessionId(session.id)}><span>{day}</span>{session && <i><Check size={12} />{session.workoutTitle}</i>}{isToday && !session && <small>Today</small>}</button>;})}</div><div className="calendar-legend"><span><i className="completed-dot" />Completed</span><span><i className="today-dot" />Today</span></div></section><aside className="panel session-detail">{selected ? <><p className="eyebrow">Selected session</p><h3>{selected.workoutTitle}</h3><p className="session-date">{new Date(`${selected.date}T12:00:00`).toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}</p><div className="detail-metrics"><span><small>Duration</small><strong>{selected.durationMinutes} min</strong></span><span><small>Session RPE</small><strong>{selected.rpe || "—"}</strong></span></div><div className="mini-chart">{sessions.slice(0, 5).reverse().map((session) => <span key={session.id} className={session.id === selected.id ? "active" : ""} style={{ height: `${Math.max(12, (session.rpe || 1) * 10)}%` }} />)}</div><small>Recent session effort</small>{selected.note && <div className="session-note"><MessageSquareText size={15} /><p>{selected.note}</p></div>}</> : <div className="empty-state"><CalendarDays size={26} /><h3>No completed sessions</h3><p>Finished workouts will appear here automatically.</p></div>}</aside></div>
  </>;
}

function ExercisesView({ scope, query, global, personal, onScope, onQuery, onAdd }: { scope: "global" | "personal"; query: string; global: Exercise[]; personal: Exercise[]; onScope: (scope: "global" | "personal") => void; onQuery: (query: string) => void; onAdd: () => void }) {
  const source = scope === "global" ? global : personal;
  const filtered = source.filter((exercise) => `${exercise.name} ${exercise.category}`.toLowerCase().includes(query.toLowerCase()));
  const categories = Array.from(new Set(source.map((exercise) => exercise.category))).length;
  return <>
    <PageHeader eyebrow="Reusable movements" title="Exercise library" description="Start with the shared catalogue, then add exercises that are uniquely yours."><button className="button primary" onClick={onAdd}><Plus size={16} />New exercise</button></PageHeader>
    <div className="library-toolbar panel"><div className="segmented-control"><button className={scope === "global" ? "active" : ""} onClick={() => onScope("global")}><BookOpen size={15} />Global library <span>{global.length}</span></button><button className={scope === "personal" ? "active" : ""} onClick={() => onScope("personal")}><CircleUserRound size={15} />My exercises <span>{personal.length}</span></button></div><label className="search-field library-search"><Search size={17} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search by name or category" /></label></div>
    <div className="library-meta"><span>{filtered.length} exercises</span><span>{categories} categories</span><button className="text-button"><Settings2 size={14} />Filter</button></div>
    <div className="exercise-grid">{filtered.map((exercise) => <article className="exercise-card panel" key={exercise.id}><div className="exercise-card-top"><span className={cn("exercise-badge", exercise.scope)}>{exercise.scope === "global" ? "Global" : "Personal"}</span><button className="icon-button"><MoreHorizontal size={17} /></button></div><span className="exercise-category">{exercise.category}</span><h3>{exercise.name}</h3><p>{exercise.cue}</p><div className="exercise-card-footer"><span><Activity size={14} />{modeLabel(exercise.defaultMode)}</span><span>{exercise.defaultFields.length ? exercise.defaultFields.join(" · ") : "No tracking"}</span></div></article>)}{scope === "personal" && <button className="add-exercise-card" onClick={onAdd}><span><Plus size={21} /></span><strong>Create a custom exercise</strong><small>It will be reusable in your own plans and plans you make as a coach.</small></button>}</div>
  </>;
}

function CoachingView({ mode, coachConnections, athletes, selectedAthlete, onMode, onInvite, onDisconnect, onSelectAthlete, onEditAthlete }: {
  mode: "athlete" | "coach";
  coachConnections: CoachConnection[];
  athletes: AthleteSummary[];
  selectedAthlete: AthleteSummary | null;
  onMode: (mode: "athlete" | "coach") => void;
  onInvite: () => void;
  onDisconnect: (connection: CoachConnection) => void;
  onSelectAthlete: (athlete: AthleteSummary) => void;
  onEditAthlete: (athlete: AthleteSummary) => void;
}) {
  return <>
    <PageHeader eyebrow="Shared progress" title="Coaching" description="Invite people you trust to plan with context, or manage the athletes who invited you.">
      <div className="segmented-control compact"><button className={mode === "athlete" ? "active" : ""} onClick={() => onMode("athlete")}>My coaches</button><button className={mode === "coach" ? "active" : ""} onClick={() => onMode("coach")}>Coach workspace</button></div>
    </PageHeader>
    {mode === "athlete" ? <div className="coaching-athlete-layout">
      <section className="panel coach-access-card">
        {coachConnections.length ? <>
          <div className="panel-heading"><div><p className="eyebrow">Plan access</p><h3>{coachConnections.length} active {coachConnections.length === 1 ? "coach" : "coaches"}</h3></div><button className="button secondary small" onClick={onInvite}><UserPlus size={14} />Invite another</button></div>
          <div className="coach-connection-list">{coachConnections.map((connection) => {
            const connectedDate = new Date(`${connection.connectedSince}T12:00:00`).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
            return <article key={connection.relationshipId} className="coach-connection-row"><span className="avatar large">{connection.initials}</span><div><strong>{connection.name}</strong><small>Connected since {connectedDate}</small></div><span className="connected-pill"><i />Connected</span><button className="button danger small" onClick={() => onDisconnect(connection)}><X size={14} />Remove</button></article>;
          })}</div>
          <div className="permission-list"><h3>What your coaches can do</h3><span><Check size={15} />View your calendar, sessions, RPE, and training notes</span><span><Check size={15} />Create and update future program versions</span><span><Check size={15} />Use personal exercises while building your plan</span><span className="locked"><LockKeyhole size={15} />Cannot alter your completed workout history</span></div>
        </> : <div className="invite-empty"><span><UserPlus size={26} /></span><h2>Train with more context</h2><p>Invite a coach to build future plans and review your workout history. You stay in control of every connection.</p><button className="button primary" onClick={onInvite}><Link2 size={15} />Create coach invitation</button></div>}
      </section>
      <aside><div className="panel privacy-card"><LockKeyhole size={20} /><h3>Your data stays yours</h3><p>Removing one coach never affects your programs, history, or other coach connections.</p></div><div className="panel invite-card"><p className="eyebrow">Private invitation</p><h3>{coachConnections.length ? "Add another coach" : "Share a secure link"}</h3><p>The link works only for the account matching the email you enter.</p><button className="button secondary full" onClick={onInvite}><UserPlus size={15} />Create invite link</button></div></aside>
    </div> : <div className="coach-dashboard">
      <section className="panel athlete-list"><div className="panel-heading"><div><p className="eyebrow">Your athletes</p><h3>{athletes.length} active</h3></div><Users size={17} /></div>{athletes.length ? athletes.map((athlete) => <button key={athlete.id} className={selectedAthlete?.id === athlete.id ? "active" : ""} onClick={() => onSelectAthlete(athlete)}><span className="avatar">{athlete.initials}</span><div><strong>{athlete.name}</strong><small>{athlete.programTitle}</small></div>{athlete.trend === "watch" && <em>Check in</em>}<ChevronRight size={16} /></button>) : <div className="empty-state"><Users size={24} /><h3>No athletes yet</h3><p>An athlete appears here after accepting their invitation to you.</p></div>}</section>
      {selectedAthlete ? <section className="athlete-overview"><div className="panel athlete-hero"><div className="athlete-name"><span className="avatar large">{selectedAthlete.initials}</span><div><p className="eyebrow">Athlete overview</p><h2>{selectedAthlete.name}</h2><p>{selectedAthlete.programTitle}</p></div></div><button className="button primary" onClick={() => onEditAthlete(selectedAthlete)}><Pencil size={15} />Edit future plan</button></div><div className="athlete-kpis"><div className="panel"><small>This week</small><strong>{selectedAthlete.completedThisWeek}/{selectedAthlete.plannedThisWeek || "—"}</strong><span>sessions complete</span></div><div className="panel"><small>Latest RPE</small><strong>{selectedAthlete.latestRpe ?? "—"}</strong><span>{selectedAthlete.trend === "watch" ? "Higher than target" : "No high-RPE flag"}</span></div><div className="panel"><small>Last trained</small><strong>{selectedAthlete.lastTrainingLabel}</strong><span>Most recent synced log</span></div></div><div className="panel athlete-report"><div className="panel-heading"><div><p className="eyebrow">Current week</p><h3>Adherence at a glance</h3></div><span className="status-pill"><i />Live report</span></div><div className="report-bars">{Array.from({ length: Math.max(1, selectedAthlete.plannedThisWeek) }, (_, index) => <span key={index}><i style={{ height: index < selectedAthlete.completedThisWeek ? "82%" : "18%" }} className={selectedAthlete.trend === "watch" && index === selectedAthlete.completedThisWeek - 1 ? "watch" : ""} /><small>{index + 1}</small></span>)}</div><div className="report-legend"><span><i />Completed work</span><span><i className="watch" />Latest high RPE</span></div></div></section> : <section className="panel empty-state"><Users size={28} /><h3>Select an athlete</h3><p>Choose an athlete to view their latest training summary.</p></section>}
    </div>}
  </>;
}

function ModalShell({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop"><button className="modal-dismiss-layer" onClick={onClose} aria-label="Close dialog" /><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><p className="eyebrow">Lift Log</p><h2>{title}</h2><p>{description}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{children}</section></div>;
}

function ExerciseModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, category: string, mode: EntryMode, cue: string) => void }) {
  const [name, setName] = useState(""); const [category, setCategory] = useState(""); const [mode, setMode] = useState<EntryMode>("sets"); const [cue, setCue] = useState("");
  return <ModalShell title="Create an exercise" description="Save it once, then reuse it in any program you build." onClose={onClose}><div className="form-grid"><label className="form-field full"><span>Exercise name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Tall clean + front squat" /></label><label className="form-field"><span>Category</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="e.g. Weightlifting" /></label><label className="form-field"><span>Default logging</span><select value={mode} onChange={(event) => setMode(event.target.value as EntryMode)}><option value="sets">Sets</option><option value="result">Single result</option><option value="intervals">Intervals</option><option value="none">Instructions only</option></select></label><label className="form-field full"><span>Default cue</span><textarea value={cue} onChange={(event) => setCue(event.target.value)} placeholder="Short instruction shown in the workout" /></label></div><div className="modal-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!name.trim()} onClick={() => onSave(name.trim(), category.trim(), mode, cue.trim())}>Save exercise</button></div></ModalShell>;
}

function WorkoutModal({ onClose, onSave }: { onClose: () => void; onSave: (title: string, day: string) => void }) {
  const [title, setTitle] = useState(""); const [day, setDay] = useState("Flexible");
  return <ModalShell title="Add a workout" description="Create a session for this week, then fill it from your exercise library." onClose={onClose}><div className="form-grid"><label className="form-field full"><span>Workout name</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Upper body" /></label><label className="form-field full"><span>Schedule</span><select value={day} onChange={(event) => setDay(event.target.value)}>{["Flexible","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((value)=><option value={value} key={value}>{value}</option>)}</select></label></div><div className="modal-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!title.trim()} onClick={() => onSave(title.trim(), day)}>Add workout</button></div></ModalShell>;
}

function InviteModal({ onClose, onInvite }: { onClose: () => void; onInvite: (email: string) => Promise<string> }) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function createLink() {
    setSending(true);
    setError("");
    try {
      const invitationLink = await onInvite(email.trim());
      setLink(invitationLink);
      await navigator.clipboard?.writeText(invitationLink);
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "The invitation could not be created.");
    } finally {
      setSending(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(link);
  }

  return <ModalShell title="Invite a coach" description="They can plan future training and review your reports after accepting." onClose={onClose}>{link ? <><div className="invite-permissions"><span><Check size={14} />Private invitation created</span><span><LockKeyhole size={14} />Only {email} can accept it</span></div><label className="form-field full"><span>Invitation link</span><input readOnly value={link} onFocus={(event) => event.currentTarget.select()} /></label><div className="modal-actions"><button className="button secondary" onClick={onClose}>Done</button><button className="button primary" onClick={copyLink}><Copy size={15} />Copy link</button></div></> : <><div className="invite-permissions"><span><Check size={14} />View your training and reports</span><span><Check size={14} />Create future program versions</span><span><LockKeyhole size={14} />No access to change completed logs</span></div><label className="form-field full"><span>Coach’s account email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="coach@example.com" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!email.includes("@") || sending} onClick={createLink}>{sending ? "Creating…" : "Create and copy link"}</button></div></>}</ModalShell>;
}
