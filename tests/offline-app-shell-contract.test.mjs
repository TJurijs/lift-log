import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, vite] = await Promise.all([
  readFile(new URL("../main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
]);

test("production registers a same-origin offline application shell", () => {
  assert.match(main, /import\.meta\.env\.PROD/);
  assert.match(main, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(vite, /function offlineAppShell/);
  assert.match(vite, /request\.mode==="navigate"/);
  assert.match(vite, /url\.origin!==self\.location\.origin/);
  assert.match(vite, /cache\.addAll\(PRECACHE\)/);
  assert.match(vite, /key\.startsWith\("liftlog-shell-"\)/);
});
