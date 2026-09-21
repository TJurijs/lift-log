import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
    email: "gustavs-zemgals@presidents.liftlog.test",
    password: process.env.TEST_PERSONA_PASSWORD!,
  });
  expect(authenticated.error?.message).toBeUndefined();
  const profile = await client.from("profiles").select("account_kind,test_persona_key").eq("id", authenticated.data.user!.id).single();
  expect(profile.data?.account_kind).toBe("test");
  expect(profile.data?.test_persona_key).toBe("latvian-presidents-v1:gustavs-zemgals");
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

async function assertFitsViewport(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}

async function cleanupCreatedTraining(client: SupabaseClient, runIds: string[], programIds: string[]) {
  // Only IDs returned by this test's creation responses are eligible. End keeps
  // the recoverable run history; deleting the source archives its library card.
  for (const id of runIds) {
    const detail = await client.rpc("get_program_run_detail", {target_run_id:id});
    expect(detail.error?.message).toBeUndefined();
    if (!["completed","ended"].includes(detail.data?.status)) {
      const result = await client.rpc("end_program_run", { target_run_id: id });
      expect(result.error?.message, "End this test's planned workout").toBeUndefined();
    }
  }
  for (const id of programIds) {
    const result = await client.rpc("delete_own_program", { target_program_id: id });
    expect(result.error?.message, "Archive this test's own workout").toBeUndefined();
  }
  await client.auth.signOut();
}

