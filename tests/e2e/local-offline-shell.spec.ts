import { expect, test } from "@playwright/test";
import { fillWorkoutNoteAndWaitForSave, signInAsTestPersona, waitForWorkoutNoteSave } from "./helpers";

test("the built local app reloads a saved workout with no network", async ({ page, context, browserName }) => {
  test.skip(process.env.PLAYWRIGHT_BUILT_UI !== "1" || (process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Requires the built local preview and Docker Supabase");
  test.skip(browserName === "webkit", "Playwright WebKit fails full offline navigation inside the engine; verify this path on supported Apple devices");
  await signInAsTestPersona(page, "Jānis Čakste");
  const note = page.getByRole("textbox", { name: "Session notes optional" });
  await expect(note).toBeEnabled();
  const original = await note.inputValue();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const marker = `Offline full reload ${Date.now()}`;
  try {
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await note.fill(marker);
    await expect(page.getByText("Saved on this device · reconnect to sync", { exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(note).toBeEnabled();
    await expect(note).toHaveValue(marker);
    await waitForWorkoutNoteSave(page, marker, async () => {
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
    });
  } finally {
    await context.setOffline(false);
    if (!page.isClosed()) await fillWorkoutNoteAndWaitForSave(page, original);
  }
});
