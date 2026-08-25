import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "@playwright/test";

try {
  process.loadEnvFile(".env.test-personas");
} catch {
  // CI and review environments may provide the secret directly.
}

const password = process.env.TEST_PERSONA_PASSWORD;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const target = new URL(baseUrl);
if (!password) throw new Error("TEST_PERSONA_PASSWORD is required.");
if (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname)) {
  throw new Error("Review screenshots may only be captured from a loopback app origin.");
}

const evidenceDir = new URL("../docs/review/evidence/phase-6/", import.meta.url);
await mkdir(evidenceDir, { recursive: true });

function evidencePath(filename) {
  return fileURLToPath(new URL(filename, evidenceDir));
}

async function signIn(page) {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: /Test population/i }).click();
  await page
    .getByPlaceholder("Enter once, then choose an account")
    .fill(password);
  await page.getByRole("button", { name: /Jānis Čakste/i }).click();
  await page.getByRole("heading", { name: "Next workouts" }).waitFor();
}

const browser = await chromium.launch();
try {
  const desktop = await browser.newContext({
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  });
  const desktopPage = await desktop.newPage();
  await signIn(desktopPage);
  await desktopPage.getByRole("button", { name: "Calendar", exact: true }).click();
  await desktopPage.getByRole("heading", { name: "Calendar", exact: true }).waitFor();
  await desktopPage.screenshot({
    path: evidencePath("calendar-desktop-1440x900.png"),
    fullPage: true,
  });
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  const mobilePage = await mobile.newPage();
  await signIn(mobilePage);
  await mobilePage.getByRole("button", { name: "Calendar", exact: true }).click();
  await mobilePage.getByRole("heading", { name: "Calendar", exact: true }).waitFor();
  await mobilePage.screenshot({
    path: evidencePath("calendar-mobile-360x800.png"),
    fullPage: true,
  });
  await mobilePage.getByRole("button", { name: "Exercises", exact: true }).click();
  await mobilePage
    .getByRole("heading", { name: "Exercises", exact: true })
    .waitFor();
  await mobilePage.screenshot({
    path: evidencePath("exercises-mobile-native-filters-360x800.png"),
    fullPage: true,
  });
  await mobile.close();
} finally {
  await browser.close();
}

console.log("Captured Phase 6 review screenshots from the loopback hosted-dev app.");
