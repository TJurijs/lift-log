import { expect, test } from "@playwright/test";
import { signInAsTestPersona } from "./helpers";

test("the enabled authenticated telemetry transport delivers a sanitized envelope to the local collector", async ({ page }, testInfo) => {
  test.skip(process.env.PLAYWRIGHT_REMOTE_TELEMETRY !== "1" || (process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Requires the local build with telemetry enabled");
  test.skip(testInfo.project.name !== "desktop-chromium", "One real transport verification");
  test.setTimeout(45_000);
  await signInAsTestPersona(page, "Edgars Rinkēvičs");
  const acknowledged = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/rest/v1/rpc/collect_client_telemetry" && response.request().method() === "POST",
  { timeout: 35_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("liftlog:telemetry", { detail: {
    schemaVersion: 1, releaseSha: "test", environment: "test", recordedAt: new Date().toISOString(),
    kind: "performance", payload: { name: "navigation", durationMs: 12, privateNote: "must never leave browser" },
    athleteId: "must never leave browser",
  } })));
  const response = await acknowledged;
  expect(response.ok()).toBe(true);
  expect(JSON.stringify(response.request().postDataJSON())).not.toContain("must never leave browser");
  expect(response.request().postDataJSON().events).toContainEqual(expect.objectContaining({
    releaseSha: "test", payload: { name: "navigation", durationMs: 12 },
  }));
  expect((await response.json()).accepted).toBeGreaterThan(0);
});
