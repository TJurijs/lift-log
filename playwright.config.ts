import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const dataEnvironment = process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local";
if (!["local", "hosted-dev"].includes(dataEnvironment)) {
  throw new Error("PLAYWRIGHT_DATA_ENVIRONMENT must be local or hosted-dev.");
}
const appUrl = new URL(baseURL);
if (appUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(appUrl.hostname)) {
  throw new Error("Browser tests require a loopback HTTP frontend.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: dataEnvironment === "local" ? "npm run dev:local" : "npm run dev:hosted",
    reuseExistingServer: true,
    url: baseURL,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop-firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
