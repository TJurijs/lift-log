import { expect, test } from "@playwright/test";
import { signInAsTestPersona } from "./helpers";

const hostedDevProjectHost = "ofyeejyfroblunbspgve.supabase.co";
const mutationConfirmation = "hosted-development-test-population";

test.describe.configure({ mode: "serial" });

test("an active workout draft survives reload and an offline background cycle", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.LIFTLOG_HOSTED_DRAFT_TEST !== mutationConfirmation,
    "Requires explicit permission to update and restore the hosted-development test persona draft.",
  );
  test.skip(
    testInfo.project.name !== "mobile-webkit",
    "Run the hosted draft lifecycle once in the iPhone WebKit project.",
  );

  const supabaseHosts = new Set<string>();
  page.on("request", (request) => {
    try {
      const host = new URL(request.url()).hostname;
      if (host.endsWith(".supabase.co")) supabaseHosts.add(host);
    } catch {
      // Ignore non-URL browser-internal requests.
    }
  });

  await signInAsTestPersona(page, "Jānis Čakste");
  let startedHere = false;
  if (
    !(await page
      .getByRole("heading", { name: "Workout in progress" })
      .isVisible())
  ) {
    await page.getByRole("button", { name: "Start workout" }).first().click();
    startedHere = true;
  }
  await expect(
    page.getByRole("heading", { name: "Workout in progress" }),
  ).toBeVisible({ timeout: 15_000 });

  const note = page.getByRole("textbox", { name: "Session notes optional" });
  const originalNote = await note.inputValue();
  const onlineMarker = `Draft reload check ${Date.now()}`;
  const offlineMarker = `${onlineMarker} after background`;

  try {
    await note.fill(onlineMarker);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    await expect(note).toHaveValue(onlineMarker);

    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await note.fill(offlineMarker);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
    );
    await expect(
      page.getByText("Saved on this device · reconnect to sync", { exact: true }),
    ).toBeVisible();

    await page.context().setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    await expect(note).toHaveValue(offlineMarker);
    expect([...supabaseHosts]).toContain(hostedDevProjectHost);
  } finally {
    await page.context().setOffline(false);
    if (!page.isClosed()) {
      await note.fill(originalNote);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      if (startedHere) {
        await page.getByRole("button", { name: "Set back to planned" }).click();
        await expect(
          page.getByRole("heading", { name: "Next workouts" }),
        ).toBeVisible({ timeout: 15_000 });
      }
    }
  }
});
