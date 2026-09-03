import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { chromium } from "@playwright/test";
import { ENVIRONMENT_BINDINGS } from "./lib/environment-bindings.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ITERATIONS = 9;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const READ_ONLY_RPC_NAMES = new Set([
  "get_coach_athlete_detail",
  "get_coaching_access_summary",
  "get_authored_coach_session_detail",
  "get_authored_coach_athlete_detail",
  "get_own_profile",
  "get_own_session_notes",
  "get_program_run_detail",
  "get_program_run_program_detail",
  "get_program_version_detail",
  "get_scheduled_workout_detail",
  "get_workspace_bootstrap",
  "list_authored_coach_session_summaries",
  "list_authored_coach_athlete_overviews",
  "list_calendar_occurrences",
  "list_calendar_session_summaries",
  "list_coach_athletes",
  "list_completed_session_summaries",
  "list_connected_profile_summaries",
  "list_frequent_schedulable_workouts",
  "list_outgoing_coach_invites",
  "list_pending_coach_invites",
  "list_program_run_summaries",
  "list_program_summaries",
  "list_schedulable_workouts",
  "list_upcoming_scheduled_workouts",
  "search_exercises",
]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArgs() {
  const options = {
    baseUrl: process.env.PERF_BASE_URL ?? DEFAULT_BASE_URL,
    iterations: Number(process.env.PERF_ITERATIONS ?? DEFAULT_ITERATIONS),
    dataEnvironment: process.env.PERF_DATA_ENVIRONMENT ?? "hosted-dev",
    output: process.env.PERF_OUTPUT ?? null,
  };

  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith("--base-url=")) {
      options.baseUrl = argument.slice("--base-url=".length);
    } else if (argument.startsWith("--iterations=")) {
      options.iterations = Number(argument.slice("--iterations=".length));
    } else if (argument.startsWith("--data-environment=")) {
      options.dataEnvironment = argument.slice("--data-environment=".length);
    } else if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
    } else {
      throw new Error(
        `Unknown option ${argument}. Use --base-url, --iterations, --data-environment, or --output.`,
      );
    }
  }

  if (!Number.isInteger(options.iterations) || options.iterations < 5) {
    throw new Error("At least five warm-navigation iterations are required.");
  }
  if (!new Set(["hosted-dev", "local"]).has(options.dataEnvironment)) {
    throw new Error("Data environment must be hosted-dev or local.");
  }

  return options;
}

