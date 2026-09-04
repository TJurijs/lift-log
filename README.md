# Lift Log

Lift Log is a mobile-first training planner and workout logger for self-coached athletes and coach-supported athletes. It supports strength, bodybuilding, cardio, mobility, and mixed programs without forcing every exercise into sets and weight.

## Current implementation

- React + TypeScript single-page application built with Vite
- Responsive mobile and desktop interfaces
- Supabase Google authentication in configured environments
- Development-only test-persona sign-in for repeatable athlete/coach QA
- Supabase Postgres repository for programs, workout logging, history, exercise libraries, and coaching
- Row Level Security for athlete isolation and revocable coach access
- Immutable published programs and completed workout history
- Transactional database functions for onboarding, publishing, scheduling, session snapshots, completion, and coach invitations
- Development-only demo when Supabase browser configuration is absent

Hetzner will serve only the static `dist/` output. Authentication, durable data, and authorization remain in Supabase; no Supabase secret key belongs on the web server or in the browser bundle.

## Development modes

Requires Node.js 22.13 or newer.

Both modes serve the frontend at `http://localhost:3000`. The difference is where the data comes from.

### Hosted development (default)

This runs your local source code against the hosted `liftlog-dev` Supabase project, including real Google sign-in and persistent development data.

```bash
npm ci
npm run dev
```

`npm run dev` is an alias for `npm run dev:hosted`. It loads `.env.nonprod`, which stays on your computer and is ignored by Git. After a fresh clone, create it from `.env.example` and add the development Supabase URL and publishable key. Never put a secret/service-role key or database password in a `VITE_` variable.

### Development test population

Nonprod can contain nine isolated fictional accounts based on Latvian presidents. They cover self-coached athletes, ordinary coach relationships, one athlete with two coaches, a coach who is also an athlete, first-login onboarding, and a coach with no athletes.

The login screen and signed-in sidebar expose a **Test population** switcher only when all three safeguards match: the `nonprod` build mode, the exact `liftlog-dev` Supabase project, and `VITE_ENABLE_TEST_PERSONAS=true`. The shared password is entered once and kept only in page memory; it belongs in ignored `.env.test-personas`, never in a `VITE_` variable.

After applying migrations, reset and rebuild the fixture with:

```bash
npm run seed:test-population
```

The command refuses production and unknown Supabase projects, preserves real development accounts, retains stable fixture Auth identities, and resets only the exact fixture namespace. Set optional `TEST_POPULATION_AS_OF=YYYY-MM-DD` in `.env.test-personas` when a reproducible date anchor is needed.

### Demo

This runs entirely in the browser with sample data. It has no authentication, database, or persistence.

```bash
npm run dev:demo
```

### Isolated local QA

Use this mode to test real account switching, invitations, coach access, and scheduling without touching the hosted development database:

```bash
npm run db:start
npm run db:reset
npm run seed:test-population:local
npm run dev:local
```

The frontend runs at `http://localhost:3000` and talks only to Supabase on `127.0.0.1`. The shared password still comes from ignored `.env.test-personas`. Local data is disposable; `npm run db:reset` rebuilds it from migrations.

## Delivery workflow

