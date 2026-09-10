# Database migrations, promotion and effective contract

Use forward migrations for schema and application contracts. Applied historical
SQL files are immutable. New SQL must include server authorization, explicit
privileges and database tests for its observable behavior.

## Portable promotion

Eleven historical migrations contain one-time changes to the original developer's
personal workouts. They are listed, explained and SHA-256 pinned in
`supabase/operational-migrations.json`. They include the September 3 cleanup that
requires exact development UUIDs, plus earlier personal workout rewrites selected
by titles and current dates. They must never run against another environment's
users. They do not define application schema or shared catalog entries.

`scripts/promote-database.mjs` reads normal Supabase migration history. Already
applied history is preserved. It applies pending schema migrations and records
pending registered operations as deliberately skipped, with the original file
hash and explanation in `supabase_migrations.liftlog_migration_receipts`. SQL and
its receipt commit in one transaction; a session advisory lock serializes the
whole promotion. Normal Supabase tools recognize the resulting migration history.

The runner refuses unknown target-history versions, modified receipt hashes,
modified/missing registered operational files, missing skip prerequisites and an
existing Lift Log schema with no migration history. It never guesses or repairs a
baseline. Stop and restore/inspect a damaged baseline separately. No applied
historical file is rewritten, and no `migration repair` is needed for normal use.

Start with a read-only plan against the existing local stack:

```sh
node scripts/promote-database.mjs
node scripts/promote-database.mjs --apply --acknowledge-operational-skips
```

`--acknowledge-operational-skips` is required only when the printed plan includes
pending historical operations. Local defaults to PostgreSQL on
`127.0.0.1:54322/postgres`. `--through=YYYYMMDDNNNN` can stop at an existing
migration version for a staged compatibility rehearsal.

For hosted promotion, supply the database connection through the process
environment `LIFTLOG_MIGRATION_DATABASE_URL`; never put the password in command
arguments, Vite variables or source control. Select the exact target explicitly:

```sh
node scripts/promote-database.mjs --target=nonprod --project-ref=ofyeejyfroblunbspgve
node scripts/promote-database.mjs --target=production --project-ref=awdgjgziyrqdkybmlime
```

After reviewing the plan, backup/restore evidence and deployment authorization,
repeat that exact command with `--apply --acknowledge-operational-skips`.
Connections must address the chosen project's direct database hostname, or its
session pooler on port 5432 with the matching `postgres.<project-ref>` username.
TLS is required. Transaction poolers and mismatched projects are rejected. The
runner reloads PostgREST's schema cache after a successful apply.

Do not use a raw `supabase db push` to promote an environment with pending
registered personal-data operations. A raw local `db reset` remains suitable for
the disposable empty fixture database, but the portable runner and rehearsal are
the path for promotion over existing accounts.

## Rehearsal without resetting the developer database

```sh
node tests/run-portable-migration-smoke.mjs
```

This command requires the running local Supabase stack and Docker. It creates a
uniquely named `liftlog_migration_review_*` database, copies only the real local
Auth schema (no accounts or secrets), adds a synthetic account with the email
matched by the historical cleanup, and replays the migration chain in two stages.
It verifies that all registered operations were skipped, the account survives,
personal workout creation was not replayed and the next promotion is a no-op. The
temporary database is dropped in `finally`; the existing application database is
never reset. If the process is forcibly killed, inspect the exact temporary name
before removing its abandoned database. The rehearsal validates migration
portability; the separate Supabase integration suite validates the real Auth API.

## Effective schema and RPC inventory

```sh
node scripts/export-database-contract.mjs
```

The read-only exporter writes to `artifacts/database-contract/`:

- `schema.sql`: effective public/private DDL from the matching local `pg_dump`.
- `schema.json`: columns, constraints, actual trigger definitions, RLS policies
  and effective anonymous/authenticated/service-role table privileges.
- `effective-functions.sql`: actual `pg_get_functiondef` output, including all
  later replacements and historical string-patched functions.
- `rpc-permissions.json`: function signatures, security-definer status,
  configuration and effective execution permissions for all three roles.
- `migration-manifest.json`: applied versions and reviewed source hashes.

No user rows or credentials are exported. The dump is local-only and requires
the standard local Supabase database on port 54322. Preserve these generated
artifacts with CI/release evidence instead of maintaining a second handwritten
schema. They are diagnostic/reference outputs; they are not an alternate
production migration baseline.

## Application invariants and tests

`202609070001` makes every descendant write share-lock its draft version, including
direct authorized PostgREST writes. Publication and copying take an exclusive
version lock. A writer that waits behind publication rechecks the now-published
version and rejects the edit. Appends retain parent-row serialization while using
the same shared version lock. Service-only exact-namespace fixture cleanup keeps
its preexisting bypass for deletion.

`202609070002` duplicates current drafts into independent drafts with fresh IDs.
Draft copies do not claim an immutable `based_on_version_id`; copies of immutable
revisions keep that lineage. The original metadata trigger's immutable lineage
contract remains enforced.

`202609070003` routes Calendar date edits through the same locked run-scheduling
validation as the run wizard, while preserving the existing single-workout
removal lifecycle and historical occurrence compatibility.