function readEnvFile(filePath) {
  const entries = {};
  if (!fs.existsSync(filePath)) return entries;
  const source = fs.readFileSync(filePath, "utf8");
  for (const sourceLine of source.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function selectedBuildEnvironment(sourceFile) {
  const selected = readEnvFile(sourceFile);
  for (const name of [
    "VITE_SITE_URL",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_ENABLE_TEST_PERSONAS",
  ]) {
    if (process.env[name]) selected[name] = process.env[name];
  }
  return selected;
}

function parseOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
  return parsed.origin;
}

function assertSafeEnvironment(baseUrlValue, dataEnvironment) {
  const baseUrl = new URL(baseUrlValue);
  if (
    baseUrl.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(baseUrl.hostname) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new Error(
      "Performance measurement is restricted to an unauthenticated loopback HTTP app URL.",
    );
  }

  const sourceFile = dataEnvironment === "local" ? ".env.localdev" : ".env.nonprod";
  const selected = selectedBuildEnvironment(sourceFile);
  const devSupabaseOrigin = parseOrigin(
    selected.VITE_SUPABASE_URL,
    `${sourceFile} VITE_SUPABASE_URL`,
  );
  const productionSupabaseOrigin = ENVIRONMENT_BINDINGS.production.supabaseOrigin;
  const devSiteOrigin = parseOrigin(
    selected.VITE_SITE_URL,
    `${sourceFile} VITE_SITE_URL`,
  );
  const productionSiteOrigin = ENVIRONMENT_BINDINGS.production.siteOrigin;
  const devSupabase = new URL(devSupabaseOrigin);

  const hostedDevIsExact = dataEnvironment === "hosted-dev" &&
    devSupabaseOrigin === ENVIRONMENT_BINDINGS.nonprod.supabaseOrigin &&
    devSiteOrigin === ENVIRONMENT_BINDINGS.nonprod.siteOrigin;
  const localIsIsolated = dataEnvironment === "local" &&
    devSupabase.protocol === "http:" && LOOPBACK_HOSTS.has(devSupabase.hostname) &&
    new URL(devSiteOrigin).protocol === "http:" && LOOPBACK_HOSTS.has(new URL(devSiteOrigin).hostname) &&
    devSiteOrigin !== devSupabaseOrigin;
  if (!hostedDevIsExact && !localIsIsolated) {
    throw new Error(
      "The selected data configuration is not the exact hosted-development project or isolated local stack.",
    );
  }
  if (
    devSupabaseOrigin === productionSupabaseOrigin ||
    devSiteOrigin === productionSiteOrigin
  ) {
    throw new Error("Nonproduction and production origins must be distinct.");
  }
  if (selected.VITE_ENABLE_TEST_PERSONAS !== "true") {
    throw new Error("Test personas must be enabled in the selected measurement build.");
  }

  return {
    baseUrl: baseUrl.origin,
    devSupabaseOrigin,
    productionSiteOrigin,
    productionSupabaseOrigin,
    dataEnvironment,
  };
}

function getPersonaPassword() {
  try {
    process.loadEnvFile(".env.test-personas");
  } catch {
    // CI may provide the same secret directly.
  }
  const password = process.env.TEST_PERSONA_PASSWORD;
  if (!password) {
    throw new Error(
      "TEST_PERSONA_PASSWORD is required in .env.test-personas or the process environment.",
    );
  }
  return password;
}

function isDataApiPath(url) {
  return (
    url.pathname.startsWith("/rest/v1/") ||
    url.pathname.startsWith("/graphql/v1")
  );
}

function isAllowedDataApiRead(request, url, devSupabaseOrigin) {
  if (url.origin !== devSupabaseOrigin || !isDataApiPath(url)) return false;
  const method = request.method();
  if (method === "GET" || method === "HEAD") return true;
  if (method !== "POST" || !url.pathname.startsWith("/rest/v1/rpc/")) {
    return false;
  }
  const rpcName = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  return READ_ONLY_RPC_NAMES.has(rpcName);
}

function incrementGroupedAttempt(attempts, request, url) {
  const key = `${request.method()} ${url.pathname}`;
  attempts.set(key, (attempts.get(key) ?? 0) + 1);
}

async function installSafetyRoutes(context, environment) {
  const blockedWrites = new Map();
  const blockedProductionRequests = new Map();
  const blockedUnknownSupabaseRequests = new Map();

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isSupabaseHost =
      url.hostname.endsWith(".supabase.co") ||
      url.origin === environment.devSupabaseOrigin;

    if (
      url.origin === environment.productionSupabaseOrigin ||
      url.origin === environment.productionSiteOrigin
    ) {
      incrementGroupedAttempt(blockedProductionRequests, request, url);
      await route.abort("blockedbyclient");
      return;
    }

    if (isSupabaseHost && url.origin !== environment.devSupabaseOrigin) {
      incrementGroupedAttempt(blockedUnknownSupabaseRequests, request, url);
      await route.abort("blockedbyclient");
      return;
    }

    if (
      url.origin === environment.devSupabaseOrigin &&
      isDataApiPath(url) &&
      request.method() !== "OPTIONS" &&
      !isAllowedDataApiRead(request, url, environment.devSupabaseOrigin)
    ) {
      incrementGroupedAttempt(blockedWrites, request, url);
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });

  return {
    blockedProductionRequests,
    blockedUnknownSupabaseRequests,
    blockedWrites,
  };
}

function groupedAttempts(attempts) {
  return [...attempts.entries()]
    .map(([request, count]) => ({ request, count }))
    .sort((left, right) => left.request.localeCompare(right.request));
}

class DataApiTracker {
  constructor(page, devSupabaseOrigin) {
    this.devSupabaseOrigin = devSupabaseOrigin;
    this.activeWindow = null;
    this.globalInflight = new Set();
    this.globalLastActivity = performance.now();
    this.requestWindows = new WeakMap();

    page.on("request", (request) => this.onRequest(request));
    page.on("response", (response) => this.onResponse(response));
    page.on("requestfinished", (request) => this.onRequestEnd(request));
    page.on("requestfailed", (request) => this.onRequestEnd(request, true));
  }

  isReadRequest(request) {
    return isAllowedDataApiRead(
      request,
      new URL(request.url()),
      this.devSupabaseOrigin,
    );
  }