The source repository is [TJurijs/lift-log](https://github.com/TJurijs/lift-log). The intended flow is:

1. Develop at `http://localhost:3000` with `npm run dev`.
2. Commit and push the source to GitHub.
3. Build and deploy `main` to `https://dev.liftlog.cc`.
4. Test the development site on desktop and a real phone.
5. Promote a tested commit to `https://app.liftlog.cc` with a separate production build.

Database migrations follow the same direction: development project first, production project only after verification. The development and production frontends must always be built separately so a development Supabase reference cannot be copied into production.

## Validation

```bash
npm run lint
npm test
npm run test:coverage
npm run test:e2e
npm run test:integration
npm run test:v1:database-smoke
npm run test:authoring:database-smoke
npm run db:lint
npm run ci:verify
npm run ci:local-supabase
npm run perf:fixture
npm run perf:bundle:report
npm run perf:measure:local
npm run perf:runtime:check
```

Browser tests default to the local Docker Supabase stack and block external
requests during authenticated tests. Start Docker and seed the disposable local
personas before `npm run test:e2e`. The local suite covers desktop/mobile
navigation, accessibility, program authoring, offline draft recovery, and
exclusive workout editing across tabs. Hosted read tests require explicitly
setting `PLAYWRIGHT_DATA_ENVIRONMENT=hosted-dev`; the separate hosted draft test
also retains its explicit mutation opt-in.

The September 4 cleanup findings, verified scope, and remaining architecture
work are recorded in [the technical review](docs/review/TECHNICAL_REVIEW_2026_09_04.md)
and [the follow-up review](docs/review/TECHNICAL_REVIEW_FOLLOWUP_2026_09_04.md),
which covers additional persistence/cache fixes, the extracted exercise feature,
coaching usability, and local browser/database verification.

The integration test creates three temporary, namespaced test users and proves athlete isolation, active and revoked coach access, publishing, schedule creation, and immutable completed history. `npm run test:integration` remains loopback-only. Hosted development is a separate, fail-closed path:

```bash
npm run test:integration:hosted-dev
```

That command still refuses to start unless the process environment explicitly sets `SUPABASE_HOSTED_DEV_INTEGRATION=1`, `SUPABASE_TEST_ENVIRONMENT=hosted-development`, `SUPABASE_TEST_PROJECT_REF=ofyeejyfroblunbspgve`, the exact `https://ofyeejyfroblunbspgve.supabase.co` test URL, and separate publishable and secret test keys. Supply keys through an ignored local environment or secret manager; never commit them or put the secret key in a `VITE_` variable. Cleanup uses the service-only, exact-namespace fixture reset before deleting those three generated Auth users. The `verify` CI job stays offline; the separate `local-supabase` job uses only an ephemeral loopback stack for integration, scale, and read-only browser performance gates.

## Nonprod and production builds

Use separate Supabase projects and separate Vite environment files:

- `.env.nonprod`: `https://dev.liftlog.cc` and the nonprod Supabase project
- `.env.production`: `https://app.liftlog.cc` and the production Supabase project

```bash
npm run build:nonprod
npm run build:prod
```

These commands fail before building if the public site URL, Supabase URL, or publishable key is missing or is not HTTPS. Only the resulting `dist/` directory is deployed.

Production builds fail if test personas are enabled. Nonprod builds also fail if that feature points anywhere except the exact development project.

## Google authentication

The first real-auth test environment is nonprod. Google OAuth may remain in Testing mode for the small pilot, with each athlete and coach added as a Google test user. Configure the Supabase Google provider and exact `https://dev.liftlog.cc` redirect first; production gets its own project, callback, and keys later.

The database model is defined by:

- `supabase/migrations/202608200001_initial_schema.sql`
- `supabase/migrations/202608210001_operational_mvp.sql`
- `supabase/migrations/202608210002_test_population_and_multi_coach.sql`
- `supabase/migrations/202608210003_private_profiles_program_library_and_athlete_scheduling.sql`
- `supabase/migrations/202608210004_program_deactivation.sql`
- `supabase/migrations/202608210005_multiple_available_programs.sql`
- `supabase/migrations/202608210006_program_catalog_and_builder_operations.sql`
- `supabase/migrations/202608210007_atomic_prescription_editing.sql`
- `supabase/migrations/202608210008_library_instances_are_immutable.sql`
- `supabase/migrations/202608210009_compact_exercises_after_deletion.sql`
- `supabase/migrations/202608210010_repeating_cycles_and_section_editing.sql`
- `supabase/migrations/202608210011_restore_partial_repeating_cycles.sql`
- `supabase/migrations/202608210012_safe_item_deletion_and_complete_repeating_cycles.sql`

See [docs/MVP_AND_ARCHITECTURE.md](docs/MVP_AND_ARCHITECTURE.md) for the implemented architecture, [docs/PRODUCT_MODEL_AND_CAPABILITIES.md](docs/PRODUCT_MODEL_AND_CAPABILITIES.md) for the canonical terminology, state axes, provenance, and capability contract, [docs/BROWSER_SUPPORT.md](docs/BROWSER_SUPPORT.md) for the minimum browser policy, [docs/review/README.md](docs/review/README.md) for stabilization evidence, [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the staged hosting layout, and [docs/PERFORMANCE_OPERATIONS_RUNBOOK.md](docs/PERFORMANCE_OPERATIONS_RUNBOOK.md) for budgets, capacity exercises, telemetry privacy, alerts, and recovery.
