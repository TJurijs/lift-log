import {
  Activity, BookOpen, CalendarClock, CalendarDays, CalendarPlus, CircleStop,
  Copy, Layers3, LayoutDashboard, MoreHorizontal, Pencil, Trash2, Users,
} from "lucide-react";
import type { ViewName } from "../lib/domain";

/** Stable destination identity; compact labels are a presentation choice. */
export const navigationItems = [
  { id: "today", label: "Next workouts", shortLabel: "Next", icon: LayoutDashboard },
  { id: "program", label: "Programs", shortLabel: "Programs", icon: Layers3 },
  { id: "calendar", label: "Calendar", shortLabel: "Calendar", icon: CalendarDays },
  { id: "exercises", label: "Exercises", shortLabel: "Exercises", icon: BookOpen },
  { id: "coaching", label: "Coaching", shortLabel: "Coaching", icon: Users },
] satisfies Array<{ id: ViewName; label: string; shortLabel: string; icon: typeof Activity }>;

export function destinationLabel(view: ViewName, compact = false) {
  const destination = navigationItems.find((item) => item.id === view)!;
  return compact ? destination.shortLabel : destination.label;
}

const trainingContent = {
  program: { label: "Program", pluralLabel: "Programs", icon: Layers3 },
  quick_workout: { label: "Workout", pluralLabel: "Workouts", icon: Activity },
} as const;

/** A lifecycle change never changes the underlying kind of training content. */
export function trainingContentUi(contentType: "program" | "quick_workout" = "program") {
  return trainingContent[contentType];
}

export const actionUi = {
  use: { label: "Use", icon: Layers3 },
  schedule: { label: "Schedule", icon: CalendarPlus },
  reschedule: { label: "Reschedule", icon: CalendarClock },
  edit: { label: "Edit", icon: Pencil },
  duplicate: { label: "Duplicate", icon: Copy },
  delete: { label: "Delete", icon: Trash2 },
  end: { label: "End", icon: CircleStop },
  more: { label: "More", icon: MoreHorizontal },
} as const;