  onRequest(request) {
    if (!this.isReadRequest(request)) return;
    this.globalInflight.add(request);
    this.globalLastActivity = performance.now();
    if (!this.activeWindow) return;

    const window = this.activeWindow;
    this.requestWindows.set(request, window);
    window.requests += 1;
    window.inflight += 1;
    window.peakConcurrency = Math.max(window.peakConcurrency, window.inflight);
    window.lastActivity = performance.now();
  }

  onResponse(response) {
    const window = this.requestWindows.get(response.request());
    if (!window) return;
    if (response.status() >= 400) window.httpFailures += 1;

    const pending = (async () => {
      try {
        const headers = await response.allHeaders();
        const contentLength = Number(headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength >= 0) {
          window.transferBytes += contentLength;
          window.transferBytesKnownResponses += 1;
        }
      } catch {
        // Header sizes are best effort across caches and protocols.
      }

      try {
        const body = await response.body();
        window.contentBytes += body.byteLength;
        window.contentBytesKnownResponses += 1;
      } catch {
        // A cached or cancelled response may not expose its body.
      }
    })();
    window.responsePromises.push(pending);
  }

  onRequestEnd(request, failed = false) {
    if (this.isReadRequest(request)) {
      this.globalInflight.delete(request);
      this.globalLastActivity = performance.now();
    }

    const window = this.requestWindows.get(request);
    if (!window) return;
    this.requestWindows.delete(request);
    window.inflight = Math.max(0, window.inflight - 1);
    window.lastActivity = performance.now();
    if (failed) window.transportFailures += 1;
  }

  startWindow(name) {
    if (this.activeWindow) throw new Error("A measurement window is already active.");
    const window = {
      name,
      requests: 0,
      inflight: 0,
      peakConcurrency: 0,
      transferBytes: 0,
      transferBytesKnownResponses: 0,
      contentBytes: 0,
      contentBytesKnownResponses: 0,
      httpFailures: 0,
      transportFailures: 0,
      responsePromises: [],
      lastActivity: performance.now(),
    };
    this.activeWindow = window;
    return window;
  }

  async waitForWindowIdle(window, quietMilliseconds = 400) {
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline) {
      if (
        window.inflight === 0 &&
        performance.now() - window.lastActivity >= quietMilliseconds
      ) {
        await Promise.allSettled(window.responsePromises);
        return;
      }
      await delay(25);
    }
    throw new Error(`${window.name} Data API traffic did not settle in 30 seconds.`);
  }

  async waitForGlobalIdle(quietMilliseconds = 400) {
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline) {
      if (
        this.globalInflight.size === 0 &&
        performance.now() - this.globalLastActivity >= quietMilliseconds
      ) {
        return;
      }
      await delay(25);
    }
    throw new Error("Background Data API traffic did not settle in 30 seconds.");
  }

  finishWindow(window) {
    if (this.activeWindow !== window) {
      throw new Error("Attempted to finish an inactive measurement window.");
    }
    this.activeWindow = null;
    return {
      requestCount: window.requests,
      peakConcurrency: window.peakConcurrency,
      transferBytes: window.transferBytes,
      transferBytesKnownResponses: window.transferBytesKnownResponses,
      contentBytes: window.contentBytes,
      contentBytesKnownResponses: window.contentBytesKnownResponses,
      httpFailures: window.httpFailures,
      transportFailures: window.transportFailures,
    };
  }
}

async function domSnapshot(page) {
  return page.evaluate(() => {
    const visibleCount = (selector) =>
      [...document.querySelectorAll(selector)].filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      }).length;

    return {
      cardCount: visibleCount(
        ".program-catalog-card, .next-workout-card, .workout-card, .calendar-card, .coach-assigned-program",
      ),
      rowCount: visibleCount(
        ".exercise-list-row, .coach-connection-row, .athlete-list > button, .coach-agenda-list > *, .program-compact-list > *, .workout-list-items > *, table tbody > tr, [role='row']",
      ),
      panelCount: visibleCount(".app-content .panel"),
      documentHeightPx: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      ),
      documentWidthPx: Math.max(
        document.body.scrollWidth,
        document.documentElement.scrollWidth,
      ),
    };
  });
}

