import { expect, test } from "@playwright/test";
import { signInAsTestPersona } from "./helpers";

test.skip((process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Local Docker data only");

test("athlete selection, tabs and nested training keep browser Back and Forward consistent", async ({ page }, testInfo) => {
  if (testInfo.project.name.startsWith("mobile")) await page.setViewportSize({ width: 320, height: 844 });
  await signInAsTestPersona(page, "Raimonds Vējonis");
  await page.getByRole("button", { name: "Coaching", exact: true }).click();
  await page.getByRole("tab", { name: "My athletes", exact: true }).click();
  await page.getByRole("button", { name: /^Open Guntis Ulmanis,/ }).click();
  const athlete = page.locator(".coach-athlete-header");
  await expect(athlete).toContainText("Guntis Ulmanis");
  await expect(page.getByRole("tab", { name: "Plan", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page.locator(".coach-workspace")).not.toHaveClass(/mobile-detail-open/);
  await page.goForward();
  await expect(athlete).toContainText("Guntis Ulmanis");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  const pastProgram = page.getByRole("button", { name: "Open Aerobic Support", exact: true });
  await expect(pastProgram).toContainText("Completed");
  await page.reload();
  await expect(athlete).toContainText("Guntis Ulmanis");
  await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(pastProgram).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  await pastProgram.click();
  await expect(page.getByRole("heading", { name: "Aerobic Support", exact: true })).toBeVisible();
  await page.goBack();
  await expect(athlete).toContainText("Guntis Ulmanis");
  await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(pastProgram).toBeVisible();
  await page.locator(".coach-history-list > button").first().click();
  await expect(page.getByRole("heading", { name: "Workout results", exact: true })).toBeVisible();
  await page.goBack();
  await expect(athlete).toContainText("Guntis Ulmanis");
  await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page.locator(".coach-workspace")).not.toHaveClass(/mobile-detail-open/);
  await page.goForward();
  await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
  if (testInfo.project.name.startsWith("mobile")) {
    await expect(page.getByRole("button", { name: "Back to My athletes", exact: true })).toBeVisible();
    await expect(page.locator(".mobile-topbar")).toBeHidden();
  }
});

test("secondary exercise actions keep their identity and keyboard focus", async ({ page }) => {
  await signInAsTestPersona(page, "Raimonds Vējonis");
  await page.getByRole("button", { name: "Exercises", exact: true }).click();
  await page.getByRole("tab", { name: "My exercises", exact: true }).click();
  await expect(page.locator("#exercise-library-results")).toHaveAttribute("aria-busy", "false");
  const row = page.locator(".exercise-list-row").first();
  const more = row.locator("summary");
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(row.getByRole("button", { name: /^Edit / })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(row.getByRole("button", { name: /^Edit / })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await expect(row.getByRole("button", { name: /^Delete / })).toBeHidden();
  await more.click();
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});
