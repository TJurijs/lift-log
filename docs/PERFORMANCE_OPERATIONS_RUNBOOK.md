# Performance and operations runbook

This runbook defines the v1 capacity guardrails. All load generation is offline or targets an isolated local Supabase stack unless an operator explicitly authorizes the audited nonprod project. Never run fixtures, write traffic, or load tests against production.

## Fixed environment bindings

| Mode | Site origin | Supabase origin | Test personas |
| --- | --- | --- | --- |
| `localdev` | loopback HTTP | different loopback HTTP port | allowed |
| `nonprod` | `https://dev.liftlog.cc` | `https://ofyeejyfroblunbspgve.supabase.co` | allowed |
| `production` | `https://app.liftlog.cc` | `https://awdgjgziyrqdkybmlime.supabase.co` | forbidden |

`scripts/validate-build-env.mjs` enforces the exact hosted origins, origin-only URLs, a public browser key, and a valid release SHA. It rejects secret/service-role credentials before Vite can bundle them. The ordinary CI job builds static assets without contacting Supabase. A separate job starts disposable loopback Supabase, and every database runner in that job independently rejects non-loopback targets.

## Reproducible scale specification

`npm run perf:fixture` prints a deterministic manifest and `npm run perf:fixture:report` writes the CI artifact. Use `node scripts/generate-scale-fixture.mjs --format=ndjson --output=<path>` to stream records without holding the full dataset in memory.

| Scenario | Shape | Contract rows |
| --- | --- | ---: |
| `program-40` | One ordered sequence, 40 workouts, four groups each, nested items/prescriptions | 1,484 |
| `program-208-stress` | One ordered stress sequence, 208 workouts with four groups each | 7,700 |
| `coach-50x150` | 50 athletes × 150 completed trainings | 255,101 |
| `exercise-5000` | 5,000 exercises | 5,000 |

The generator is deliberately not a database seeder. Its stable UUIDs, dates, row counts, and digest form an adapter contract for a future local-only seeder. Any adapter must reject non-loopback targets by default, use a unique namespace, and provide an explicit cleanup command.

## Measurable budgets

Budgets live in `performance/budgets.json` and are evaluated by code rather than copied into CI YAML.

| Surface | Budget |
| --- | --- |
| Initial JavaScript | ≤460,000 raw / ≤130,000 gzip bytes |
| Largest lazy JavaScript chunk | ≤180,000 raw / ≤45,000 gzip bytes |
| All JavaScript cached by the app shell | ≤810,000 raw / ≤225,000 gzip bytes |
| CSS | ≤120,000 raw / ≤22,000 gzip bytes |
| Bootstrap | ≤6 Data API requests, ≤2,500 ms, ≤250 visible rows |
| Warm navigation/detail | ≤2 Data API requests p95, ≤500 ms p95, ≤250 visible rows |
| Responsiveness | navigation p95 ≤3 long tasks and ≤200 ms total; interaction p75 ≤200 ms when supported |

Commands:

```bash
npm run build:prod
npm run perf:bundle:report
npm run perf:bundle:check
npm run ci:local-supabase
npm run seed:test-population:local
npm run build:local
npm run perf:measure:local
npm run perf:runtime:report
npm run perf:runtime:check
```

Aggregate lazy bytes are still reported for capacity planning, but the route
gate applies to the largest individual lazy chunk. That keeps the budget tied
to what one navigation loads instead of penalizing useful feature splitting.

The browser harness accepts only a loopback app, blocks service workers, aborts writes, blocks production/unknown Supabase origins, and waits on `aria-current`/`aria-selected` state. It performs one unreported warm-up for each target before collecting the configured warm iterations, then measures bounded navigation plus representative program, scheduled-workout, and coach-athlete detail reads. `hosted-dev` is an explicit alternative to `local`; production is not an option. CI supplies the local Vite binding through guarded process variables, while developer runs may use `.env.localdev`. Interaction timing may be absent on browsers without the Event Timing observer, so CI reports it but gates it only after availability is established.

The `local-supabase` CI job resets and lints the disposable database, runs the integration suite and V1 rollback smoke, captures the 40-workout sequence plus 50-athlete/150-session scale plans, seeds the local browser personas, then gates the read-only runtime report. Its local password is fixture-only and has no meaning outside the ephemeral CI stack.

## Staged capacity exercise

1. Run CI and the offline manifest; archive the fixture digest, bundle report, commit SHA, browser version, and machine profile.
2. On disposable local Supabase, exercise 1 athlete and the 40-workout program sequence. Establish bootstrap/navigation/detail request counts and query timings.
3. Repeat at 5 and 10 concurrently active athletes. Run navigation and detail reads for 15 minutes, then verify errors, connections, locks, and memory return to baseline.
4. Repeat at 25 and 50 active athletes with 150 trainings each and the 5,000-exercise library. Use a 30–60 minute read soak and record p50/p95/p99; do write/clone scenarios only on disposable local data.
5. Stress one 208-workout program sequence: open, navigate, schedule, and clone sequentially. Assert request counts remain O(1) per screen; separately time the local write transaction and cleanup.
6. Only after local pass, run the read-only browser harness against the exact nonprod project during a declared window. Stop on alert thresholds, unexpected write attempts, or any production/unknown request.

Increase one dimension per stage and keep the preceding result as the comparison baseline. A regression is actionable even when it remains below a generous hard limit.

## Telemetry contract

`lib/telemetry.ts` provides a sink-agnostic collector. Events contain schema version, release SHA, environment, allowlisted metric/category, bounded counts/timings, and coarse role/cardinality buckets. They never contain names, email addresses, account/session/program identifiers, URLs, free-form messages, stacks, request bodies, or arbitrary custom fields. Sink failure is swallowed so observability cannot break the user path. Connecting a vendor sink requires a separate privacy and retention review.

## Dashboard and alerts

Create alerts only after collecting a representative baseline; start with these conservative signals:

| Signal | Warning | Critical/action |
| --- | --- | --- |
| API 5xx | >1% for 5 min | >5% for 5 min; halt rollout |
| API 429 | any sustained 5 min | >1% for 5 min; reduce concurrency/check limits |
| Bootstrap p95 | >2.5 s for 10 min | >5 s or budget doubles; roll back frontend if release-correlated |
| Warm navigation p95 | >500 ms for 10 min | >1 s; inspect request fan-out/query plans |
| Database CPU | >70% for 15 min | >85% for 10 min; stop load/increase capacity |
| Memory | >80% for 15 min | >90% or sustained swap/OOM risk |
| Connections | >70% of limit | >85%; stop load and inspect leaks/pooling |
| Lock waits/query timeouts | any sustained increase | user-visible errors or >1% operations |
| Disk/WAL | >70% capacity or abnormal growth | >85%; stop write tests and retain recovery headroom |

Also track auth failures, RLS denials, RPC latency, slow-query p95/p99, browser error rate, request count per screen, long tasks, and release SHA. Alerts must aggregate by coarse operation/environment—not user identity.

## Release, rollback, and recovery

Before promotion: require both `verify` and `local-supabase` CI jobs to pass; retain reports; confirm the release meta tag matches the commit; scan the built bundle for the opposite project ref and forbidden credential markers; then smoke-test sign-in/out, bootstrap, one detail, and one safe write in the target environment.

Static rollback is the existing atomic `current` symlink switch. It does not roll back schema or data. Database changes are forward-only: take/verify the provider backup or PITR capability before migration, rehearse restoration in a separate project, record restore objectives, and keep a tested compensating migration. During an incident stop load generators, preserve logs and release SHA, roll back the static release when correlated, and escalate database recovery rather than improvising destructive SQL.
