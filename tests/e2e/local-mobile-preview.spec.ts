import { expect, test } from "@playwright/test";
import { signInAsTestPersona } from "./helpers";

test("mobile preview loads the signed-in app and changes viewport without resetting navigation", async ({ page }, testInfo) => {
  test.skip((process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Local Docker Supabase only");
  test.skip(!["desktop-chromium", "mobile-webkit"].includes(testInfo.project.name), "Preview integration coverage");
  await page.setViewportSize({ width: 1280, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signInAsTestPersona(page, "Raimonds Vējonis");
  await page.goto("/?preview=mobil#/program");

  const viewport = page.getByRole("combobox", { name: "Viewport", exact: true });
  await expect(viewport).toBeVisible();
  const frameElement = page.getByTitle("Lift Log mobile preview", { exact: true });
  await expect(frameElement).toHaveAttribute("src", /\?preview=mobile&preview_frame=1#\/program$/);
  const frame = page.frameLocator('iframe[title="Lift Log mobile preview"]');
  await expect(frame.getByRole("heading", { name: "Programs", exact: true })).toBeVisible();
  await expect(frame.locator("html")).toHaveClass(/dev-mobile-preview-frame/);
  await expect(frame.locator("iframe")).toHaveCount(0);
  await expect.poll(() => frame.locator("html").evaluate((element) => element.ownerDocument.defaultView?.innerWidth)).toBe(393);

  await frame.getByRole("button", { name: "Exercises", exact: true }).click();
  await expect(frame.getByRole("heading", { name: "Exercises", exact: true })).toBeVisible();
  await expect(frame.locator("#exercise-library-results")).toHaveAttribute("aria-busy", "false");
  const frameUrl = await frameElement.getAttribute("src");
  await viewport.selectOption("samsung-a54");
  await expect.poll(() => frame.locator("html").evaluate((element) => element.ownerDocument.defaultView?.innerWidth)).toBe(412);
  await expect(frameElement).toHaveAttribute("src", frameUrl!);
  await expect(frame.getByRole("heading", { name: "Exercises", exact: true })).toBeVisible();
  await expect.poll(() => frame.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-preview.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("Google sign-in leaves the preview frame and returns to the outer preview", async ({ page }, testInfo) => {
  test.skip((process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Local Docker Supabase only");
  test.skip(!["desktop-chromium", "mobile-webkit"].includes(testInfo.project.name), "Preview integration coverage");
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      await route.abort("blockedbyclient");
      throw new Error(`Preview sign-in test blocked external origin ${url.origin}`);
    }
    await route.continue();
  });
  let handoff: { topLevel: boolean; returnUrl: string | null } | undefined;
  await page.route(/\/auth\/v1\/authorize\?/u, async (route) => {
    const url = new URL(route.request().url());
    handoff = { topLevel: route.request().frame() === page.mainFrame(), returnUrl: url.searchParams.get("redirect_to") };
    await route.fulfill({ contentType: "text/html", body: "<h1>OAuth handoff captured</h1>" });
  });
  await page.goto("/?preview=mobile&coach_invite=preview-test");
  const frame = page.frameLocator('iframe[title="Lift Log mobile preview"]');
  await frame.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "OAuth handoff captured", exact: true })).toBeVisible();
  expect(handoff?.topLevel).toBe(true);
  const returnUrl = new URL(handoff!.returnUrl!);
  expect(returnUrl.searchParams.get("preview")).toBe("mobile");
  expect(returnUrl.searchParams.has("preview_frame")).toBe(false);
  expect(returnUrl.searchParams.get("coach_invite")).toBe("preview-test");
});
