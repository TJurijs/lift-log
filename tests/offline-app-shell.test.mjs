import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createOfflineAppShell } from "../scripts/lib/offline-app-shell.mjs";

function worker(fetchResponse) {
  const handlers = new Map();
  const stored = new Map([["/", new Response("saved app", { headers: { "content-type": "text/html" } })]]);
  const puts = [];
  const waits = [];
  const cache = {
    match: async (key) => stored.get(key)?.clone(),
    put: async (key, value) => { puts.push(key); stored.set(key, value); },
  };
  vm.runInNewContext(createOfflineAppShell("test", ["assets/app-123.js"]), {
    self: { location: { origin: "http://localhost:3000" }, addEventListener: (name, handler) => handlers.set(name, handler) },
    caches: { open: async () => cache },
    fetch: fetchResponse,
    URL, Response, Set,
  });
  return {
    puts,
    async request(path, mode = "navigate") {
      let response;
      handlers.get("fetch")({
        request: { url: new URL(path, "http://localhost:3000").href, method: "GET", mode },
        respondWith: (pending) => { response = pending; },
        waitUntil: (pending) => waits.push(pending),
      });
      const result = await response;
      await Promise.all(waits);
      return result;
    },
  };
}

test("an HTTP error or non-HTML response cannot poison the offline app shell", async () => {
  for (const response of [new Response("maintenance", { status: 503 }), new Response("private data", { headers: { "content-type": "application/json" } })]) {
    const app = worker(async () => response);
    assert.equal(await (await app.request("/" )).text(), "saved app");
    assert.deepEqual(app.puts, []);
  }
});

test("navigation recovers offline without mixing new HTML into an older build cache", async () => {
  const offline = worker(async () => { throw new TypeError("offline"); });
  assert.equal(await (await offline.request("/programs")).text(), "saved app");
  const online = worker(async () => new Response("new app", { headers: { "content-type": "text/html" } }));
  assert.equal(await (await online.request("/programs")).text(), "saved app");
  assert.deepEqual(online.puts, []);
});

test("only public build assets are intercepted, and different build files use different caches", async () => {
  const app = worker(async () => new Response("asset"));
  assert.equal(await app.request("/api/account", "cors"), undefined);
  assert.equal(await app.request("https://example.com/assets/app-123.js", "cors"), undefined);
  assert.equal(await (await app.request("/assets/app-123.js", "cors")).text(), "asset");
  assert.deepEqual(app.puts, ["/assets/app-123.js"]);
  assert.notEqual(
    createOfflineAppShell("test", ["assets/app-123.js"]).split("\n")[0],
    createOfflineAppShell("test", ["assets/app-456.js"]).split("\n")[0],
  );
});


test("installing an update leaves existing clients and their lazy assets on their release", async () => {
  const handlers = new Map();
  const cachesByName = new Map([["liftlog-shell-old", new Map([["/assets/old-lazy.js", new Response("old feature")]])]]);
  let takeover = false;
  let claimed = false;
  const caches = {
    async open(name) {
      if (!cachesByName.has(name)) cachesByName.set(name, new Map());
      return { async addAll(paths) { for (const path of paths) cachesByName.get(name).set(path, new Response("new build")); } };
    },
    async keys() { return [...cachesByName.keys()]; },
    async delete(name) { return cachesByName.delete(name); },
  };
  vm.runInNewContext(createOfflineAppShell("new", ["assets/new-lazy.js"]), {
    self: { addEventListener: (name, fn) => handlers.set(name, fn), skipWaiting() { takeover = true; }, clients: { claim() { claimed = true; } } },
    caches, Set,
  });
  let installed;
  handlers.get("install")({ waitUntil(promise) { installed = promise; } });
  await installed;
  assert.equal(takeover, false);
  assert.equal(await cachesByName.get("liftlog-shell-old").get("/assets/old-lazy.js").text(), "old feature");
  // The browser emits activate only after old controlled clients are gone.
  let activated;
  handlers.get("activate")({ waitUntil(promise) { activated = promise; } });
  await activated;
  assert.equal(claimed, false);
  assert.equal(cachesByName.has("liftlog-shell-old"), false);
});
