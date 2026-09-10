import { defineConfig, devices } from "@playwright/test";

/** A real service-worker browser test, independent of Vite and Supabase. */
export default defineConfig({
  testDir: ".",
  testMatch: "offline-release-upgrade.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 45_000,
  outputDir: "../../artifacts/astra-review/offline-upgrade",
  reporter: [
    ["list"],
    ["json", { outputFile: "../../artifacts/astra-review/offline-upgrade-results.json" }],
  ],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
