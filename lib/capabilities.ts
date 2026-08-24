import type { Program, ScheduledWorkout } from "./domain";

export type CoachReadScope = "authored_only";

export interface TrainingContentPolicyInput {
  viewerId: string;
  athleteOwnerId?: string;
  authorId?: string;
  source: Program["sourceType"];
  contentType: NonNullable<Program["contentType"]>;
  lifecycle: Program["versionStatus"];
  available: boolean;
  archived?: boolean;
  activeCoachOfOwner: boolean;
  hasAssignableAthletes?: boolean;
  coachReadScope: CoachReadScope;
}

export interface TrainingContentCapabilities {
  view: boolean;
  copyToOwn: boolean;
  edit: boolean;
  publish: boolean;
  manageAvailability: boolean;
  schedule: boolean;
  assign: boolean;
  provideInitialAssignmentDate: boolean;
  deleteOwn: boolean;
  archiveInstance: boolean;
}

/**
 * Viewer-facing affordances for one content instance.
 *
 * These checks are intentionally independent from RLS. Callers must guard the
 * handler again, and the repository/database remain authoritative.
 */
export function deriveTrainingContentCapabilities(
  input: TrainingContentPolicyInput,
): TrainingContentCapabilities {
  const archived = input.archived === true;
  const viewerIsOwner = input.athleteOwnerId === input.viewerId;
  const viewerIsAuthor = input.authorId === input.viewerId;
  const viewerIsAuthoringCoach =
    input.source === "coach" &&
    viewerIsAuthor &&
    input.activeCoachOfOwner;
  const viewerCanAuthor =
    (input.source === "self" && viewerIsOwner && viewerIsAuthor) ||
    viewerIsAuthoringCoach;
  const coachCanView = viewerIsAuthoringCoach;
  const view =
    !archived &&
    (input.source === "library" || viewerIsOwner || coachCanView);
  const published = input.lifecycle === "published";

  const assign =
    view &&
    !archived &&
    published &&
    input.source === "self" &&
    viewerIsOwner &&
    viewerIsAuthor &&
    input.hasAssignableAthletes === true;

  return {
    view,
    copyToOwn:
      view &&
      published &&
      (input.source === "library" ||
        (input.source === "coach" && viewerIsOwner)),
    edit:
      view &&
      !archived &&
      viewerCanAuthor &&
      input.lifecycle !== "superseded",
    publish:
      view &&
      !archived &&
      viewerCanAuthor &&
      input.lifecycle === "draft",
    manageAvailability: view && !archived && published && viewerIsOwner,
    schedule:
      view &&
      !archived &&
      published &&
      viewerIsOwner &&
      input.available,
    assign,
    provideInitialAssignmentDate:
      assign && input.contentType === "quick_workout",
    deleteOwn:
      view &&
      !archived &&
      input.source === "self" &&
      viewerIsOwner &&
      viewerIsAuthor,
    archiveInstance:
      view &&
      !archived &&
      viewerIsOwner &&
      input.source !== "self",
  };
}

export interface OccurrencePolicyInput {
  viewerId: string;
  athleteOwnerId: string;
  /** The durable author of the program version that produced the occurrence. */
  programAuthorId?: string;
  status: ScheduledWorkout["status"];
  activeCoachOfOwner: boolean;
}

export interface OccurrenceCapabilities {
  view: boolean;
  startOrResume: boolean;
  reschedule: boolean;
  skip: boolean;
  restore: boolean;
  resetToPlanned: boolean;
  remove: boolean;
  editResult: boolean;
  finish: boolean;
}

export function deriveOccurrenceCapabilities(
  input: OccurrencePolicyInput,
): OccurrenceCapabilities {
  const viewerIsOwner = input.viewerId === input.athleteOwnerId;
  const coachCanViewAuthoredOccurrence =
    input.activeCoachOfOwner && input.programAuthorId === input.viewerId;
  const view = viewerIsOwner || coachCanViewAuthoredOccurrence;
  return {
    view,
    startOrResume:
      viewerIsOwner &&
      (input.status === "planned" || input.status === "in_progress"),
    reschedule: viewerIsOwner && input.status === "planned",
    skip:
      viewerIsOwner &&
      (input.status === "planned" || input.status === "in_progress"),
    restore: viewerIsOwner && input.status === "skipped",
    resetToPlanned: viewerIsOwner && input.status === "in_progress",
    remove:
      viewerIsOwner &&
      (input.status === "planned" || input.status === "skipped"),
    editResult: viewerIsOwner && input.status === "in_progress",
    finish: viewerIsOwner && input.status === "in_progress",
  };
}

export type TrainingContentCapability = keyof TrainingContentCapabilities;
export type OccurrenceCapability = keyof OccurrenceCapabilities;

export class CapabilityDeniedError extends Error {
  constructor(readonly capability: string) {
    super(`Capability denied: ${capability}`);
    this.name = "CapabilityDeniedError";
  }
}

export function requireCapability<T extends string>(
  capabilities: Record<T, boolean>,
  capability: T,
) {
  if (!capabilities[capability]) throw new CapabilityDeniedError(capability);
}
