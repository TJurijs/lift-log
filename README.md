# Lift Log

Lift Log is a mobile-first training planner and workout logger for self-coached athletes and coach-supported athletes. It supports strength, bodybuilding, cardio, mobility, and mixed programs without forcing every exercise into sets and weight.

## Current implementation

- React + TypeScript single-page application built with Vite
- Responsive mobile and desktop interfaces
- Supabase Google authentication in configured environments
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

### Demo

This runs entirely in the browser with sample data. It has no authentication, database, or persistence.

```bash
npm run dev:demo
```

### Local Supabase

The local Supabase plumbing remains available for future isolated database work, but it is not part of the normal development workflow and there is intentionally no `dev:local` command.

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
npm run test:integration
npm run db:lint
```

The integration test creates temporary local users and proves athlete isolation, active and revoked coach access, publishing, schedule creation, and immutable completed history. It refuses to run against a non-local Supabase URL.

## Nonprod and production builds

Use separate Supabase projects and separate Vite environment files:

- `.env.nonprod`: `https://dev.liftlog.cc` and the nonprod Supabase project
- `.env.production`: `https://app.liftlog.cc` and the production Supabase project

```bash
npm run build:nonprod
npm run build:prod
```

These commands fail before building if the public site URL, Supabase URL, or publishable key is missing or is not HTTPS. Only the resulting `dist/` directory is deployed.

## Google authentication

The first real-auth test environment is nonprod. Google OAuth may remain in Testing mode for the small pilot, with each athlete and coach added as a Google test user. Configure the Supabase Google provider and exact `https://dev.liftlog.cc` redirect first; production gets its own project, callback, and keys later.

The database model is defined by:

- `supabase/migrations/202608200001_initial_schema.sql`
- `supabase/migrations/202608210001_operational_mvp.sql`

See [docs/MVP_AND_ARCHITECTURE.md](docs/MVP_AND_ARCHITECTURE.md) for the product and authorization model, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the staged hosting layout.