async function jsHeapBytes(cdpSession, page) {
  try {
    const response = await cdpSession.send("Performance.getMetrics");
    const metric = response.metrics.find(({ name }) => name === "JSHeapUsedSize");
    if (Number.isFinite(metric?.value)) return Math.round(metric.value);
  } catch {
    // Fall through to Chromium's nonstandard performance.memory API.
  }

  return page.evaluate(() => {
    const memory = performance.memory;
    return Number.isFinite(memory?.usedJSHeapSize)
      ? Math.round(memory.usedJSHeapSize)
      : null;
  });
}

async function waitForSelected(locator) {
  await locator.waitFor({ state: "visible" });
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    if ((await locator.getAttribute("aria-selected")) === "true") return;
    await delay(25);
  }
  throw new Error("The requested coaching workspace tab was not selected.");
}

async function waitForNavigationSelection(page, label) {
  const locator = navigationButton(page, label);
  await locator.waitFor({ state: "visible" });
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    if ((await locator.getAttribute("aria-current")) === "page") return;
    await delay(25);
  }
  throw new Error(`Navigation did not select ${label}.`);
}

function navigationButton(page, label) {
  const name =
    label === "Coaching" ? /^Coaching(?:,|$)/u : new RegExp(`^${label}$`, "u");
  return page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name });
}

async function navigate(page, label) {
  for (const backName of [
    /^(?:All programs|Back to Programs)$/u,
    /^(?:Next workouts|Back to Next(?: workouts)?)$/u,
    /^(?:Calendar|Back to Calendar)$/u,
    /^(?:Coaching|Back to Coaching)$/u,
  ]) {
    const back = appContent(page)
      .getByRole("button", { name: backName })
      .first();
    if (!(await back.isVisible())) continue;
    await back.click();
    break;
  }
  await navigationButton(page, label).click();
  await waitForNavigationSelection(page, label);
}

function appContent(page) {
  return page.locator(".app-content");
}

async function openProgramCatalog(page) {
  const back = appContent(page).getByRole("button", {
    name: /^(?:All programs|Back to Programs)$/u,
  });
  if (await back.isVisible()) await back.click();
  await navigate(page, "Programs");
  await appContent(page).locator(".program-compact-list").waitFor({
    state: "visible",
  });
}

function firstProgramDetailTrigger(page) {
  return appContent(page)
    .locator(
      '.program-content-section[aria-labelledby="program-list-heading"] .program-card-main',
    )
    .first();
}

async function openNextWorkoutsList(page) {
  await navigate(page, "Next workouts");
  const back = appContent(page).getByRole("button", {
    name: /^(?:Next workouts|Back to Next(?: workouts)?)$/u,
  });
  if (await back.isVisible()) await back.click();
  await firstProgramRunDetailTrigger(page).waitFor({ state: "visible" });
}

function firstProgramRunDetailTrigger(page) {
  return appContent(page).getByRole("button", { name: /^View plan$/u }).first();
}

