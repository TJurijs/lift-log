import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);

test("prescriptions support shared defaults and per-entry set or round targets", async () => {
  const [app, domain, repository] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(domainUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);

  assert.match(domain, /export interface PrescriptionEntry/);
  assert.match(domain, /entries\?: PrescriptionEntry\[\]/);
  assert.match(app, /function PrescriptionEntryTable/);
  assert.match(app, /label="Set plan"/);
  assert.match(app, /label="Round plan"/);
  assert.match(app, /Per set/);
  assert.match(app, /Per round/);
  assert.match(app, /function FieldLabel/);
  assert.match(app, /type="checkbox"/);
  assert.match(repository, /function prescriptionEntryFromRow/);
  assert.match(repository, /item\.prescription\.entries\?\.length/);
  assert.match(repository, /mode === "intervals" && ordered\.length > 1/);
});
