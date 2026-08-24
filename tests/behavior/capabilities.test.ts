import { describe, expect, it } from "vitest";

import {
  CapabilityDeniedError,
  deriveOccurrenceCapabilities,
  deriveTrainingContentCapabilities,
  requireCapability,
  type OccurrenceCapabilities,
  type TrainingContentCapabilities,
  type TrainingContentPolicyInput,
} from "../../lib/capabilities";

const athleteId = "athlete";
const coachId = "authoring-coach";
const otherCoachId = "other-coach";
const strangerId = "stranger";

function contentInput(
  overrides: Partial<TrainingContentPolicyInput> = {},
): TrainingContentPolicyInput {
  return {
    viewerId: athleteId,
    athleteOwnerId: athleteId,
    authorId: athleteId,
    source: "self",
    contentType: "program",
    lifecycle: "published",
    available: false,
    activeCoachOfOwner: false,
    hasAssignableAthletes: false,
    coachReadScope: "authored_only",
    ...overrides,
  };
}

function expectNoContentCapabilities(
  capabilities: TrainingContentCapabilities,
) {
  expect(capabilities).toEqual({
    view: false,
    copyToOwn: false,
    edit: false,
    publish: false,
    schedule: false,
    assign: false,
    provideInitialAssignmentDate: false,
    deleteOwn: false,
    archiveInstance: false,
  });
}