async function startResponsivenessProbe(page) {
  await page.evaluate(() => {
    const probe = { longTasks: [], interactions: [], observers: [] };
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    if (supported.includes("longtask")) {
      const observer = new PerformanceObserver((list) => {
        probe.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask", buffered: false });
      probe.observers.push(observer);
    }
    if (supported.includes("event")) {
      const observer = new PerformanceObserver((list) => {
        probe.interactions.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "event", buffered: false, durationThreshold: 40 });
      probe.observers.push(observer);
    }
    globalThis.__liftlogResponsivenessProbe = probe;
  });
}

async function finishResponsivenessProbe(page) {
  return page.evaluate(() => {
    const probe = globalThis.__liftlogResponsivenessProbe;
    if (!probe) return { longTaskCount: null, longTaskTotalMs: null, longTaskMaxMs: null, interactionLatencyMs: null };
    probe.observers.forEach((observer) => observer.disconnect());
    const result = {
      longTaskCount: probe.longTasks.length,
      longTaskTotalMs: probe.longTasks.reduce((total, duration) => total + duration, 0),
      longTaskMaxMs: probe.longTasks.length ? Math.max(...probe.longTasks) : 0,
      interactionLatencyMs: probe.interactions.length ? Math.max(...probe.interactions) : null,
    };
    delete globalThis.__liftlogResponsivenessProbe;
    return result;
  });
}

async function measureWindow({
  name,
  action,
  ready,
  page,
  tracker,
  cdpSession,
  safetyState,
}) {
  const blockedBefore = [...safetyState.blockedWrites.values()].reduce(
    (total, count) => total + count,
    0,
  );
  const window = tracker.startWindow(name);
  await startResponsivenessProbe(page);
  const startedAt = performance.now();
  await action();
  await ready();
  const readyMs = performance.now() - startedAt;
  await tracker.waitForWindowIdle(window);
  const settledMs = performance.now() - startedAt;
  const dataApi = tracker.finishWindow(window);
  const responsiveness = await finishResponsivenessProbe(page);
  const blockedAfter = [...safetyState.blockedWrites.values()].reduce(
    (total, count) => total + count,
    0,
  );

  return {
    readyMs: round(readyMs),
    settledMs: round(settledMs),
    dataApi,
    responsiveness,
    dom: await domSnapshot(page),
    jsHeapBytes: await jsHeapBytes(cdpSession, page),
    blockedWriteAttempts: blockedAfter - blockedBefore,
  };
}

async function signInPersona({
  page,
  personaName,
  password,
  environment,
  tracker,
  cdpSession,
  safetyState,
}) {
  await page.goto(environment.baseUrl, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).origin !== environment.baseUrl) {
    throw new Error("The local app navigated away from its guarded loopback origin.");
  }
  await page.getByRole("button", { name: /Test population/iu }).click();
  await page
    .getByPlaceholder("Enter once, then choose an account")
    .fill(password);

  return measureWindow({
    name: `${personaName}:bootstrap`,
    action: () =>
      page
        .getByRole("button", { name: new RegExp(personaName, "iu") })
        .click(),
    // A seeded persona may resume straight into an active workout, in which
    // case the app shell is ready even though the Next navigation item is not
    // the current page until the user leaves that detail.
    ready: () => navigationButton(page, "Next workouts").waitFor({
      state: "visible",
    }),
    page,
    tracker,
    cdpSession,
    safetyState,
  });
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return round(sorted[index]);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return round(
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2,
  );
}

function metricSummary(values) {
  const available = values.filter(Number.isFinite);
  return {
    median: median(available),
    p95: percentile(available, 0.95),
    p75: percentile(available, 0.75),
    min: available.length ? round(Math.min(...available)) : null,
    max: available.length ? round(Math.max(...available)) : null,
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function summarize(samples) {
  return {
    iterations: samples.length,
    readyMs: metricSummary(samples.map((sample) => sample.readyMs)),
    settledMs: metricSummary(samples.map((sample) => sample.settledMs)),
    dataApiRequests: metricSummary(
      samples.map((sample) => sample.dataApi.requestCount),
    ),
    peakDataApiConcurrency: metricSummary(
      samples.map((sample) => sample.dataApi.peakConcurrency),
    ),
    transferBytes: metricSummary(
      samples.map((sample) => sample.dataApi.transferBytes),
    ),
    contentBytes: metricSummary(
      samples.map((sample) => sample.dataApi.contentBytes),
    ),
    responsesWithKnownTransferBytes: metricSummary(
      samples.map((sample) => sample.dataApi.transferBytesKnownResponses),
    ),
    responsesWithKnownContentBytes: metricSummary(
      samples.map((sample) => sample.dataApi.contentBytesKnownResponses),
    ),
    cardCount: metricSummary(samples.map((sample) => sample.dom.cardCount)),
    rowCount: metricSummary(samples.map((sample) => sample.dom.rowCount)),
    panelCount: metricSummary(samples.map((sample) => sample.dom.panelCount)),
    documentHeightPx: metricSummary(
      samples.map((sample) => sample.dom.documentHeightPx),
    ),
    jsHeapBytes: metricSummary(samples.map((sample) => sample.jsHeapBytes)),
    longTaskCount: metricSummary(samples.map((sample) => sample.responsiveness.longTaskCount)),
    longTaskTotalMs: metricSummary(samples.map((sample) => sample.responsiveness.longTaskTotalMs)),
    longTaskMaxMs: metricSummary(samples.map((sample) => sample.responsiveness.longTaskMaxMs)),
    interactionLatencyMs: metricSummary(samples.map((sample) => sample.responsiveness.interactionLatencyMs)),
    failures: {
      http: samples.reduce(
        (total, sample) => total + sample.dataApi.httpFailures,
        0,
      ),
      transport: samples.reduce(
        (total, sample) => total + sample.dataApi.transportFailures,
        0,
      ),
    },
    blockedWriteAttempts: samples.reduce(
      (total, sample) => total + sample.blockedWriteAttempts,
      0,
    ),
  };
}

async function measureTarget({
  target,
  iterations,
  page,
  tracker,
  cdpSession,
  safetyState,
}) {
  await target.setup();
  await tracker.waitForGlobalIdle();
  await target.action();
  await target.ready();
  await tracker.waitForGlobalIdle();

  const samples = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    await target.setup();
    await tracker.waitForGlobalIdle();
    samples.push(
      await measureWindow({
        name: `${target.id}:${iteration}`,
        action: target.action,
        ready: target.ready,
        page,
        tracker,
        cdpSession,
        safetyState,
      }),
    );
  }
  return {
    id: target.id,
    label: target.label,
    kind: target.kind ?? "navigation",
    ...summarize(samples),
  };
}

function janisTargets(page) {
  return [
    {
      id: "next-workouts",
      label: "Next workouts",
      setup: () => navigate(page, "Programs"),
      action: () => navigationButton(page, "Next workouts").click(),
      ready: () => waitForNavigationSelection(page, "Next workouts"),
    },
    {
      id: "programs",
      label: "Programs",
      setup: () => navigate(page, "Next workouts"),
      action: () => navigationButton(page, "Programs").click(),
      ready: () => waitForNavigationSelection(page, "Programs"),
    },
    {
      id: "program-detail",
      label: "Program detail",
      kind: "detail",
      setup: () => openProgramCatalog(page),
      action: () => firstProgramDetailTrigger(page).click(),
      ready: () =>
        appContent(page)
          .getByRole("button", {
            name: /^(?:All programs|Back to Programs)$/u,
          })
          .waitFor({ state: "visible" }),
    },
    {
      id: "calendar",
      label: "Calendar",
      setup: () => navigate(page, "Next workouts"),
      action: () => navigationButton(page, "Calendar").click(),
      ready: () => waitForNavigationSelection(page, "Calendar"),
    },
    {
      id: "exercises",
      label: "Exercise library",
      setup: () => navigate(page, "Next workouts"),
      action: () => navigationButton(page, "Exercises").click(),
      ready: () => waitForNavigationSelection(page, "Exercises"),
    },
  ];
}

function raimondsTargets(page) {
  const myCoaches = page.getByRole("tab", { name: /^My coaches$/u });
  const myAthletes = page.getByRole("tab", { name: /My athletes/u });

  return [
    {
      id: "program-run-detail",
      label: "Active program detail",
      kind: "detail",
      setup: () => openNextWorkoutsList(page),
      action: () => firstProgramRunDetailTrigger(page).click(),
      ready: () =>
        appContent(page)
          .getByRole("button", {
            name: /^(?:Next workouts|Back to Next(?: workouts)?)$/u,
          })
          .waitFor({ state: "visible" }),
    },
    {
      id: "coaching-my-coaches",
      label: "Coaching · My coaches",
      setup: () => navigate(page, "Next workouts"),
      action: () => navigationButton(page, "Coaching").click(),
      ready: async () => {
        await waitForNavigationSelection(page, "Coaching");
        await waitForSelected(myCoaches);
      },
    },
    {
      id: "coach-athlete-detail",
      label: "Coach athlete detail",
      kind: "detail",
      setup: async () => {
        await navigate(page, "Coaching");
        if ((await myCoaches.getAttribute("aria-selected")) !== "true") {
          await myCoaches.click();
          await waitForSelected(myCoaches);
        }
      },
      action: () => myAthletes.click(),
      ready: async () => {
        await waitForNavigationSelection(page, "Coaching");
        await waitForSelected(myAthletes);
        await appContent(page).locator(".coach-athlete-workspace").waitFor({
          state: "visible",
        });
      },
    },
  ];
}

async function measurePersona({
  browser,
  personaName,
  targets,
  iterations,
  password,
  environment,
  safetyTotals,
}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  });
  const safetyState = await installSafetyRoutes(context, environment);
  const page = await context.newPage();
  const tracker = new DataApiTracker(page, environment.devSupabaseOrigin);
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send("Performance.enable");
  let pageErrorCount = 0;
  let consoleErrorCount = 0;
  page.on("pageerror", () => {
    pageErrorCount += 1;
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrorCount += 1;
  });

  try {
    const bootstrap = await signInPersona({
      page,
      personaName,
      password,
      environment,
      tracker,
      cdpSession,
      safetyState,
    });
    const screens = [];
    for (const target of targets(page)) {
      screens.push(
        await measureTarget({
          target,
          iterations,
          page,
          tracker,
          cdpSession,
          safetyState,
        }),
      );
    }

    for (const [key, value] of safetyState.blockedWrites) {
      safetyTotals.blockedWrites.set(
        key,
        (safetyTotals.blockedWrites.get(key) ?? 0) + value,
      );
    }
    for (const [key, value] of safetyState.blockedProductionRequests) {
      safetyTotals.blockedProductionRequests.set(
        key,
        (safetyTotals.blockedProductionRequests.get(key) ?? 0) + value,
      );
    }
    for (const [key, value] of safetyState.blockedUnknownSupabaseRequests) {
      safetyTotals.blockedUnknownSupabaseRequests.set(
        key,
        (safetyTotals.blockedUnknownSupabaseRequests.get(key) ?? 0) + value,
      );
    }

    return {
      persona: personaName,
      bootstrap,
      screens,
      pageErrorCount,
      consoleErrorCount,
    };
  } finally {
    await context.close();
  }
}

