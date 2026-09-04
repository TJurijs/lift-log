import { describe, expect, it } from "vitest";

import { IndexedDbActiveWorkoutCache, MemoryActiveWorkoutCache } from "../../lib/active-workout-cache";
import { ActiveWorkoutLocalController } from "../../lib/active-workout-local-controller";

/** Drive the IndexedDB error events that abort all requests in one transaction. */
function failedDatabase() {
  const failure = new DOMException("Device storage unavailable", "UnknownError");
  const requests: EventTarget[] = [];
  const request = () => {
    const value = Object.assign(new EventTarget(), { error: failure });
    requests.push(value);
    return value;
  };
  const store = {
    get: request,
    put: request,
    delete: request,
    index: () => ({ getAll: request, openKeyCursor: request }),
  };
  const transaction = Object.assign(new EventTarget(), {
    error: failure,
    objectStore: () => store,
  });
  const database = { transaction: () => transaction };
  const factory = {
    open: () => {
      const opening = Object.assign(new EventTarget(), { result: database });
      queueMicrotask(() => opening.dispatchEvent(new Event("success")));
      return opening;
    },
  } as unknown as IDBFactory;
  return {
    cache: new IndexedDbActiveWorkoutCache(factory),
    failure,
    async abort() {
      // Let the cache open the database and subscribe to all request events.
      await new Promise((resolve) => setTimeout(resolve, 0));
      requests.forEach((pending) => pending.dispatchEvent(new Event("error")));
      transaction.dispatchEvent(new Event("abort"));
    },
  };
}

describe("IndexedDB transaction failures", () => {
  it.each(["load", "delete-session", "delete-user", "replace"])(
    "returns the %s failure without leaving an unhandled transaction rejection",
    async (operation) => {
      const memory = new MemoryActiveWorkoutCache();
      const controller = new ActiveWorkoutLocalController({ cache: memory, userId: "user", sessionId: "session" });
      await controller.initialize({
        session: { id: "session", workoutId: "workout", programVersionId: "version" },
        serverRevision: 0,
        serverSnapshot: { setLogs: {}, resultLogs: {}, sessionRpe: "", sessionNote: "" },
      });
      const entry = await memory.load("user", "session");
      const { cache, failure, abort } = failedDatabase();
      const pending = operation === "load" ? cache.load("user", "session")
        : operation === "delete-session" ? cache.deleteSession("user", "session")
          : operation === "delete-user" ? cache.deleteUser("user")
            : cache.replace(entry!.record);
      const assertion = expect(pending).rejects.toBe(failure);
      await abort();
      await assertion;
      // Give unobserved completion rejections a turn to reach the test runner.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  );
});
