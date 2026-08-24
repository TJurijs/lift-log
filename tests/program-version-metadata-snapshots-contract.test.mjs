import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608240003_program_version_metadata_snapshots.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const protectionFunction =
  migration.match(
    /create or replace function public\.protect_published_version\(\)[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";
const canonicalMetadataFunction =
  migration.match(
    /create or replace function private\.canonicalize_program_version_metadata\(\)[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";
const draftSyncFunction =
  migration.match(
    /create or replace function private\.sync_program_draft_metadata\(\)[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

test("program version metadata is backfilled while the immutable trigger is transactionally disabled", () => {
  assert.match(
    migration,
    /alter table public\.program_versions\s+add column title text,\s+add column description text/i,
  );
  const disableAt = migration.indexOf(
    "disable trigger protect_published_program_version",
  );
  const timestampDisableAt = migration.indexOf(
    "disable trigger program_versions_set_updated_at",
  );
  const backfillAt = migration.indexOf("update public.program_versions version");
  const enableAt = migration.indexOf(
    "enable trigger protect_published_program_version",
  );
  const timestampEnableAt = migration.indexOf(
    "enable trigger program_versions_set_updated_at",
  );
  const notNullAt = migration.indexOf("alter column title set not null");
  assert.ok(disableAt > -1 && timestampDisableAt > disableAt);
  assert.ok(backfillAt > timestampDisableAt);
  assert.ok(timestampEnableAt > backfillAt && enableAt > timestampEnableAt);
  assert.ok(notNullAt > enableAt);
  assert.match(
    migration,
    /set\s+title = program\.title,\s+description = program\.description\s+from public\.programs program\s+where program\.id = version\.program_id/i,
  );
});

test("published and superseded version metadata remains immutable", () => {
  assert.ok(protectionFunction);
  assert.match(
    protectionFunction,
    /if old\.status = 'superseded' then[\s\S]*raise exception 'Superseded program versions are immutable'/i,
  );
  assert.match(
    protectionFunction,
    /if old\.status = 'published' then[\s\S]*new\.status <> 'superseded'[\s\S]*new\.title is distinct from old\.title[\s\S]*new\.description is distinct from old\.description[\s\S]*Published program versions are immutable except when superseded/i,
  );
  assert.match(
    protectionFunction,
    /new\.based_on_version_id is distinct from old\.based_on_version_id[\s\S]*Program version lineage cannot be changed/i,
  );
});

test("source cleanup may clear only lineage without rewriting history", () => {
  assert.match(
    protectionFunction,
    /old\.based_on_version_id is not null[\s\S]*new\.based_on_version_id is null[\s\S]*new\.program_id = old\.program_id[\s\S]*new\.authored_by_id = old\.authored_by_id[\s\S]*new\.version_number = old\.version_number[\s\S]*new\.status = old\.status[\s\S]*new\.effective_from is not distinct from old\.effective_from[\s\S]*new\.published_at is not distinct from old\.published_at[\s\S]*new\.title is not distinct from old\.title[\s\S]*new\.description is not distinct from old\.description[\s\S]*return new/i,
  );
});

test("new versions derive canonical metadata from their factual source", () => {
  assert.ok(canonicalMetadataFunction);
  assert.match(
    canonicalMetadataFunction,
    /security definer\s+set search_path = ''/i,
  );
  assert.match(
    canonicalMetadataFunction,
    /new\.based_on_version_id is not null[\s\S]*\(select auth\.uid\(\)\) is not null[\s\S]*public\.can_read_version\(new\.based_on_version_id\)[\s\S]*select[\s\S]*version\.program_id,[\s\S]*version\.status,[\s\S]*version\.title,[\s\S]*version\.description[\s\S]*version\.id = new\.based_on_version_id/i,
  );
  assert.match(
    canonicalMetadataFunction,
    /source_status not in \('published', 'superseded'\)[\s\S]*Based-on program version must be immutable/i,
  );
  assert.match(
    canonicalMetadataFunction,
    /source_program_id is distinct from new\.program_id[\s\S]*new\.title := source_title[\s\S]*new\.description := source_description/i,
  );
  assert.match(
    canonicalMetadataFunction,
    /if new\.version_number = 1 then[\s\S]*update public\.programs[\s\S]*title = source_title[\s\S]*description = source_description/i,
    "cross-program copies must also keep the compatibility container aligned",
  );
  assert.match(
    canonicalMetadataFunction,
    /new\.title := container_title;\s+new\.description := container_description/i,
  );
  assert.match(
    migration,
    /create trigger canonicalize_program_version_metadata\s+before insert or update on public\.program_versions/i,
  );
});

test("renaming a program updates only its mutable draft snapshot", () => {
  assert.ok(draftSyncFunction);
  assert.match(draftSyncFunction, /security definer\s+set search_path = ''/i);
  assert.match(
    draftSyncFunction,
    /update public\.program_versions\s+set\s+title = new\.title,\s+description = new\.description\s+where program_id = new\.id\s+and status = 'draft'/i,
  );
  assert.match(
    migration,
    /create trigger sync_program_draft_metadata\s+after update of title, description on public\.programs/i,
  );
  assert.match(
    migration,
    /revoke all on function private\.canonicalize_program_version_metadata\(\)[\s\S]*from public, anon, authenticated/i,
  );
});
