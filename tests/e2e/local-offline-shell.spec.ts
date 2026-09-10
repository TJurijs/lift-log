import { expect, test } from "@playwright/test";
import { fillWorkoutNoteAndWaitForSave, installLocalRequestGuard, signInAsTestPersona, waitForWorkoutNoteSave } from "./helpers";

test("the built local app reloads a saved workout with no network", async ({ page, context, browserName }) => {
  test.skip(process.env.PLAYWRIGHT_BUILT_UI !== "1" || (process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Requires the built local preview and Docker Supabase");
  test.skip(browserName === "webkit", "Playwright WebKit fails full offline navigation inside the engine; verify this path on supported Apple devices");
  await signInAsTestPersona(page, "Jānis Čakste");
  const note = page.getByRole("textbox", { name: "Session notes optional" });
  await expect(note).toBeEnabled();
  const original = await note.inputValue();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // First installation intentionally leaves the existing document uncontrolled;
  // a fresh navigation selects the installed worker without clients.claim().
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(note).toBeEnabled();
  }
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const marker = `Offline full reload ${Date.now()}`;
  let guardSuspended = false;
  let primaryFailure: unknown;
  const reconnect = async () => {
    // Restore the external destination guard before networking is available.
    if (guardSuspended) {
      await installLocalRequestGuard(context);
      guardSuspended = false;
    }
    await context.setOffline(false);
  };
  try {
    await context.setOffline(true);
    // Playwright's Firefox interception bypasses offline worker navigations,
    // even when no URL matches a route. Disable interception only while offline.
    await context.unrouteAll({ behavior: "wait" });
    guardSuspended = true;
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await note.fill(marker);
    await expect(page.getByText("Saved on this device · reconnect to sync", { exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(note).toBeEnabled();
    await expect(note).toHaveValue(marker);
    await waitForWorkoutNoteSave(page, marker, async () => {
      await reconnect();
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
    });
  } catch (error) {
    primaryFailure = error;
  } finally {
    try {
      await reconnect();
      if (!page.isClosed()) {
        if (!await note.isVisible()) await page.reload({ waitUntil: "domcontentloaded" });
        await fillWorkoutNoteAndWaitForSave(page, original);
      }
    } catch (error) {
      // Preserve the failed offline navigation instead of masking it with
      // a missing-input assertion from the engine's error document.
      primaryFailure ??= error;
    }
  }
  if (primaryFailure) throw primaryFailure;
});
