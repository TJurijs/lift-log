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

/** The previous Saved indicator can remain visible during the autosave delay. */
export async function waitForWorkoutNoteSave(
  page: Page,
  expectedNote: string,
  action: () => Promise<void>,
) {
  const acknowledged = page.waitForResponse((response) => {
    if (
      new URL(response.url()).pathname !== "/rest/v1/rpc/save_workout_session_draft" ||
      response.request().method() !== "POST" ||
      !response.ok()
    ) return false;
    const payload = response.request().postDataJSON();
    return payload?.draft_payload?.sessionNote === expectedNote;
  }, { timeout: 15_000 });
  // Arm the listener before typing/reconnecting; an already-pending autosave
  // may be acknowledged immediately after the browser comes back online.
  const [, response] = await Promise.all([action(), acknowledged]);
  const payload = response.request().postDataJSON();
  const result = await response.json();
  expect(result.revision, "The server must acknowledge this exact workout draft").toBe(payload.expected_revision + 1);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });
}

export async function fillWorkoutNoteAndWaitForSave(page: Page, value: string) {
  const note = page.getByRole("textbox", { name: "Session notes optional" });
  await expect(note).toBeEnabled();
  if (await note.inputValue() === value) {
    // Cleanup may run before the test made an edit; a no-op emits no save RPC.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });
    return;
  }
  await waitForWorkoutNoteSave(page, value, () => note.fill(value));
}