```sh
node --test tests/portable-migrations.test.mjs
node tests/run-database-review-smoke.mjs
node tests/run-supabase-integration.mjs
node tests/run-authoring-database-smoke.mjs
node tests/run-v1-performance-database-smoke.mjs
```

The review smoke uses unique namespaced fixtures, verifies unused/used draft
duplication for both content types, checks Calendar rejection and valid moves,
and tests both concurrent edit/publication interleavings with actual PostgreSQL
blocking-PID assertions. It cleans up its exact fixture namespace afterward.
Run the authoring smoke sequentially with other database fixtures because its
transaction briefly installs failure-injection triggers on authoring tables.

## Private telemetry storage

`202609070004` exposes only `collect_client_telemetry(events jsonb)` to signed-in
clients. It accepts 1–10 typed envelopes per request and at most 20 accepted events
per authenticated account per UTC minute, returning `{accepted, rateLimited}`.
Unknown keys, free-form messages, identifiers, unsupported enums and unbounded
numbers are rejected before writing. Client `recordedAt` is discarded; storage
uses server time. Stored event rows have no account IDs. The account key exists
only in a private two-minute rate-limit ledger.

`private.client_telemetry_events` contains `recorded_at`, `release_sha`,
`environment`, `kind` and a strictly validated numeric/enum payload. Clients have
no direct table privileges. The service role can read event rows for aggregated
operations reports. `private.prune_client_telemetry()` removes events older than
seven days and old rate counters. The primary Supabase database installs the
`liftlog-client-telemetry-retention` pg_cron job every 15 minutes; collection also
prunes expired rows. Monitor that job's success as part of operations. Separate
temporary rehearsal databases skip pg_cron installation because that extension
belongs to the server's configured primary database.

```sh
node tests/run-telemetry-database-smoke.mjs
```

The rollback-only smoke verifies privacy validation, batch/rate limits, server
timestamps, denied client reads/writes and the active retention job. Operational
diagnostics should aggregate only the seven-day window and must not expose
individual envelope rows to app clients.

Apply and verify the telemetry migration on the target **before** enabling
`VITE_ENABLE_REMOTE_TELEMETRY=true` in that target's frontend build. Keep the flag
off until the collector, privacy boundary and retention job are verified there.
The browser transport is best-effort and authenticated; it must not block saves,
sign-in or navigation when telemetry is unavailable.

## Read-only diagnostics and alerts

```sh
npm run ops:telemetry
npm run ops:telemetry -- --environment=test --release=abc1234 --window-minutes=60
node tests/run-telemetry-diagnostics-smoke.mjs
```

Use `LIFTLOG_TELEMETRY_DATABASE_URL` for the service/administrative SQL connection.
Hosted reporting requires the same explicit `--target` and exact `--project-ref`
binding as promotion; credentials never appear in output or command arguments.
The report connection is read-only. Output contains release and operation
aggregates only. It counts error envelopes separately from failed performance
outcomes to avoid double-counting them in a failure-rate denominator.

Exit code `2` means an alert: at least 10 error envelopes in the default 60-minute
window, any fatal error, a measured outcome failure rate above 5% with at least 20
samples, an inactive retention job, or telemetry surviving beyond the retention
window plus its 15-minute cleanup interval. Thresholds can be adjusted with
`--max-error-events`, `--max-failure-rate`, and `--min-operation-samples` after a
representative baseline is collected. A lack of samples does not establish
health; only authenticated, rate-limited reported events contribute. The smoke
inserts one isolated synthetic test release, verifies its actual CLI alert exit
code and count, and deletes its exact row afterward.

## Local backup/restore rehearsal

```sh
npm run db:recovery:rehearse
```

The local-only tool takes a custom-format logical archive of the application's
`public`, `private`, `auth` and `supabase_migrations` schemas and data. It shares an
exported MVCC snapshot between `pg_dump` and expected row counts, so concurrent
browser work does not invalidate the comparison. It restores only into a newly
created `liftlog_recovery_review_*` database, then verifies table counts,
constraints and validation state, function bodies and effective execute
privileges, RLS flags/policies and app triggers. The original database is never
reset or changed. The temporary restore database is dropped in `finally`.

`artifacts/recovery/<run-id>/database.dump` is a private local backup containing
Auth/account data; it is ignored by Git and must not be uploaded as ordinary CI
evidence. CI uploads only `report.json`, which contains counts, digests and timing.
The restore retains existing object ACLs but omits provider-owned future-object
default privilege templates that the local application administrator cannot
recreate. The archive itself retains those original templates for an authorized
platform restore. Hosted PITR/backups, OAuth configuration, storage objects,
provider secrets/default privileges and cron jobs require separate provider
recovery verification; the local test makes no claims about them.

Verified locally on September 7, 2026: a complete 84-migration portable replay,
an unchanged existing-account probe, an idempotent second promotion, and a logical
restore matching 50 tables / 1,480 rows / 291 constraints / 135 functions / 48 RLS
policies / 47 app triggers. The restore rehearsal completed in approximately 3.8
seconds on this development machine. Counts and timing will change with fixtures;
retain the generated report for the exact run. The corresponding source database
was not reset.
