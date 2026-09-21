import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { loadEnv } from "vite";
import { signInAsTestPersona } from "./helpers";

test.skip((process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Disposable local Docker data only");

async function fixtureClient() {
  const environment = loadEnv("localdev", process.cwd(), "");
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(environment.VITE_SUPABASE_URL).hostname);
  const client = createClient(environment.VITE_SUPABASE_URL, environment.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authenticated = await client.auth.signInWithPassword({
    email: "raimonds-vejonis@presidents.liftlog.test", password: process.env.TEST_PERSONA_PASSWORD!,
  });
  expect(authenticated.error?.message).toBeUndefined();
  const profile = await client.from("profiles").select("account_kind,test_persona_key").eq("id", authenticated.data.user!.id).single();
  expect(profile.data?.account_kind).toBe("test");
  expect(profile.data?.test_persona_key).toBe("latvian-presidents-v1:raimonds-vejonis");
  return client;
}

async function rpcAfter(page: Page, name: string, action: () => Promise<void>) {
  const received = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/rest/v1/rpc/${name}` && response.request().method() === "POST",
  );
  await action();
  const response = await received;
  expect(response.ok(), `${name} succeeds`).toBeTruthy();
  return response.json();
}

async function assertEditorActions(page: Page) {
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  for (const action of ["Start workout", "Repeat", "Assign to athletes", "Set dates", "Change dates"]) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
}

test("workout authoring uses a highlighted list, optional estimates, and workout-only custom exercises", async ({ page }, testInfo) => {
  test.skip(!["desktop-chromium", "mobile-webkit"].includes(testInfo.project.name), "One desktop and one mobile authoring journey");
  test.setTimeout(120_000);
  const title = `Authoring ${testInfo.project.name} ${Date.now()}`;
  const customName = `My clean and press ${Date.now()}`;
  const programIds: string[] = [], browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await signInAsTestPersona(page, "Raimonds Vējonis");
  const client = await fixtureClient();
  try {
    await page.getByRole("button", { name: "Training", exact: true }).click();
    await page.locator(".program-create-menu summary").click();
    await page.getByRole("button", { name: "Program A sequence of workouts", exact: true }).click();
    const create = page.getByRole("dialog", { name: /^Create a program for / });
    await create.getByRole("textbox", { name: "Program name", exact: true }).fill(title);
    const programId = await rpcAfter(page, "create_blank_program", () => create.getByRole("button", { name: "Create program", exact: true }).click());
    programIds.push(programId);
    await assertEditorActions(page);

    async function addWorkout(name: string) {
      await page.getByRole("button", { name: "Add workout", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add a workout", exact: true });
      await expect(dialog.getByText(/athlete chooses|ordered in the plan|calendar date separately/i)).toHaveCount(0);
      await dialog.getByRole("textbox", { name: "Workout name", exact: true }).fill(name);
      const workout = await rpcAfter(page, "append_program_workout", () => dialog.getByRole("button", { name: "Add workout", exact: true }).click());
      expect(workout.estimatedMinutes).toBeNull();
      await expect(dialog).toHaveCount(0);
      return workout;
    }
    const first = await addWorkout("Strength A");
    await addWorkout("Strength B");
    const workoutList = page.locator(".workout-list-items");
    const firstRow = workoutList.getByRole("button", { name: "1 Strength A", exact: true });
    const secondRow = workoutList.getByRole("button", { name: "2 Strength B", exact: true });
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toHaveAttribute("aria-pressed", "true");
    await firstRow.click();
    await expect(firstRow).toHaveAttribute("aria-pressed", "true");
    await expect(secondRow).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("combobox", { name: /Workout/ })).toHaveCount(0);
    const detailsButton = page.getByRole("button", { name: "Edit details for Strength A", exact: true });
    await expect(detailsButton).toHaveText("");
    await detailsButton.click();
    let details = page.getByRole("dialog", { name: "Workout details", exact: true });
    await expect(details.getByRole("spinbutton", { name: "Duration (minutes) optional", exact: true })).toHaveValue("");
    await details.getByRole("spinbutton", { name: "Duration (minutes) optional", exact: true }).fill("35");
    await details.getByRole("button", { name: "Save workout", exact: true }).click();
    await expect(details).toHaveCount(0);
    await expect(page.locator(".editor-heading")).toContainText("35 min");
    await detailsButton.click();
    details = page.getByRole("dialog", { name: "Workout details", exact: true });
    await expect(details.getByRole("spinbutton", { name: "Duration (minutes) optional", exact: true })).toHaveValue("35");
    await details.getByRole("spinbutton", { name: "Duration (minutes) optional", exact: true }).fill("");
    await details.getByRole("button", { name: "Save workout", exact: true }).click();
    await expect(details).toHaveCount(0);
    await expect(page.locator(".editor-heading")).not.toContainText(/\d+ min/);
    const durationRow = await client.from("workouts").select("estimated_minutes").eq("id", first.id).single();
    expect(durationRow.error?.message).toBeUndefined();
    expect(durationRow.data!.estimated_minutes).toBeNull();

    await page.getByRole("button", { name: "Add exercise", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Add exercise", exact: true });
    const search = picker.getByRole("textbox", { name: "Search exercises", exact: true });
    await expect(search).toHaveAttribute("placeholder", "Search or add exercise");
    await search.fill("Back squat");
    await expect(picker.locator(".picker-result-main").filter({ has: page.getByText("Back squat", { exact: true }) }).first()).toBeVisible();
    await search.fill(customName);
    await expect(picker.getByRole("button", { name: `Add ${customName} to this workout`, exact: true })).toBeVisible();
    const item = await rpcAfter(page, "append_custom_workout_exercise", () => search.press("Enter"));
    expect(item.sourceExerciseId).toBeNull();
    expect(item.trackingFields).toEqual(["reps", "load"]);
    const prescription = page.getByRole("dialog", { name: `Prescribe ${customName}`, exact: true });
    await expect(prescription.getByRole("combobox", { name: "Record", exact: true })).toHaveValue("weighted_repetitions");
    await prescription.locator("summary").filter({ hasText: "Customize optional fields" }).click();
    await expect(prescription.getByRole("checkbox", { name: "RPE", exact: true })).not.toBeChecked();
    await prescription.getByRole("textbox", { name: "Repetitions", exact: true }).fill("5");
    await prescription.getByRole("button", { name: "Save", exact: true }).click();
    await expect(prescription).toHaveCount(0);
    const libraryRows = await client.from("exercises").select("id").eq("name", customName);
    expect(libraryRows.error?.message).toBeUndefined();
    expect(libraryRows.data).toEqual([]);
    await assertEditorActions(page);
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    await page.screenshot({ path: testInfo.outputPath("simplified-workout-editor.png"), fullPage: true });

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    for (const action of ["Start workout", "Repeat", "Assign to athletes", "Set dates", "Edit"]) {
      await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Add exercise", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await assertEditorActions(page);
    await page.getByRole("button", { name: `Edit ${customName}`, exact: true }).click();
    const reopened = page.getByRole("dialog", { name: `Prescribe ${customName}`, exact: true });
    await expect(reopened.getByRole("textbox", { name: "Repetitions", exact: true })).toHaveValue("5");
    await reopened.getByRole("button", { name: "Save", exact: true }).click();
    await expect(reopened).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText(customName, { exact: true })).toBeVisible();
    expect(browserErrors).toEqual([]);
  } finally {
    for (const id of programIds) {
      const result = await client.rpc("delete_own_program", { target_program_id: id });
      expect(result.error?.message, "Archive only this test's own program").toBeUndefined();
    }
    await client.auth.signOut();
  }
});