test("workouts exist immediately, dates stay optional, and edited repeats start independently", async ({ page }, testInfo) => {
  test.skip(!["desktop-chromium", "mobile-webkit"].includes(testInfo.project.name), "One desktop and one mobile lifecycle");
  test.setTimeout(120_000);
  const title = `Training lifecycle ${testInfo.project.name} ${Date.now()}`;
  const programIds: string[] = [], runIds: string[] = [], browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await signInAsTestPersona(page, "Gustavs Zemgals");
  const client = await fixtureClient();
  try {
    await page.getByRole("button", { name: "Training", exact: true }).click();
    await page.locator(".program-create-menu summary").click();
    await page.getByRole("button", { name: "Workout One training session", exact: true }).click();
    const createDialog = page.getByRole("dialog", { name: "Create a workout", exact: true });
    await createDialog.getByRole("textbox", { name: "Workout name", exact: true }).fill(title);
    const programId = await rpcAfter(page, "create_blank_quick_workout", () => createDialog.getByRole("button", { name: "Create workout", exact: true }).click());
    programIds.push(programId);
    await expect(page.getByRole("textbox", { name: "Workout name", exact: true })).toHaveValue(title);
    await page.getByRole("button", { name: "Add exercise", exact: true }).click();
    await page.getByRole("textbox", { name: "Search exercises", exact: true }).fill("Back squat");
    await page.locator(".picker-result-main").filter({ has: page.getByText("Back squat", { exact: true }) }).first().click();
    let prescription = page.getByRole("dialog", { name: "Prescribe Back squat", exact: true });
    await expect(prescription.getByRole("combobox", { name: "Record", exact: true })).toHaveValue("weighted_repetitions");
    await prescription.locator("summary").filter({ hasText: "Customize optional fields" }).click();
    await expect(prescription.getByRole("checkbox", { name: "RPE", exact: true })).not.toBeChecked();
    await prescription.getByRole("spinbutton", { name: "Sets", exact: true }).fill("2");
    await prescription.getByRole("textbox", { name: "Repetitions", exact: true }).fill("5");
    await prescription.getByRole("textbox", { name: /^Target weight/ }).fill("20");
    await prescription.getByRole("button", { name: "Save", exact: true }).click();
    await expect(prescription).toHaveCount(0);
    await assertFitsViewport(page);

    // Saving content already makes it Training. Dating it is one optional edit.
    await expect(page.getByRole("button", {name:"Plan workout",exact:true})).toHaveCount(0);
    await expect(page.getByRole("button", {name:"Start workout",exact:true})).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Set dates", exact: true }).click();
    const dates = page.getByRole("dialog", { name: "Set workout date", exact: true });
    await expect(dates.getByLabel(`Date for ${title}`, { exact: true })).toHaveValue("");
    await dates.getByRole("button", {name:/Today/}).click();
    const saveDate=dates.getByRole("button",{name:"Save date",exact:true});
    const bounds=await saveDate.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(testInfo.project.name.startsWith("mobile") ? 44 : 32);
    expect(bounds?.height).toBeLessThanOrEqual(64);
    await assertFitsViewport(page);
    const createdRun=await rpcAfter(page,"ensure_own_training_run",()=>saveDate.click());
    const runId=createdRun.runId as string;
    runIds.push(runId);
    await expect(dates).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Edit ${title}`, exact: true })).toBeVisible();

    // Clearing and restoring dates edits this occurrence rather than adding a copy.
    await page.getByRole("button",{name:"Change dates",exact:true}).click();
    const changeDates=page.getByRole("dialog",{name:"Set workout date",exact:true});
    await changeDates.getByRole("button",{name:"No date",exact:true}).click();
    await rpcAfter(page,"schedule_program_run_workouts",()=>changeDates.getByRole("button",{name:"Save date",exact:true}).click());
    await expect(changeDates).toHaveCount(0);
    const undated=await client.rpc("get_program_run_detail",{target_run_id:runId});
    expect(undated.error?.message).toBeUndefined();
    expect(undated.data.workouts[0].plannedDate).toBeNull();
    await page.getByRole("button",{name:"Set dates",exact:true}).click();
    const restoreDates=page.getByRole("dialog",{name:"Set workout date",exact:true});
    await restoreDates.getByRole("button",{name:/Tomorrow/}).click();
    await rpcAfter(page,"schedule_program_run_workouts",()=>restoreDates.getByRole("button",{name:"Save date",exact:true}).click());
    await expect(restoreDates).toHaveCount(0);

    const edit = await rpcAfter(page, "prepare_program_run_workout_edit", () => page.getByRole("button", { name: `Edit ${title}`, exact: true }).click());
    expect(edit.runId).toBe(runId);
    await expect(page.getByRole("button", { name: "Back to Workout", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit Back squat", exact: true }).click();
    prescription = page.getByRole("dialog", { name: "Prescribe Back squat", exact: true });
    await expect(prescription.getByRole("textbox", { name: "Repetitions", exact: true })).toHaveValue("5");
    await prescription.getByRole("textbox", { name: "Repetitions", exact: true }).fill("8");
    await prescription.getByRole("button", { name: "Save", exact: true }).click();
    await expect(prescription).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: `Edit ${title}`, exact: true })).toBeVisible();
    const original = await client.rpc("get_program_version_detail", { target_program_id: programId });
    const updated = await client.rpc("get_program_run_program_detail", { target_run_id: runId });
    expect(original.data.weeks[0].workouts[0].sections[0].items[0].prescribedEntries[0].repsMin).toBe(5);
    expect(updated.data.weeks[0].workouts[0].sections[0].items[0].prescribedEntries[0].repsMin).toBe(8);
    expect(updated.data.weeks[0].workouts[0].id).toBe(edit.workoutId);
    await assertFitsViewport(page);
    await page.screenshot({ path: testInfo.outputPath("independent-workout.png"), fullPage: true });

    const repeatedProgramId = await rpcAfter(page, "copy_program_run_to_own", () => page.getByRole("button", { name: "Repeat", exact: true }).click());
    programIds.push(repeatedProgramId);
    expect(repeatedProgramId).not.toBe(programId);
    await expect(page.getByRole("textbox", { name: "Workout name", exact: true })).toHaveValue(title);
    await expect(page.getByRole("button", { name: "Set dates", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit Back squat", exact: true }).click();
    prescription = page.getByRole("dialog", { name: "Prescribe Back squat", exact: true });
    await expect(prescription.getByRole("textbox", { name: "Repetitions", exact: true })).toHaveValue("8");
    await prescription.locator("summary").filter({ hasText: "Customize optional fields" }).click();
    await expect(prescription.getByRole("checkbox", { name: "RPE", exact: true })).not.toBeChecked();
    await prescription.getByRole("textbox", { name: "Repetitions", exact: true }).fill("11");
    await prescription.getByRole("button", { name: "Save", exact: true }).click();
    await expect(prescription).toHaveCount(0);
    const retained = await client.rpc("get_program_run_program_detail", { target_run_id: runId });
    expect(retained.data.weeks[0].workouts[0].sections[0].items[0].prescribedEntries[0].repsMin).toBe(8);
    await page.screenshot({ path: testInfo.outputPath("editable-repeat.png"), fullPage: true });
    // An undated repeat starts from its edited prescription with no separate plan step.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const sessionId=await rpcAfter(page,"start_training_workout",()=>page.getByRole("button",{name:"Start workout",exact:true}).click());
    const sessionRow=await client.from("workout_sessions").select("program_run_id").eq("id",sessionId).single();
    expect(sessionRow.error?.message).toBeUndefined();
    runIds.push(sessionRow.data!.program_run_id);
    await expect(page.getByLabel("Back squat, set 1, reps",{exact:true})).toHaveValue("11");
    await expect(page.getByLabel("Back squat, set 1, load in kg",{exact:true})).toHaveValue("20");
    await expect(page.getByLabel("Back squat, set 1, RPE",{exact:true})).toHaveCount(0);
    await assertFitsViewport(page);
    await page.screenshot({path:testInfo.outputPath("started-undated-repeat.png"),fullPage:true});
    await rpcAfter(page,"complete_workout_session_confirmed",()=>page.getByRole("button",{name:"Finish and save session",exact:true}).click());
    const finished=await client.rpc("get_program_run_detail",{target_run_id:sessionRow.data!.program_run_id});
    expect(finished.data.status).toBe("completed");
    expect(browserErrors).toEqual([]);
  } finally {
    await cleanupCreatedTraining(client, runIds, programIds);
  }
});
