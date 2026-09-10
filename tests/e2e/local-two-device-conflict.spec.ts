import { expect, test } from "@playwright/test";
import { fillWorkoutNoteAndWaitForSave, signInAsTestPersona, waitForWorkoutNoteSave } from "./helpers";

test("two independent devices recover a same-field conflict without losing the selected draft", async ({ page, browser }, testInfo) => {
  test.skip((process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Local fixture accounts only");
  test.skip(!["desktop-chromium", "mobile-webkit"].includes(testInfo.project.name), "Desktop and phone conflict journeys");
  test.setTimeout(45_000);
  await signInAsTestPersona(page, "Jānis Čakste");
  const localNote = page.getByRole("textbox", { name: "Session notes optional" });
  await expect(localNote).toBeEnabled();
  const original = await localNote.inputValue();
  // A separate browser context has its own device storage and editing lease.
  const otherDevice = await browser.newContext();
  const otherPage = await otherDevice.newPage();
  const marker = `Two-device recovery ${Date.now()}`;
  try {
    await signInAsTestPersona(otherPage, "Jānis Čakste");
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await localNote.fill(`${marker} local`);
    await expect(page.getByText("Saved on this device · reconnect to sync", { exact: true })).toBeVisible();
    await fillWorkoutNoteAndWaitForSave(otherPage, `${marker} remote`);
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const keepLocal = page.getByRole("button", { name: "Keep this device", exact: true });
    await expect(keepLocal).toBeVisible({ timeout: 15_000 });
    await waitForWorkoutNoteSave(page, `${marker} local`, () => keepLocal.click());
    await expect(localNote).toHaveValue(`${marker} local`);
    await otherPage.reload();
    await expect(otherPage.getByRole("textbox", { name: "Session notes optional" })).toHaveValue(`${marker} local`);
    await page.screenshot({ path: testInfo.outputPath("two-device-recovered.png"), fullPage: true });
  } finally {
    await page.context().setOffline(false);
    await otherDevice.close();
    const keepLocal = page.getByRole("button", { name: "Keep this device", exact: true });
    if (await keepLocal.isVisible()) await keepLocal.click();
    await fillWorkoutNoteAndWaitForSave(page, original);
  }
});
