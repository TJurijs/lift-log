import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608210015_in_app_coach_requests.sql",
  import.meta.url,
);
const concurrencyMigrationUrl = new URL(
  "../supabase/migrations/202608220002_harden_coach_workflow_concurrency.sql",
  import.meta.url,
);
const outgoingMigrationUrl = new URL(
  "../supabase/migrations/202608220004_outgoing_coach_requests.sql",
  import.meta.url,
);

test("new coaching invitations are account-bound in-app requests", async () => {
  const [migration, concurrencyMigration] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(concurrencyMigrationUrl, "utf8"),
  ]);

  assert.match(
    migration,
    /coach_invites_pending_profile_check[\s\S]*status <> 'pending' or invited_profile_id is not null/i,
  );
  assert.match(
    migration,
    /create or replace function public\.create_coach_invite\(target_email text\)[\s\S]*target_user_id is null[\s\S]*No available account matches/i,
  );
  assert.match(
    migration,
    /create or replace function public\.list_pending_coach_invites\(\)[\s\S]*invitation\.invited_profile_id = current_user_id/i,
  );
  assert.match(
    migration,
    /create or replace function public\.respond_to_coach_invite[\s\S]*invite\.invited_profile_id = current_user_id[\s\S]*for update/i,
  );
  assert.match(migration, /target_response not in \('accepted', 'declined'\)/i);
  assert.doesNotMatch(
    migration,
    /jsonb_build_object\([^;]*'token'/i,
    "the create RPC must not return a shareable raw token",
  );
  assert.match(
    concurrencyMigration,
    /pg_advisory_xact_lock[\s\S]*invitation\.status = 'pending'[\s\S]*if invitation_id is not null and expiration > now\(\)[\s\S]*return jsonb_build_object/i,
    "concurrent retries for the same coach must return one stable pending request",
  );
});

test("workspace repository exposes pending requests and id-based responses", async () => {
  const [domain, repository, seed, outgoingMigration] = await Promise.all([
    readFile(new URL("../lib/domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/repository.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/seed-test-population.mjs", import.meta.url),
      "utf8",
    ),
    readFile(outgoingMigrationUrl, "utf8"),
  ]);

  assert.match(domain, /export interface PendingCoachInvite/);
  assert.match(domain, /pendingCoachInvites: PendingCoachInvite\[\]/);
  assert.match(domain, /export interface OutgoingCoachInvite/);
  assert.match(domain, /outgoingCoachInvites: OutgoingCoachInvite\[\]/);
  assert.match(repository, /\.rpc\("get_coaching_access_summary"\)/);
  assert.doesNotMatch(repository, /this\.loadPendingCoachInvites\(\)/);
  assert.match(
    repository,
    /async cancelCoachInvite[\s\S]*\.rpc\("cancel_coach_invite"/,
  );
  assert.match(
    repository,
    /async respondToCoachInvite[\s\S]*\.rpc\("respond_to_coach_invite"/,
  );
  assert.doesNotMatch(repository, /searchParams\.set\("coach_invite"/);
  assert.match(seed, /\.rpc\("respond_to_coach_invite"/);
  assert.doesNotMatch(seed, /invitation\.token/);
  assert.match(
    outgoingMigration,
    /list_outgoing_coach_invites[\s\S]*invitation\.athlete_id = current_user_id[\s\S]*invitation\.status = 'pending'/i,
  );
  assert.match(
    outgoingMigration,
    /cancel_coach_invite[\s\S]*invite\.athlete_id = current_user_id[\s\S]*for update[\s\S]*status = 'revoked'/i,
    "only the requesting athlete may cancel an unanswered request",
  );
});