async function assertLocalAppIsReady(baseUrl) {
  let response;
  try {
    response = await fetch(baseUrl, { redirect: "manual" });
  } catch {
    throw new Error(
      `No app responded at ${baseUrl}. Start it with npm run dev:hosted and retry.`,
    );
  }
  if (!response.ok) {
    throw new Error(`The local app health check returned HTTP ${response.status}.`);
  }
}

async function main() {
  const options = parseArgs();
  const environment = assertSafeEnvironment(options.baseUrl, options.dataEnvironment);
  const password = getPersonaPassword();
  await assertLocalAppIsReady(environment.baseUrl);

  const browser = await chromium.launch({ headless: true });
  const safetyTotals = {
    blockedWrites: new Map(),
    blockedProductionRequests: new Map(),
    blockedUnknownSupabaseRequests: new Map(),
  };

  try {
    const personas = [];
    personas.push(
      await measurePersona({
        browser,
        personaName: "Jānis Čakste",
        targets: janisTargets,
        iterations: options.iterations,
        password,
        environment,
        safetyTotals,
      }),
    );
    personas.push(
      await measurePersona({
        browser,
        personaName: "Raimonds Vējonis",
        targets: raimondsTargets,
        iterations: options.iterations,
        password,
        environment,
        safetyTotals,
      }),
    );

    const blockedProductionRequests = groupedAttempts(
      safetyTotals.blockedProductionRequests,
    );
    const blockedUnknownSupabaseRequests = groupedAttempts(
      safetyTotals.blockedUnknownSupabaseRequests,
    );
    if (blockedProductionRequests.length || blockedUnknownSupabaseRequests.length) {
      throw new Error(
        "The app attempted to contact a production or unaudited Supabase origin; requests were blocked.",
      );
    }

    const report = {
      schemaVersion: 2,
      measuredAt: new Date().toISOString(),
      configuration: {
        appEnvironment: "loopback application build",
        dataEnvironment: environment.dataEnvironment,
        releaseSha: process.env.VITE_RELEASE_SHA ?? process.env.GITHUB_SHA ?? "local",
        browser: "headless Chromium",
        viewport: { width: 1440, height: 900 },
        warmIterationsPerScreen: options.iterations,
        serviceWorkers: "blocked",
      },
      safety: {
        readOnly: true,
        measuredSurfaces: ["navigation", "detail"],
        allowedDataApiMethods: [
          "GET",
          "HEAD",
          ...[...READ_ONLY_RPC_NAMES]
            .sort()
            .map((rpcName) => `POST ${rpcName}`),
        ],
        blockedWriteAttempts: groupedAttempts(safetyTotals.blockedWrites),
        productionOrUnknownSupabaseRequests: [],
        secretsEmitted: false,
      },
      personas,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, serialized);
    }
    process.stdout.write(serialized);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const password = process.env.TEST_PERSONA_PASSWORD;
  const message = error instanceof Error ? error.message : String(error);
  const redacted = password ? message.replaceAll(password, "[redacted]") : message;
  process.stderr.write(`Hosted read-only measurement failed: ${redacted}\n`);
  process.exitCode = 1;
});
