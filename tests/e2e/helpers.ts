import { expect, type Page } from "@playwright/test";

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
  await page.goto("/");
  await page.getByRole("button", { name: /Test population/i }).click();
  await page
    .getByPlaceholder("Enter once, then choose an account")
    .fill(getPersonaPassword());
  await page.getByRole("button", { name: new RegExp(personaName, "i") }).click();
  await expect(page.getByRole("heading", { name: "Next workouts" })).toBeVisible();
}
