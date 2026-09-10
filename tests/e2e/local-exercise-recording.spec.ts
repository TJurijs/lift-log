import { expect, test, type Page } from "@playwright/test";
import { signInAsTestPersona } from "./helpers";

test.skip((process.env.PLAYWRIGHT_DATA_ENVIRONMENT ?? "local") !== "local", "Disposable local Docker data only");

async function closeDialogs(page: Page) {
  for (let attempt = 0; attempt < 3 && await page.getByRole("dialog").count(); attempt += 1) await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("custom exercise recording and ordered video labels survive saving and reopening", async ({ page }, testInfo) => {
  const name = `Recording review ${testInfo.project.name} ${Date.now()}`;
  const cue = "Hold a straight body line.\nBreathe steadily throughout each set.";
  let created = false;
  await signInAsTestPersona(page, "Gustavs Zemgals");
  try {
    await page.getByRole("button", { name: "Exercises", exact: true }).click();
    await page.getByRole("button", { name: "New exercise", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Create an exercise", exact: true });
    await dialog.getByRole("textbox", { name: "Exercise name", exact: true }).fill(name);
    await dialog.getByRole("combobox", { name: "Record", exact: true }).selectOption("duration");
    await dialog.locator("summary").filter({ hasText: "Customize optional fields" }).click();
    for (const extra of ["Weight", "RPE"]) await expect(dialog.getByRole("checkbox", { name: extra, exact: true })).not.toBeChecked();
    await dialog.getByRole("textbox", { name: "Default cue", exact: true }).fill(cue);
    for (const [index, label] of [[1, "Setup"], [2, "Technique"]] as const) {
      await dialog.getByRole("button", { name: "Add video", exact: true }).click();
      await dialog.getByRole("textbox", { name: `Video ${index} URL`, exact: true }).fill(`https://example.com/recording-review-${index}`);
      await dialog.getByRole("textbox", { name: `Video ${index} label optional`, exact: true }).fill(label);
    }
    await dialog.getByRole("button", { name: "Create exercise", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    created = true;
    await page.reload();
    await page.getByRole("button", { name: "Exercises", exact: true }).click();
    await page.getByRole("tab", { name: "My exercises", exact: true }).click();
    await page.getByRole("textbox", { name: "Search exercises", exact: true }).fill(name);
    await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
    dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog.locator("dd").filter({ hasText: /^Time$/ })).toBeVisible();
    await expect(dialog.getByRole("link", { name: `Watch ${name}: 1. Setup`, exact: true })).toHaveAttribute("href", "https://example.com/recording-review-1");
    await expect(dialog.getByRole("link", { name: `Watch ${name}: 2. Technique`, exact: true })).toHaveAttribute("href", "https://example.com/recording-review-2");
    await dialog.getByRole("button", { name: "Edit exercise", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Edit exercise", exact: true });
    await expect(dialog.getByRole("combobox", { name: "Record", exact: true })).toHaveValue("duration");
    await expect(dialog.getByRole("textbox", { name: "Default cue", exact: true })).toHaveValue(cue);
    await expect(dialog.getByRole("textbox", { name: "Video 2 label optional", exact: true })).toHaveValue("Technique");
    await dialog.getByRole("button", { name: "Remove video 1", exact: true }).click();
    await dialog.getByRole("button", { name: "Remove video 1", exact: true }).click();
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await page.getByRole("tab", { name: "My exercises", exact: true }).click();
    await page.getByRole("textbox", { name: "Search exercises", exact: true }).fill(name);
    await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
    await expect(page.getByRole("dialog", { name, exact: true }).getByRole("link", { name: /^Watch / })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("exercise-recording-saved.png"), fullPage: true });
  } finally {
    if (created && !page.isClosed()) {
      await closeDialogs(page);
      await page.getByRole("button", { name: "Exercises", exact: true }).click();
      await page.getByRole("tab", { name: "My exercises", exact: true }).click();
      await page.getByRole("textbox", { name: "Search exercises", exact: true }).fill(name);
      const row = page.locator(".exercise-list-row").filter({ has: page.getByRole("button", { name: `Open ${name}`, exact: true }) });
      await row.locator("summary").click();
      await row.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete exercise", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  }
});

test("three timed plank sets retain seconds, zero rest and multiline coaching notes", async ({ page }, testInfo) => {
  const name = `Timed sets review ${testInfo.project.name} ${Date.now()}`;
  const note = "Keep the hips level.\nStop the set when you lose position.";
  let created = false;
  await signInAsTestPersona(page, "Gustavs Zemgals");
  try {
    await page.getByRole("button", { name: "Programs", exact: true }).click();
    await page.locator(".program-create-menu summary").click();
    await page.getByRole("button", { name: "Program Multiple ordered workouts", exact: true }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Program name", exact: true }).fill(name);
    await page.getByRole("button", { name: "Create program", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Program name", exact: true })).toHaveValue(name);
    created = true;
    await page.getByRole("button", { name: "Add workout", exact: true }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Workout name", exact: true }).fill("Timed core");
    await page.getByRole("dialog").getByRole("button", { name: "Add workout", exact: true }).click();
    await page.getByRole("button", { name: "Add exercise", exact: true }).click();
    await page.getByRole("textbox", { name: "Search exercises", exact: true }).fill("Plank");
    await page.locator(".picker-result-main").filter({ has: page.getByText("Plank", { exact: true }) }).click();
    let dialog = page.getByRole("dialog", { name: "Prescribe Plank", exact: true });
    await expect(dialog.getByRole("combobox", { name: "Record", exact: true })).toHaveValue("duration");
    await dialog.getByRole("spinbutton", { name: "Sets", exact: true }).fill("3");
    await dialog.getByRole("textbox", { name: "Target time in seconds", exact: true }).fill("30");
    await dialog.getByRole("textbox", { name: "Rest seconds", exact: true }).fill("0");
    await dialog.getByRole("textbox", { name: "Coaching notes optional", exact: true }).fill(note);
    await expect(dialog.getByRole("textbox", { name: "Repetitions", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("textbox", { name: /^Target weight/ })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Back to Programs", exact: true }).click();
    await page.reload();
    await page.getByLabel(`More actions for ${name}`, { exact: true }).click();
    await page.getByRole("button", { name: `Edit ${name} program`, exact: true }).click();
    await page.getByRole("button", { name: "Edit Plank", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Prescribe Plank", exact: true });
    await expect(dialog.getByRole("spinbutton", { name: "Sets", exact: true })).toHaveValue("3");
    await expect(dialog.getByRole("textbox", { name: "Target time in seconds", exact: true })).toHaveValue("30");
    await expect(dialog.getByRole("textbox", { name: "Rest seconds", exact: true })).toHaveValue("0");
    await expect(dialog.getByRole("textbox", { name: "Coaching notes optional", exact: true })).toHaveValue(note);
    await expect(dialog.getByRole("textbox", { name: "Repetitions", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("textbox", { name: /^Target weight/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("timed-plank-saved.png"), fullPage: true });
  } finally {
    if (created && !page.isClosed()) {
      await closeDialogs(page);
      await page.getByRole("button", { name: "Programs", exact: true }).click();
      await page.getByLabel(`More actions for ${name}`, { exact: true }).click();
      await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete program", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  }
});
