import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAsTestPersona } from "./helpers";

test.skip((process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Disposable local Docker data only");

test("authenticated sections have consistent accessible layouts", async ({ page }, testInfo) => {
  await signInAsTestPersona(page, "Raimonds Vējonis");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const section of ["Next workouts", "Programs", "Calendar", "Exercises", "Coaching"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.locator(".feature-load-status .spin")).toHaveCount(0);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(size.scroll, `${section} should fit the viewport`).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: testInfo.outputPath(`${section.toLowerCase().replaceAll(" ", "-")}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("local workout edits survive reload, offline editing and reconnect", async ({ page }, testInfo) => {
  test.skip(!["desktop-chromium", "mobile-webkit"].includes(testInfo.project.name), "One desktop and one mobile lifecycle");
  await signInAsTestPersona(page, "Jānis Čakste");
  const note = page.getByRole("textbox", { name: "Session notes optional" });
  const resume = page.getByRole("button", { name: "Resume workout", exact: true });
  const start = page.getByRole("button", { name: "Start workout", exact: true }).first();
  await expect(note.or(resume).or(start).first()).toBeVisible();
  let startedHere = false;
  if (await note.isVisible()) {
    // A restored active session opens directly in the logger.
  } else if (await resume.isVisible()) {
    await resume.click();
  } else {
    await start.click();
    startedHere = true;
  }
  await expect(note).toBeVisible();
  await expect(note).toBeEnabled();
  const original = await note.inputValue();
  const marker = `Local stability ${testInfo.project.name} ${Date.now()}`;
  try {
    await note.fill(marker);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(note).toHaveValue(marker);
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await note.fill(`${marker} offline`);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await expect(page.getByText("Saved on this device · reconnect to sync", { exact: true })).toBeVisible();
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(note).toHaveValue(`${marker} offline`);
    await page.screenshot({ path: testInfo.outputPath("workout-recovered.png"), fullPage: true });
  } finally {
    await page.context().setOffline(false);
    if (!page.isClosed()) {
      await note.fill(original);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15000 });
      if (startedHere) await page.getByRole("button", { name: "Set back to planned", exact: true }).click();
    }
  }
});

test("a program can be authored, saved, reopened and removed through the local UI", async ({ page }, testInfo) => {
  test.skip(!["desktop-chromium", "mobile-webkit"].includes(testInfo.project.name), "One desktop and one mobile authoring journey");
  const name = `Review program ${testInfo.project.name} ${Date.now()}`;
  await signInAsTestPersona(page, "Gustavs Zemgals");
  await page.getByRole("button", { name: "Programs", exact: true }).click();
  await page.locator(".program-create-menu summary").click();
  await page.getByRole("button", { name: "Program Multiple ordered workouts", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Program name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create program", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Program name", exact: true })).toHaveValue(name);
  await page.getByRole("button", { name: "Add workout", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Workout name", exact: true }).fill("Review strength workout");
  await page.getByRole("dialog").getByRole("button", { name: "Add workout", exact: true }).click();
  await page.getByRole("button", { name: "Add exercise", exact: true }).click();
  await page.getByRole("textbox", { name: "Search exercises", exact: true }).fill("Back squat");
  await page.locator(".picker-result-main").filter({ hasText: "Back squat" }).first().click();
  await page.getByRole("dialog", { name: "Prescribe Back squat" }).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Back squat", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Program navigation" }).getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Programs", exact: true }).click();
  await page.getByRole("button", { name: `Edit ${name} program`, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Program name", exact: true })).toHaveValue(name);
  await expect(page.getByRole("button", { name: "Edit Back squat", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("program-authored.png"), fullPage: true });
  await page.getByRole("button", { name: "Programs", exact: true }).click();
  await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete program", exact: true }).click();
  await expect(page.getByRole("button", { name: `Delete ${name}`, exact: true })).toHaveCount(0);
});

test("only one tab edits a workout and takeover restores the latest save", async ({ page, context }, testInfo) => {
  test.skip(!["desktop-chromium", "mobile-webkit"].includes(testInfo.project.name), "One desktop and one mobile cross-tab journey");
  await signInAsTestPersona(page, "Jānis Čakste");
  const note = page.getByRole("textbox", { name: "Session notes optional" });
  await expect(note).toBeEnabled();
  const original = await note.inputValue();
  const marker = `Local tab takeover ${Date.now()}`;
  const second = await context.newPage();
  try {
    await second.goto("/");
    await expect(second.getByText("This workout is open for editing in another tab. Close it there, then try again.")).toBeVisible();
    const secondNote = second.getByRole("textbox", { name: "Session notes optional" });
    await expect(secondNote).toBeDisabled();
    await expect(second.getByRole("button", { name: "Finish and save session", exact: true })).toBeDisabled();
    await expect(second.getByRole("button", { name: "Set back to planned", exact: true })).toBeDisabled();
    await note.fill(marker);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15000 });
    await page.close();
    await second.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(secondNote).toBeEnabled();
    await expect(secondNote).toHaveValue(marker);
    await secondNote.fill(original);
    await expect(second.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15000 });
  } finally {
    await second.close();
  }
});
