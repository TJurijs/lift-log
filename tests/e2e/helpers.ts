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
      "TEST_PERSONA_PASSWORD is required for hosted-development persona tests.",
    );
  }

  return personaPassword;
}

export async function signInAsTestPersona(page: Page, personaName: string) {
  const environment = loadEnv("nonprod", process.cwd(), "");
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
