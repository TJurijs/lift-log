import { describe, expect, it } from "vitest";

import {
  presentProgramProvenance,
  presentProvenance,
  type ProvenanceContext,
} from "../../lib/provenance";

const athleteId = "athlete";
const coachId = "coach";
const otherCoachId = "other-coach";

function provenanceContext(
  overrides: Partial<ProvenanceContext> = {},
): ProvenanceContext {
  return {
    origin: "self",
    viewerId: athleteId,
    athleteOwnerId: athleteId,
    athleteOwnerName: "Ada Athlete",
    authorId: athleteId,
    authorName: "Ada Athlete",
    ...overrides,
  };
}

describe("presentProvenance", () => {
  it("keeps missing provenance unknown instead of defaulting it to Library", () => {
    const presentation = presentProvenance(
      provenanceContext({ origin: undefined }),
    );

    expect(presentation).toEqual({
      origin: "unknown",
      tone: "neutral",
      label: "Source unavailable",
      title: "Content provenance is unavailable",
    });
    expect(presentation.origin).not.toBe("library");
    expect(presentation.label).not.toBe("Library");
  });

  it.each([athleteId, coachId, otherCoachId])(
    "presents Library factually for viewer %s",
    (viewerId) => {
      expect(
        presentProvenance(
          provenanceContext({
            origin: "library",
            viewerId,
            authorId: undefined,
            authorName: undefined,
          }),
        ),
      ).toEqual({
        origin: "library",
        tone: "library",
        label: "Library",
        title: "Lift Log library",
      });
    },
  );

  describe("athlete-authored provenance", () => {
    it("labels the authoring viewer's content as Own", () => {
      expect(presentProvenance(provenanceContext())).toEqual({
        origin: "self",
        tone: "self",
        label: "Own",
        title: "Created by you",
        creatorName: "Ada Athlete",
      });
    });

    it("labels the same content as athlete-authored for another viewer", () => {
      expect(
        presentProvenance(
          provenanceContext({ viewerId: coachId }),
        ),
      ).toEqual({
        origin: "self",
        tone: "self",
        label: "Athlete · Ada Athlete",
        title: "Created by Ada Athlete",
        creatorName: "Ada Athlete",
      });
    });

    it("falls back to the athlete's name without inventing a named author", () => {
      expect(
        presentProvenance(
          provenanceContext({
            viewerId: coachId,
            authorId: undefined,
            authorName: undefined,
          }),
        ),
      ).toEqual({
        origin: "self",
        tone: "self",
        label: "Athlete · Ada Athlete",
        title: "Created by the athlete",
        creatorName: "Ada Athlete",
      });
    });

    it("uses a neutral athlete label when both names are unavailable", () => {
      expect(
        presentProvenance(
          provenanceContext({
            viewerId: coachId,
            athleteOwnerName: undefined,
            authorId: undefined,
            authorName: undefined,
          }),
        ),
      ).toEqual({
        origin: "self",
        tone: "self",
        label: "Athlete",
        title: "Created by the athlete",
        creatorName: undefined,
      });
    });
  });

  describe("coach-assigned provenance", () => {
    const assignedFacts: Partial<ProvenanceContext> = {
      origin: "coach",
      athleteOwnerId: athleteId,
      athleteOwnerName: "Ada Athlete",
      authorId: coachId,
      authorName: "Casey Coach",
    };

    it("uses author-relative copy for the authoring coach", () => {
      expect(
        presentProvenance(
          provenanceContext({ ...assignedFacts, viewerId: coachId }),
        ),
      ).toEqual({
        origin: "coach",
        tone: "coach",
        label: "Coach · You",
        title: "Assigned by you",
        creatorName: "Casey Coach",
      });
    });

    it("uses athlete-relative coach copy for the athlete owner", () => {
      expect(
        presentProvenance(
          provenanceContext({ ...assignedFacts, viewerId: athleteId }),
        ),
      ).toEqual({
        origin: "coach",
        tone: "coach",
        label: "Coach · Casey Coach",
        title: "Created by your coach, Casey Coach",
        creatorName: "Casey Coach",
      });
    });

    it("keeps athlete-relative copy accurate when the coach name is unavailable", () => {
      expect(
        presentProvenance(
          provenanceContext({
            ...assignedFacts,
            viewerId: athleteId,
            authorName: undefined,
          }),
        ),
      ).toEqual({
        origin: "coach",
        tone: "coach",
        label: "Coach",
        title: "Created by your coach",
        creatorName: undefined,
      });
    });

    it("names both author and athlete for another coach", () => {
      expect(
        presentProvenance(
          provenanceContext({ ...assignedFacts, viewerId: otherCoachId }),
        ),
      ).toEqual({
        origin: "coach",
        tone: "coach",
        label: "Coach · Casey Coach",
        title: "Created by Casey Coach for Ada Athlete",
        creatorName: "Casey Coach",
      });
    });

    it("uses the author without claiming an athlete name when owner copy is unavailable", () => {
      expect(
        presentProvenance(
          provenanceContext({
            ...assignedFacts,
            viewerId: otherCoachId,
            athleteOwnerName: undefined,
          }),
        ),
      ).toEqual({
        origin: "coach",
        tone: "coach",
        label: "Coach · Casey Coach",
        title: "Created by Casey Coach",
        creatorName: "Casey Coach",
      });
    });

    it("does not invent an author when coach provenance has no author facts", () => {
      expect(
        presentProvenance(
          provenanceContext({
            ...assignedFacts,
            viewerId: otherCoachId,
            authorId: undefined,
            authorName: undefined,
          }),
        ),
      ).toEqual({
        origin: "coach",
        tone: "coach",
        label: "Coach",
        title: "Coach-authored content",
        creatorName: undefined,
      });
    });

    it("prioritizes author-relative copy when one viewer is both author and owner", () => {
      expect(
        presentProvenance(
          provenanceContext({
            ...assignedFacts,
            viewerId: coachId,
            athleteOwnerId: coachId,
          }),
        ).title,
      ).toBe("Assigned by you");
    });
  });

  it("produces different viewer-relative labels from the same coach-assignment facts", () => {
    const facts = {
      origin: "coach" as const,
      athleteOwnerId: athleteId,
      athleteOwnerName: "Ada Athlete",
      authorId: coachId,
      authorName: "Casey Coach",
    };

    expect(
      [athleteId, coachId, otherCoachId].map(
        (viewerId) => presentProvenance({ ...facts, viewerId }).label,
      ),
    ).toEqual([
      "Coach · Casey Coach",
      "Coach · You",
      "Coach · Casey Coach",
    ]);
  });
});

describe("presentProgramProvenance", () => {
  it("adapts factual program fields to viewer-relative provenance", () => {
    const facts = {
      sourceType: "coach" as const,
      athleteId: "athlete-1",
      ownerName: "Athlete",
      createdById: "coach-1",
      createdByName: "Coach",
    };

    expect(presentProgramProvenance(facts, "coach-1").label).toBe(
      "Coach · You",
    );
    expect(presentProgramProvenance(facts, "athlete-1").label).toBe(
      "Coach · Coach",
    );
  });
});
