import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, vite, worker] = await Promise.all([
  readFile(new URL("../main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../scripts/lib/offline-app-shell.mjs", import.meta.url), "utf8"),
]);

test("production registers a same-origin offline application shell", () => {
  assert.match(main, /import\.meta\.env\.PROD/);
  assert.match(main, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(vite, /function offlineAppShell/);
  assert.match(worker, /request\.mode==="navigate"/);
  assert.match(worker, /url\.origin!==self\.location\.origin/);
  assert.match(worker, /cache\.addAll\(PRECACHE\)/);
  assert.match(worker, /key\.startsWith\("liftlog-shell-"\)/);
});
