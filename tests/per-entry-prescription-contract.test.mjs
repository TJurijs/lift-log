import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("prescriptions support shared defaults and per-entry set or round targets", async () => {
  const [app, domain, repository, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(domainUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
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
  assert.match(app, /className="prescription-modal"/);
  assert.match(app, /<span>Format<\/span>/);
  assert.match(app, /<option value="sets">Sets × reps<\/option>/);
  assert.match(app, /\{saving \? "Saving…" : "Save"\}/);
  assert.match(
    styles,
    /\.form-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s,
    "mobile prescription controls stay in a compact two-column grid",
  );
  assert.match(
    styles,
    /\.prescription-modal \.prescription-entry-row\s*\{[^}]*repeat\(var\(--prescription-field-count\), minmax\(0, 1fr\)\)/s,
    "all set and interval targets fit across the phone without horizontal scrolling",
  );
  assert.match(
    styles,
    /\.prescription-entry-table\.tracking-1\s*\{[^}]*--prescription-field-count:\s*1/s,
    "the plan grid adapts to the exercise's configured logging fields",
  );
  assert.match(
    styles,
    /\.prescription-modal \.form-field \.per-entry-toggle > input\s*\{[^}]*width:\s*1px;[^}]*min-width:\s*1px;/s,
    "the visually hidden per-entry checkbox cannot widen the modal",
  );
  assert.match(
    styles,
    /iframe\.dev-mobile-preview-frame\s*\{[^}]*box-sizing:\s*content-box;/s,
    "the labelled preview viewport excludes the decorative device border",
  );
  assert.doesNotMatch(styles, /\.prescription-entry-grid\s*\{[^}]*min-width:\s*420px/s);
  assert.match(repository, /function prescriptionEntryFromRow/);
  assert.match(repository, /item\.prescription\.entries\?\.length/);
  assert.match(repository, /mode === "intervals" && ordered\.length > 1/);
});
