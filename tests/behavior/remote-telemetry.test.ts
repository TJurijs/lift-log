import { afterEach, expect, it, vi } from "vitest";
import { installRemoteTelemetry } from "../../lib/remote-telemetry";

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.useRealTimers(); vi.restoreAllMocks(); });
function emit(extra = {}) {
  window.dispatchEvent(new CustomEvent("liftlog:telemetry", { detail: {
    schemaVersion: 1, releaseSha: "abcdef1", environment: "test", recordedAt: new Date().toISOString(),
    kind: "performance", payload: { name: "navigation", durationMs: 20, athleteName: "private name" },
    sessionId: "private-id", ...extra,
  } }));
}
it("sends bounded batches and excludes names, identifiers and unexpected fields", async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockResolvedValue({ accepted: 10 });
  disposers.push(installRemoteTelemetry(send));
  for (let index = 0; index < 100; index++) emit();
  emit({ payload: { name: "save", durationMs: 10, outcome: "failure", privateNote: "private" } });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toHaveLength(10);
  expect(JSON.stringify(send.mock.calls)).not.toMatch(/private|athleteName|sessionId/);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0]).toContainEqual(expect.objectContaining({
    payload: { name: "save", durationMs: 10, outcome: "failure" },
  }));
  expect(JSON.stringify(send.mock.calls)).not.toContain("private");
});
it("drops queued diagnostics on sign-out instead of attributing them to the next account", async () => {
  vi.useFakeTimers();
  const oldAccount = vi.fn();
  const stop = installRemoteTelemetry(oldAccount);
  emit(); stop();
  const nextAccount = vi.fn();
  disposers.push(installRemoteTelemetry(nextAccount));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(oldAccount).not.toHaveBeenCalled();
  expect(nextAccount).not.toHaveBeenCalled();
});
it("does not retry failures or send invalid payloads", async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockRejectedValue(new Error("offline"));
  disposers.push(installRemoteTelemetry(send));
  emit({ payload: { name: "secret free text", durationMs: 1 } });
  emit();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toHaveLength(1);
});
