import { describe, expect, it } from "vitest";

import type { ActiveSession } from "../../lib/domain";
import {
  buildSessionDraftPayload,
  isAmbiguousSessionDraftError,
  LiftLogRepository,
  SessionDraftAmbiguousWriteError,
  SessionRevisionConflictError,
} from "../../lib/repository";

function fixtureSession(): ActiveSession {
  return {
    id: "session-1",
    draftRevision: 3,
    workoutId: "workout-1",
    programVersionId: "version-1",
    itemLogIds: {
      "set-item": "set-log",
      "result-item": "result-log",
      "instructions-item": "instructions-log",
    },
    setLogs: {},
    resultLogs: {},
    sessionRpe: "",
    sessionNote: "",
  };
}

const setLogs = {
  "set-item": [
    { reps: "5", load: "100.5", rpe: "8" },
    { reps: "", load: "not-a-number", rpe: "" },
  ],
};
const resultLogs = {
  "result-item": {
    duration: "1.25",
    distance: "2.5",
    load: "48.5",
    rounds: "4",
    heartRate: "150",
    rpe: "7.5",
  },
};

describe("workout-session draft persistence", () => {
  it("normalizes one complete atomic payload, including session fields", () => {
    expect(
      buildSessionDraftPayload(
        fixtureSession(),
        setLogs,
        resultLogs,
        "8",
        "Felt controlled.",
      ),
    ).toEqual({
      sessionRpe: 8,
      sessionNote: "Felt controlled.",
      items: [
        {
          itemLogId: "set-log",
          entries: [
            {
              position: 0,
              reps: 5,
              loadKg: 100.5,
              durationSeconds: null,
              distanceMetres: null,
              rounds: null,
              heartRate: null,
              rpe: 8,
            },
            {
              position: 1,
              reps: null,
              loadKg: null,
              durationSeconds: null,
              distanceMetres: null,
              rounds: null,
              heartRate: null,
              rpe: null,
            },
          ],
        },
        {
          itemLogId: "result-log",
          entries: [
            {
              position: 0,
              reps: null,
              loadKg: 48.5,
              durationSeconds: 75,
              distanceMetres: 2500,
              rounds: 4,
              heartRate: 150,
              rpe: 7.5,
            },
          ],
        },
        { itemLogId: "instructions-log", entries: [] },
      ],
    });
  });

  it("persists interval rounds as individual ordered entries", () => {
    const session = fixtureSession();
    session.itemLogIds = { "interval-item": "interval-log" };

    expect(
      buildSessionDraftPayload(
        session,
        {},
        {
          "interval-item": {
            "round.0.completed": "1",
            "round.0.duration": "45",
            "round.0.distance": "0.25",
            "round.0.heartRate": "142",
            "round.0.rpe": "6",
            "round.1.distance": "0.27",
            "round.1.duration": "75",
            "round.1.heartRate": "148",
            "round.1.rpe": "7",
          },
        },
        "7",
        "",
      ),
    ).toMatchObject({
      items: [
        {
          itemLogId: "interval-log",
          entries: [
            {
              position: 0,
              durationSeconds: 45,
              distanceMetres: 250,
              rounds: 1,
              heartRate: 142,
              rpe: 6,
            },
            {
              position: 1,
              durationSeconds: 75,
              distanceMetres: 270,
              rounds: null,
              heartRate: 148,
              rpe: 7,
            },
          ],
        },
      ],
    });
  });

  it("fills untouched earlier interval positions to preserve contiguous ordering", () => {
    const session = fixtureSession();
    session.itemLogIds = { "interval-item": "interval-log" };

    const payload = buildSessionDraftPayload(
      session,
      {},
      { "interval-item": { "round.2.rpe": "8" } },
      "7",
      "",
    );

    expect(payload.items[0].entries.map((entry) => entry.position)).toEqual([
      0, 1, 2,
    ]);
  });

  it("sends the expected revision and idempotency token in one RPC", async () => {
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const client = {
      async rpc(name: string, payload: Record<string, unknown>) {
        calls.push({ name, payload });
        return {
          data: { revision: 4, savedAt: "2026-08-24T12:00:00Z" },
          error: null,
        };
      },
    };
    const repository = new LiftLogRepository(
      client as never,
      "athlete-1",
      "Athlete One",
    );

    await expect(
      repository.saveSessionDraft(
        fixtureSession(),
        setLogs,
        resultLogs,
        "8",
        "Felt controlled.",
        3,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      revision: 4,
      savedAt: "2026-08-24T12:00:00Z",
    });

    expect(calls).toEqual([
      {
        name: "save_workout_session_draft",
        payload: {
          target_session_id: "session-1",
          expected_revision: 3,
          write_token: "00000000-0000-4000-8000-000000000001",
          draft_payload: buildSessionDraftPayload(
            fixtureSession(),
            setLogs,
            resultLogs,
            "8",
            "Felt controlled.",
          ),
        },
      },
    ]);
  });

  it("completes only through the revision-confirmed idempotent RPC", async () => {
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const client = {
      async rpc(name: string, payload: Record<string, unknown>) {
        calls.push({ name, payload });
        return { data: "session-1", error: null };
      },
    };
    const repository = new LiftLogRepository(
      client as never,
      "athlete-1",
      "Athlete One",
    );

    await repository.completeSession(
      "session-1",
      "8",
      "Done.",
      4,
      "00000000-0000-4000-8000-000000000002",
    );

    expect(calls).toEqual([
      {
        name: "complete_workout_session_confirmed",
        payload: {
          target_session_id: "session-1",
          expected_revision: 4,
          completion_token: "00000000-0000-4000-8000-000000000002",
          final_rpe: 8,
          final_note: "Done.",
        },
      },
    ]);
  });

  it("classifies interrupted writes separately from deterministic failures", async () => {
    const interruptedRepository = new LiftLogRepository(
      {
        rpc: async () => {
          throw new TypeError("Failed to fetch");
        },
      } as never,
      "athlete-1",
      "Athlete One",
    );

    await expect(
      interruptedRepository.saveSessionDraft(
        fixtureSession(),
        setLogs,
        resultLogs,
        "8",
        "Felt controlled.",
        3,
        "00000000-0000-4000-8000-000000000003",
      ),
    ).rejects.toBeInstanceOf(SessionDraftAmbiguousWriteError);
    expect(
      isAmbiguousSessionDraftError(
        new Error("Could not save workout changes: connection timed out"),
      ),
    ).toBe(true);
    expect(
      isAmbiguousSessionDraftError(
        new Error("Session RPE must be a whole number"),
      ),
    ).toBe(false);
  });

  it("types stale draft and completion revisions for bounded recovery", async () => {
    const repository = new LiftLogRepository(
      {
        rpc: async () => ({
          data: null,
          error: { message: "Workout draft revision is stale" },
        }),
      } as never,
      "athlete-1",
      "Athlete One",
    );

    await expect(
      repository.saveSessionDraft(
        fixtureSession(),
        setLogs,
        resultLogs,
        "8",
        "Felt controlled.",
        3,
        "00000000-0000-4000-8000-000000000004",
      ),
    ).rejects.toBeInstanceOf(SessionRevisionConflictError);
    await expect(
      repository.completeSession(
        "session-1",
        "8",
        "Felt controlled.",
        3,
        "00000000-0000-4000-8000-000000000005",
      ),
    ).rejects.toBeInstanceOf(SessionRevisionConflictError);
  });
});
