import { describe, expect, it, vi } from "vitest";

import {
  browserTelemetryStorageKey,
  createBrowserTelemetrySink,
  createTelemetryCollector,
  installBrowserTelemetry,
  type TelemetryEnvelope,
} from "../../lib/telemetry";

describe("privacy-safe telemetry", () => {
  it("emits an allowlisted envelope with the release SHA", () => {
    const events: TelemetryEnvelope[] = [];
    const collector = createTelemetryCollector({
      sink: { capture: (event) => { events.push(event); } },
      releaseSha: "abcdef1234567",
      environment: "production",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    collector.performance({ name: "navigation", durationMs: 42.126, requestCount: 2 });
    expect(events).toEqual([{
      schemaVersion: 1,
      releaseSha: "abcdef1234567",
      environment: "production",
      recordedAt: "2026-01-01T00:00:00.000Z",
      kind: "performance",
      payload: { name: "navigation", durationMs: 42.13, requestCount: 2 },
    }]);
  });

  it("drops arbitrary browser detail and never forwards error text", () => {
    const events: TelemetryEnvelope[] = [];
    const collector = createTelemetryCollector({ sink: { capture: (event) => { events.push(event); } } });
    const uninstall = installBrowserTelemetry(collector);
    window.dispatchEvent(new CustomEvent("liftlog:performance", { detail: {
      name: "navigation", durationMs: 10, athleteName: "Private Name", id: "private-uuid", message: "private",
    } }));
    window.dispatchEvent(new ErrorEvent("error", { message: "Private Name private-uuid" }));
    uninstall();
    expect(JSON.stringify(events)).not.toMatch(/Private Name|private-uuid|message/u);
    expect(events).toHaveLength(2);
  });

  it("does not let a telemetry sink fail the product path", () => {
    const collector = createTelemetryCollector({ sink: { capture: vi.fn(() => { throw new Error("down"); }) } });
    expect(() => collector.error({ category: "network", operation: "bootstrap", fatal: false, retryable: true })).not.toThrow();
  });

  it("keeps a bounded browser-session trail and emits an adapter event", () => {
    sessionStorage.clear();
    const received = vi.fn();
    window.addEventListener("liftlog:telemetry", received, { once: true });
    const sink = createBrowserTelemetrySink(sessionStorage);
    const collector = createTelemetryCollector({
      sink,
      releaseSha: "development",
      environment: "development",
    });

    collector.performance({ name: "bootstrap", durationMs: 25, retries: 1 });

    const stored = JSON.parse(
      sessionStorage.getItem(browserTelemetryStorageKey) ?? "[]",
    ) as TelemetryEnvelope[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.payload).toMatchObject({
      name: "bootstrap",
      durationMs: 25,
      retries: 1,
    });
    expect(received).toHaveBeenCalledOnce();
  });
});
