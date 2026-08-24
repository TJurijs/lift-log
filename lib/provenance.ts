import type { Program } from "./domain";

export type ProvenanceTone = "library" | "self" | "coach" | "neutral";

export interface ProvenancePresentation {
  origin: Program["sourceType"] | "unknown";
  tone: ProvenanceTone;
  label: string;
  title: string;
  creatorName?: string;
}

export interface ProvenanceContext {
  origin?: Program["sourceType"];
  viewerId: string;
  athleteOwnerId?: string;
  athleteOwnerName?: string;
  authorId?: string;
  authorName?: string;
}

function withName(prefix: string, name?: string) {
  return name ? `${prefix} · ${name}` : prefix;
}

/**
 * Converts factual ownership/authorship/provenance into viewer-relative copy.
 * Unknown source data remains unknown; it never masquerades as Library.
 */
export function presentProvenance(
  context: ProvenanceContext,
): ProvenancePresentation {
  if (!context.origin) {
    return {
      origin: "unknown",
      tone: "neutral",
      label: "Source unavailable",
      title: "Content provenance is unavailable",
    };
  }

  if (context.origin === "library") {
    return {
      origin: "library",
      tone: "library",
      label: "Library",
      title: "Lift Log library",
    };
  }

  const viewerIsAuthor =
    Boolean(context.authorId) && context.viewerId === context.authorId;
  const viewerIsAthleteOwner =
    Boolean(context.athleteOwnerId) &&
    context.viewerId === context.athleteOwnerId;

  if (context.origin === "self") {
    if (viewerIsAuthor) {
      return {
        origin: "self",
        tone: "self",
        label: "Own",
        title: "Created by you",
        creatorName: context.authorName,
      };
    }
    return {
      origin: "self",
      tone: "self",
      label: withName("Athlete", context.authorName ?? context.athleteOwnerName),
      title: context.authorName
        ? `Created by ${context.authorName}`
        : "Created by the athlete",
      creatorName: context.authorName ?? context.athleteOwnerName,
    };
  }

  if (viewerIsAuthor) {
    return {
      origin: "coach",
      tone: "coach",
      label: "Coach · You",
      title: "Assigned by you",
      creatorName: context.authorName,
    };
  }

  if (viewerIsAthleteOwner) {
    return {
      origin: "coach",
      tone: "coach",
      label: withName("Coach", context.authorName),
      title: context.authorName
        ? `Created by your coach, ${context.authorName}`
        : "Created by your coach",
      creatorName: context.authorName,
    };
  }

  return {
    origin: "coach",
    tone: "coach",
    label: withName("Coach", context.authorName),
    title:
      context.authorName && context.athleteOwnerName
        ? `Created by ${context.authorName} for ${context.athleteOwnerName}`
        : context.authorName
          ? `Created by ${context.authorName}`
          : "Coach-authored content",
    creatorName: context.authorName,
  };
}

export function presentProgramProvenance(
  program: Pick<
    Program,
    | "sourceType"
    | "athleteId"
    | "ownerName"
    | "createdById"
    | "createdByName"
  >,
  viewerId: string,
) {
  return presentProvenance({
    origin: program.sourceType,
    viewerId,
    athleteOwnerId: program.athleteId,
    athleteOwnerName: program.ownerName,
    authorId: program.createdById,
    authorName: program.createdByName,
  });
}
