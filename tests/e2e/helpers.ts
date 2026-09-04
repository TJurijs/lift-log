import { expect, type Page } from "@playwright/test";
import { loadEnv } from "vite";
import { signInSeededPersona } from "../../scripts/lib/test-persona-browser-auth.mjs";

let personaPassword: string | undefined;

function getPersonaPassword() {
  if (!personaPassword) {
    try {
      process.loadEnvFile(".env.test-personas");
    } catch {
      // CI may provide the secret directly instead of a local env file.
    }
    personaPassword = process.env.TEST_PERSONA_PASSWORD;
  }

  if (!personaPassword) {
    throw new Error(
      "TEST_PERSONA_PASSWORD is required for seeded persona tests.",
    );
  }

  return personaPassword;
}

export async function signInAsTestPersona(page: Page, personaName: string) {
  const local = (process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") === "local";
  const environment = loadEnv(local ? "localdev" : "nonprod", process.cwd(), "");
  if (local) {
    const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
    if (!allowedHosts.has(new URL(environment.VITE_SUPABASE_URL).hostname)) {
      throw new Error("Local browser tests require a loopback Supabase URL.");
    }
    await page.context().route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && !allowedHosts.has(url.hostname)) {
        await route.abort("blockedbyclient");
        throw new Error(`Local browser test blocked an external request to ${url.origin}.`);
      }
      await route.continue();
    });
  }
  await signInSeededPersona(page, {
    personaName,
    password: getPersonaPassword(),
    supabaseUrl: environment.VITE_SUPABASE_URL,
    publishableKey: environment.VITE_SUPABASE_PUBLISHABLE_KEY,
    appUrl: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
  });
  await expect(
    page.getByRole("button", { name: "Next workouts", exact: true }),
  ).toBeVisible();
}
