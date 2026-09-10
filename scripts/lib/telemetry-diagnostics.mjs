export function evaluateTelemetry(rows, { maxErrorEvents = 10, maxFailureRate = 0.05, minOperationSamples = 20 } = {}) {
  if (!Number.isInteger(maxErrorEvents) || maxErrorEvents < 1 || maxErrorEvents > 1000000
    || !Number.isFinite(maxFailureRate) || maxFailureRate < 0 || maxFailureRate > 1
    || !Number.isInteger(minOperationSamples) || minOperationSamples < 1) throw new Error('Invalid telemetry alert thresholds.');
  return rows.map((row) => {
    const errors = Number(row.error_events);
    const samples = Number(row.operation_samples);
    const failures = Number(row.operation_failures);
    const failureRate = samples ? failures / samples : null;
    const alerts = [];
    if (errors >= maxErrorEvents) alerts.push('error-event-count');
    if (Number(row.fatal_errors) > 0) alerts.push('fatal-error');
    if (samples >= minOperationSamples && failureRate > maxFailureRate) alerts.push('measured-operation-failure-rate');
    return { ...row, error_events: errors, fatal_errors: Number(row.fatal_errors), operation_samples: samples,
      operation_failures: failures, measured_operation_failure_rate: failureRate,
      sufficient_operation_samples: samples >= minOperationSamples, alerts };
  });
}
