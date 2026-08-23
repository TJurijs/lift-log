export const slowOperationThresholdMs = 2_500;

type PerformanceAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Records browser-native performance data without requiring a third-party SDK.
 * A future RUM integration can listen for `liftlog:performance` events.
 */
export function recordClientPerformance(
  name: string,
  startedAt: number,
  attributes: PerformanceAttributes = {},
) {
  const durationMs = Math.round(performance.now() - startedAt);
  try {
    performance.measure(name, { start: startedAt, duration: durationMs });
  } catch {
    // Performance APIs are optional and must never affect the product flow.
  }

  const detail = { name, durationMs, ...attributes };
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("liftlog:performance", { detail }),
    );
  }
  if (durationMs >= slowOperationThresholdMs) {
    console.warn("[LiftLog] Slow operation", detail);
  }
  return detail;
}