describe("deriveTrainingContentCapabilities", () => {
  describe("library content", () => {
    it.each([
      ["draft", false],
      ["published", true],
      ["superseded", false],
    ] as const)(
      "keeps %s content readable but only allows published content to be copied",
      (lifecycle, copyToOwn) => {
        const capabilities = deriveTrainingContentCapabilities(
          contentInput({
            viewerId: strangerId,
            athleteOwnerId: athleteId,
            authorId: undefined,
            source: "library",
            lifecycle,
          }),
        );

        expect(capabilities).toMatchObject({
          view: true,
          copyToOwn,
          edit: false,
          publish: false,
          schedule: false,
          assign: false,
          deleteOwn: false,
          archiveInstance: false,
        });
      },
    );

    it("keeps published Library content copy-only", () => {
      expect(
        deriveTrainingContentCapabilities(
          contentInput({
            source: "library",
            authorId: undefined,
          }),
        ),
      ).toEqual({
        view: true,
        copyToOwn: true,
        edit: false,
        publish: false,
        schedule: false,
        assign: false,
        provideInitialAssignmentDate: false,
        deleteOwn: false,
        archiveInstance: true,
      });
    });
  });

  describe("athlete-authored Own content", () => {
    it.each([
      [
        "draft",
        {
          edit: true,
          publish: true,
          schedule: false,
          assign: false,
        },
      ],
      [
        "published",
        {
          edit: true,
          publish: false,
          schedule: true,
          assign: true,
        },
      ],
      [
        "superseded",
        {
          edit: false,
          publish: false,
          schedule: false,
          assign: false,
        },
      ],
    ] as const)("applies the %s lifecycle guards", (lifecycle, expected) => {
      const capabilities = deriveTrainingContentCapabilities(
        contentInput({
          lifecycle,
          available: true,
          hasAssignableAthletes: true,
        }),
      );

      expect(capabilities).toMatchObject({
        view: true,
        copyToOwn: false,
        deleteOwn: true,
        archiveInstance: false,
        ...expected,
      });
    });

    it("does not grant authoring capabilities when Own ownership and authorship disagree", () => {
      const capabilities = deriveTrainingContentCapabilities(
        contentInput({ authorId: coachId, available: true }),
      );

      expect(capabilities).toMatchObject({
        view: true,
        edit: false,
        publish: false,
        schedule: true,
        assign: false,
        deleteOwn: false,
      });
    });

    it("requires an assignable athlete and a published source before assignment", () => {
      const withoutTarget = deriveTrainingContentCapabilities(contentInput());
      const withTarget = deriveTrainingContentCapabilities(
        contentInput({ hasAssignableAthletes: true }),
      );
      const draftWithTarget = deriveTrainingContentCapabilities(
        contentInput({
          lifecycle: "draft",
          hasAssignableAthletes: true,
        }),
      );

      expect(withoutTarget.assign).toBe(false);
      expect(withTarget.assign).toBe(true);
      expect(draftWithTarget.assign).toBe(false);
    });

    it("limits the initial-date exception to assignable quick workouts", () => {
      const program = deriveTrainingContentCapabilities(
        contentInput({ hasAssignableAthletes: true, contentType: "program" }),
      );
      const quickWorkout = deriveTrainingContentCapabilities(
        contentInput({
          hasAssignableAthletes: true,
          contentType: "quick_workout",
        }),
      );

      expect(program).toMatchObject({
        assign: true,
        provideInitialAssignmentDate: false,
      });
      expect(quickWorkout).toMatchObject({
        assign: true,
        provideInitialAssignmentDate: true,
      });
    });
  });

  describe("coach-assigned athlete-owned content", () => {
    it.each([
      ["draft", false],
      ["published", true],
      ["superseded", false],
    ] as const)(
      "applies %s lifecycle guards to the athlete-owned copy",
      (lifecycle, published) => {
        expect(
          deriveTrainingContentCapabilities(
            contentInput({
              authorId: coachId,
              source: "coach",
              lifecycle,
              available: true,
            }),
          ),
        ).toEqual({
          view: true,
          copyToOwn: published,
          edit: false,
          publish: false,
          schedule: published,
          assign: false,
          provideInitialAssignmentDate: false,
          deleteOwn: false,
          archiveInstance: true,
        });
      },
    );

    it.each([
      ["draft", true, true],
      ["published", true, false],
      ["superseded", false, false],
    ] as const)(
      "lets the active authoring coach handle a %s version according to lifecycle",
      (lifecycle, edit, publish) => {
        const capabilities = deriveTrainingContentCapabilities(
          contentInput({
            viewerId: coachId,
            authorId: coachId,
            source: "coach",
            lifecycle,
            activeCoachOfOwner: true,
            coachReadScope: "authored_only",
          }),
        );

        expect(capabilities).toMatchObject({
          view: true,
          copyToOwn: false,
          edit,
          publish,
          schedule: false,
          assign: false,
          deleteOwn: false,
          archiveInstance: false,
        });
      },
    );

    it("revokes even the original author's access when the coaching relationship ends", () => {
      expectNoContentCapabilities(
        deriveTrainingContentCapabilities(
          contentInput({
            viewerId: coachId,
            authorId: coachId,
            source: "coach",
            lifecycle: "draft",
            activeCoachOfOwner: false,
            coachReadScope: "authored_only",
          }),
        ),
      );
    });
  });

  describe("author-scoped coach reads", () => {
    it("denies another active coach access to content they did not author", () => {
      expectNoContentCapabilities(
        deriveTrainingContentCapabilities(
          contentInput({
            viewerId: otherCoachId,
            authorId: coachId,
            source: "coach",
            activeCoachOfOwner: true,
          }),
        ),
      );
    });

    it("allows authored-only access to content authored by the active coach", () => {
      expect(
        deriveTrainingContentCapabilities(
          contentInput({
            viewerId: coachId,
            authorId: coachId,
            source: "coach",
            activeCoachOfOwner: true,
            coachReadScope: "authored_only",
          }),
        ).view,
      ).toBe(true);
    });

    it("does not expose athlete-authored Own content to an active coach", () => {
      expectNoContentCapabilities(
        deriveTrainingContentCapabilities(
          contentInput({
            viewerId: otherCoachId,
            authorId: athleteId,
            source: "self",
            available: true,
            activeCoachOfOwner: true,
          }),
        ),
      );
    });
  });

  it("denies every capability for archived content", () => {
    expectNoContentCapabilities(
      deriveTrainingContentCapabilities(
        contentInput({
          archived: true,
          available: true,
          hasAssignableAthletes: true,
        }),
      ),
    );
  });

  it.each(["self", "coach"] as const)(
    "denies every capability to an unrelated viewer of %s content",
    (source) => {
      expectNoContentCapabilities(
        deriveTrainingContentCapabilities(
          contentInput({
            viewerId: strangerId,
            authorId: source === "self" ? athleteId : coachId,
            source,
            activeCoachOfOwner: false,
          }),
        ),
      );
    },
  );
});

