import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAsTestPersona } from "./helpers";

test.describe.configure({ mode: "serial" });

test("public sign-in shell has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter(({ impact }) =>
    impact === "serious" || impact === "critical"
  );

  expect(seriousViolations).toEqual([]);
});

test("fictional athlete can read the core training views", async ({ page }, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith("desktop-"),
    "The authenticated core-view journey runs once per desktop engine",
  );
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await signInAsTestPersona(page, "Jānis Čakste");
  await page.getByRole("button", { name: "Programs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Programs", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Exercises", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Exercises", exact: true }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("mobile Next view reflows without document overflow", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile-"), "Mobile viewport assertion");
  await signInAsTestPersona(page, "Jānis Čakste");

  for (const width of [320, 360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1024 });
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(
      dimensions.scrollWidth,
      `Next workouts must not overflow at a ${width}px viewport`,
    ).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test("mobile Calendar exposes a full-size native day target and selected-day agenda", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile-"), "Mobile viewport assertion");
  await page.setViewportSize({ width: 320, height: 700 });
  await signInAsTestPersona(page, "Jānis Čakste");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();

  const dayTarget = page.locator(".calendar-day:not(.empty) .calendar-day-select").first();
  await expect(dayTarget).toBeVisible();
  await expect(page.locator(".calendar-day-agenda")).toBeVisible();
  expect(await dayTarget.evaluate((element) => element.querySelector("button"))).toBeNull();

  const targetBox = await dayTarget.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(targetBox!.width).toBeGreaterThanOrEqual(44);
  expect(targetBox!.height).toBeGreaterThanOrEqual(44);
  await dayTarget.tap();
  await expect(dayTarget).toHaveAttribute("aria-pressed", "true");

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
