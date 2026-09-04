import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAsTestPersona } from "./helpers";

test.skip((process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Local Docker Supabase only");

test("exercise search recovery and coach detail screens remain usable", async ({ page }, testInfo) => {
  test.skip(!["desktop-chromium", "mobile-webkit"].includes(testInfo.project.name), "Desktop and narrow mobile review");
  if (testInfo.project.name === "mobile-webkit") await page.setViewportSize({ width: 390, height: 844 });
  await signInAsTestPersona(page, "Raimonds Vējonis");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Exercises", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search exercises", exact: true });
  await search.fill("no-such-exercise-review-check");
  await expect(page.getByRole("heading", { name: "No exercises match" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(search).toHaveValue("");
  await expect(page.locator("#exercise-library-results")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".exercise-list-row").first()).toBeVisible();
  await page.getByRole("tab", { name: "My exercises", exact: true }).click();
  await expect(page.getByRole("tab", { name: "My exercises", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#exercise-library-results")).toHaveAttribute("aria-busy", "false");
  await page.screenshot({ path: testInfo.outputPath("exercise-library.png"), fullPage: true });

  await page.getByRole("button", { name: "Coaching", exact: true }).click();
  await page.getByRole("tab", { name: "My athletes", exact: true }).click();
  await page.getByRole("button", { name: /^Open .+, \d+ active training plans?$/ }).first().click();
  for (const section of ["Plan", "History"]) {
    await page.getByRole("tab", { name: section, exact: true }).click();
    await expect(page.getByRole("tab", { name: section, exact: true })).toHaveAttribute("aria-selected", "true");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    await page.screenshot({ path: testInfo.outputPath(`coach-${section.toLowerCase()}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