describe("deriveOccurrenceCapabilities", () => {
  it.each([
    [
      "planned",
      {
        startOrResume: true,
        reschedule: true,
        skip: true,
        restore: false,
        resetToPlanned: false,
        remove: true,
        editResult: false,
        finish: false,
      },
    ],
    [
      "in_progress",
      {
        startOrResume: true,
        reschedule: false,
        skip: true,
        restore: false,
        resetToPlanned: true,
        remove: false,
        editResult: true,
        finish: true,
      },
    ],
    [
      "completed",
      {
        startOrResume: false,
        reschedule: false,
        skip: false,
        restore: false,
        resetToPlanned: false,
        remove: false,
        editResult: false,
        finish: false,
      },
    ],
    [
      "skipped",
      {
        startOrResume: false,
        reschedule: false,
        skip: false,
        restore: true,
        resetToPlanned: false,
        remove: true,
        editResult: false,
        finish: false,
      },
    ],
  ] as const)("applies athlete transitions for %s occurrences", (status, expected) => {
    expect(
      deriveOccurrenceCapabilities({
        viewerId: athleteId,
        athleteOwnerId: athleteId,
        status,
        activeCoachOfOwner: false,
      }),
    ).toEqual({ view: true, ...expected });
  });

  it.each(["planned", "in_progress", "completed", "skipped"] as const)(
    "gives the active authoring coach read-only access to %s occurrences",
    (status) => {
      expect(
        deriveOccurrenceCapabilities({
          viewerId: coachId,
          athleteOwnerId: athleteId,
          programAuthorId: coachId,
          status,
          activeCoachOfOwner: true,
        }),
      ).toEqual({
        view: true,
        startOrResume: false,
        reschedule: false,
        skip: false,
        restore: false,
        resetToPlanned: false,
        remove: false,
        editResult: false,
        finish: false,
      });
    },
  );

  it.each(["planned", "in_progress", "completed", "skipped"] as const)(
    "denies another active coach access to %s occurrences",
    (status) => {
      expect(
        deriveOccurrenceCapabilities({
          viewerId: otherCoachId,
          athleteOwnerId: athleteId,
          programAuthorId: coachId,
          status,
          activeCoachOfOwner: true,
        }),
      ).toEqual({
        view: false,
        startOrResume: false,
        reschedule: false,
        skip: false,
        restore: false,
        resetToPlanned: false,
        remove: false,
        editResult: false,
        finish: false,
      });
    },
  );

  it("revokes occurrence access from its author when the relationship ends", () => {
    expect(
      deriveOccurrenceCapabilities({
        viewerId: coachId,
        athleteOwnerId: athleteId,
        programAuthorId: coachId,
        status: "completed",
        activeCoachOfOwner: false,
      }).view,
    ).toBe(false);
  });

  it.each(["planned", "in_progress", "completed", "skipped"] as const)(
    "denies an unrelated viewer access to %s occurrences",
    (status) => {
      expect(
        deriveOccurrenceCapabilities({
          viewerId: strangerId,
          athleteOwnerId: athleteId,
          status,
          activeCoachOfOwner: false,
        }),
      ).toEqual({
        view: false,
        startOrResume: false,
        reschedule: false,
        skip: false,
        restore: false,
        resetToPlanned: false,
        remove: false,
        editResult: false,
        finish: false,
      });
    },
  );
});

describe("requireCapability", () => {
  it("returns normally for an allowed capability", () => {
    const capabilities: Pick<OccurrenceCapabilities, "view"> = { view: true };

    expect(() => requireCapability(capabilities, "view")).not.toThrow();
  });

  it("throws a typed error carrying the denied capability", () => {
    const capabilities: Pick<TrainingContentCapabilities, "publish"> = {
      publish: false,
    };

    try {
      requireCapability(capabilities, "publish");
      throw new Error("Expected requireCapability to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityDeniedError);
      expect(error).toMatchObject({
        name: "CapabilityDeniedError",
        message: "Capability denied: publish",
        capability: "publish",
      });
    }
  });
});
