import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTelemetry } from '../scripts/lib/telemetry-diagnostics.mjs';

test('diagnostics separate error counts from measured outcome failure rates', () => {
  const [release] = evaluateTelemetry([{ release_sha: 'abc1234', error_events: '11', fatal_errors: '0',
    operation_samples: '100', operation_failures: '6' }]);
  assert.equal(release.measured_operation_failure_rate, 0.06);
  assert.deepEqual(release.alerts, ['error-event-count', 'measured-operation-failure-rate']);
});
test('low sample sizes cannot claim an operation rate alert; fatal events still alert', () => {
  const [release] = evaluateTelemetry([{ error_events: 1, fatal_errors: 1, operation_samples: 1, operation_failures: 1 }]);
  assert.equal(release.sufficient_operation_samples, false);
  assert.deepEqual(release.alerts, ['fatal-error']);
  const [empty] = evaluateTelemetry([{ error_events: 0, fatal_errors: 0, operation_samples: 0, operation_failures: 0 }]);
  assert.equal(empty.measured_operation_failure_rate, null);
  assert.deepEqual(empty.alerts, []);
});
test('invalid diagnostic thresholds fail instead of disabling alerts silently', () => {
  assert.throws(() => evaluateTelemetry([], { maxErrorEvents: -1 }));
  assert.throws(() => evaluateTelemetry([], { maxFailureRate: 2 }));
  assert.throws(() => evaluateTelemetry([], { minOperationSamples: 0 }));
});
