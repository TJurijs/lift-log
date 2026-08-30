# Lift Log deployment layout

The application is built locally or in CI and Hetzner receives only static `dist/` files. Never deploy the obsolete prototype files from the workspace root.

## Public hosts

- `liftlog.cc` redirects to `https://app.liftlog.cc`
- `app.liftlog.cc` serves production
- `dev.liftlog.cc` serves nonprod

The same Hetzner server is appropriate for the initial 5–6 athlete pilot. Keep the environments isolated by directory and by Supabase project:

```text
/srv/liftlog/
  nonprod/
    releases/<release-id>/
    current -> releases/<release-id>
  prod/
    releases/<release-id>/
    current -> releases/<release-id>
```

Use separate atomic `current` symlinks so a nonprod release cannot overwrite production and either environment can roll back independently.

## Build inputs

```text
.env.nonprod    → dev.liftlog.cc → liftlog-dev
.env.production → app.liftlog.cc → liftlog-prod
```

Hosted Supabase inventory:

| Environment | Project | Region | Project ref |
| --- | --- | --- | --- |
| Nonprod | `liftlog-dev` | `eu-west-1` (Ireland) | `ofyeejyfroblunbspgve` |
| Production | `liftlog-prod` | `eu-north-1` (Stockholm) | `awdgjgziyrqdkybmlime` |

The local Supabase CLI remains linked to nonprod by default. Remote database commands must still include an explicit project ref.

Only these Supabase values are allowed in a frontend build:

- project URL
- publishable key

Database passwords and secret/service-role keys stay out of the repository, Vite environment files, browser bundle, and Hetzner host.

## Web server requirements

Caddy or Nginx should:

- terminate HTTPS for all three hostnames
- serve the matching `current` directory
- fall back to `/index.html` for client-side routes and OAuth returns
- send `Cache-Control: no-cache` for `index.html`
- cache hashed `/assets/*` files as immutable
- expose only ports 80 and 443 publicly
- keep Vite port 3000 private and unused in production

The checked-in server configuration is `deploy/nginx-liftlog.conf`; the production placeholder is `deploy/maintenance.html`.

## Current rollout status

- GoDaddy DNS points `@`, `app`, and `dev` to Hetzner `2.29.2.99`; `www` aliases `liftlog.cc`.
- Nonprod is live at `https://dev.liftlog.cc` from `/srv/liftlog/nonprod/current`.
- The active nonprod release is `/srv/liftlog/nonprod/releases/20260830T000344Z` (application commit `e6db1b7`). `/srv/liftlog/nonprod/releases/20260829T234244Z` remains the verified rollback target.
- Nginx serves SPA fallbacks, non-cached HTML, immutable hashed assets, and security headers.
- UFW exposes only SSH, HTTP, and HTTPS.
- Let's Encrypt covers `dev.liftlog.cc` and a separate SAN certificate covers `liftlog.cc`, `app.liftlog.cc`, and `www.liftlog.cc`; automatic renewal and simulated renewal have succeeded for both.
- The hosted dev Auth site URL is `https://dev.liftlog.cc`; its allowed redirects are `https://dev.liftlog.cc` and `http://localhost:3000`.
- `liftlog.cc`, `www.liftlog.cc`, and `app.liftlog.cc` deliberately return the HTTPS maintenance response until nonprod authentication passes.
- Google OAuth uses the dedicated Google Cloud project `liftlog-dev-506123` (`LiftLog Dev`) in Testing mode.
- The dev OAuth client permits `https://dev.liftlog.cc` and `http://localhost:3000`, and redirects only through the hosted dev Supabase callback.
- Google OAuth is enabled in `liftlog-dev`; the first real sign-in and authenticated desktop navigation smoke test passed.
- Additional pilot accounts must be added as Google OAuth test users while the dev project remains in Testing mode.
- A mobile-device check and explicit production signoff are the remaining gates before production promotion.

## Nonprod release procedure

1. Run `npm run build:nonprod` immediately before upload.
2. Verify `dist/assets/*` contains the nonprod ref `ofyeejyfroblunbspgve` and not the production ref.
3. Upload only `dist/` into a new `/srv/liftlog/nonprod/releases/<UTC-release-id>/` directory.
4. Set file permissions to directories `0755` and files `0644`.
5. Atomically repoint `/srv/liftlog/nonprod/current` to the new release.
6. Smoke-test `/`, a client-side route, static-asset caching, Supabase connectivity, sign-in, and sign-out.

Rollback is an atomic repoint of `current` to the preceding release; no database rollback is implied.

Performance budgets, exact environment checks, alert thresholds, staged capacity testing, and database recovery guidance are maintained in [PERFORMANCE_OPERATIONS_RUNBOOK.md](PERFORMANCE_OPERATIONS_RUNBOOK.md).

## Production gate

Production receives a fresh `npm run build:prod` output. Do not copy the nonprod build or its mutable local `dist/` directory. Before switching `app.liftlog.cc`, configure the production Auth URL and Google client independently, issue production TLS certificates, run the same smoke checks, and retain the maintenance release for rollback.
