import { createServer } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { createOfflineAppShell } from "../../scripts/lib/offline-app-shell.mjs";

type Release = "a" | "b";

function releaseFiles(release: Release) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lift Log offline release fixture</title></head><body>
    <h1>Release ${release}</h1>
    <label>Workout note<textarea id="note"></textarea></label>
    <button id="feature">Open lazy feature</button><p id="result" role="status"></p>
    <script type="module" src="/assets/main-${release}.js"></script>
  </body></html>`;
  const main = `
    const note = document.querySelector('#note');
    note.value = localStorage.getItem('unsynced-workout') || '';
    note.addEventListener('input', () => localStorage.setItem('unsynced-workout', note.value));
    document.querySelector('#feature').addEventListener('click', async () => {
      try {
        const feature = await import('/assets/feature-${release}.js');
        document.querySelector('#result').textContent = feature.label;
      } catch (error) {
        document.querySelector('#result').textContent = 'Feature failed: ' + error.message;
      }
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    });
  `;
  return new Map([
    ["/", { type: "text/html", body: html }],
    [`/assets/main-${release}.js`, { type: "text/javascript", body: main }],
    [`/assets/feature-${release}.js`, { type: "text/javascript", body: `export const label = 'Lazy feature ${release}';` }],
  ]);
}

async function serveReleases() {
  let release: Release = "a";
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    requests.push(path);
    response.setHeader("cache-control", "no-store");
    const files = releaseFiles(release);
    const file = path === "/sw.js"
      ? { type: "text/javascript", body: createOfflineAppShell(`browser-${release}`, [...files.keys()].filter((key) => key !== "/").map((key) => key.slice(1))) }
      : files.get(path);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("This release no longer contains that asset");
      return;
    }
    response.writeHead(200, { "content-type": file.type });
    response.end(file.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture server port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    publish(next: Release) { release = next; },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

async function workerState(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      waiting: registration?.waiting?.state ?? null,
      caches: (await caches.keys()).sort(),
      release: document.querySelector("h1")?.textContent,
      feature: document.querySelector("#result")?.textContent,
      draft: localStorage.getItem("unsynced-workout"),
    };
  });
}

test("a waiting release preserves the open app offline and activates after all old clients close", async ({ page, context, request, browserName }, testInfo) => {
  test.skip(browserName === "webkit", "Playwright WebKit's offline navigation engine is excluded consistently with local-offline-shell.spec.ts; verify installed Safari on an Apple device");
  const host = await serveReleases();
  const marker = "Unsynced workout stays intact through the update";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(host.origin, { waitUntil: "load" });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    // First installation activates but deliberately does not claim this document.
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    await page.reload({ waitUntil: "load" });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(page.getByRole("heading", { name: "Release a" })).toBeVisible();
    await page.getByRole("textbox", { name: "Workout note" }).fill(marker);
    await expect(page.getByRole("status")).toBeEmpty();
    const installed = await workerState(page);
    expect(installed.caches).toHaveLength(1);
    expect(installed.caches[0]).toContain("browser-a-");

    host.publish("b");
    // Prove the origin has removed the old lazy chunk; success later must come
    // from the old worker's installed cache, not a forgiving asset server.
    expect((await request.get(`${host.origin}/assets/feature-a.js`)).status()).toBe(404);
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe("installed");
    const waiting = await workerState(page);
    expect(waiting.caches.some((name) => name.includes("browser-a-"))).toBe(true);
    expect(waiting.caches.some((name) => name.includes("browser-b-"))).toBe(true);
    expect(waiting.release).toBe("Release a");
    expect(waiting.draft).toBe(marker);

    // An online reload must not combine the new document with the old worker.
    const oldDocument = await page.reload({ waitUntil: "load" });
    if (browserName === "chromium") expect(oldDocument?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole("heading", { name: "Release a" })).toBeVisible();
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Workout note" })).toHaveValue(marker);
    await page.getByRole("button", { name: "Open lazy feature" }).click();
    await expect(page.getByRole("status")).toHaveText("Lazy feature a");
    const oldOffline = await workerState(page);
    expect(oldOffline.waiting).toBe("installed");
    await testInfo.attach("old-release-offline", { body: await page.screenshot(), contentType: "image/png" });

    // Close every controlled page. The next worker may now activate naturally,
    // with its already downloaded shell available even while still offline.
    await page.close();
    const reopened = await context.newPage();
    reopened.on("pageerror", (error) => errors.push(error.message));
    await reopened.goto(host.origin, { waitUntil: "domcontentloaded" });
    await expect(reopened.getByRole("heading", { name: "Release b" })).toBeVisible();
    await expect(reopened.getByRole("textbox", { name: "Workout note" })).toHaveValue(marker);
    await reopened.getByRole("button", { name: "Open lazy feature" }).click();
    await expect(reopened.getByRole("status")).toHaveText("Lazy feature b");
    await expect.poll(async () => (await workerState(reopened)).caches).toHaveLength(1);
    const newOffline = await workerState(reopened);
    expect(newOffline.controlled).toBe(true);
    expect(newOffline.waiting).toBeNull();
    expect(newOffline.caches[0]).toContain("browser-b-");
    expect(errors).toEqual([]);
    await testInfo.attach("new-release-offline", { body: await reopened.screenshot(), contentType: "image/png" });
    await testInfo.attach("upgrade-evidence", {
      body: Buffer.from(JSON.stringify({ browserName, installed, waiting, oldOffline, newOffline, errors, requests: host.requests }, null, 2)),
      contentType: "application/json",
    });
  } finally {
    await context.setOffline(false);
    await host.close();
  }
});
