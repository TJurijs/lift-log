import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import manifest from "./test-population/manifest.json" with { type: "json" };
import { createOfflineAppShell } from "./scripts/lib/offline-app-shell.mjs";

const testPersonasModule = "virtual:liftlog-test-personas";
const resolvedTestPersonasModule = `\0${testPersonasModule}`;
const disabledTestPersonaSwitcher = fileURLToPath(new URL("./app/DisabledTestPersonaSwitcher.tsx", import.meta.url));

function siteMetadata(siteUrl: string, releaseSha: string): Plugin {
  return {
    name: "liftlog-site-metadata",
    transformIndexHtml(html) {
      return html
        .replaceAll("__LIFTLOG_SITE_URL__", siteUrl)
        .replaceAll("__LIFTLOG_RELEASE_SHA__", releaseSha);
    },
  };
}

function offlineAppShell(releaseSha: string): Plugin {
  return {
    name: "liftlog-offline-app-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: createOfflineAppShell(releaseSha, Object.keys(bundle)),
      });
    },
  };
}

function testPersonas(mode: string): Plugin {
  return {
    name: "liftlog-test-personas",
    resolveId(id) {
      return id === testPersonasModule ? resolvedTestPersonasModule : undefined;
    },
    load(id) {
      if (id !== resolvedTestPersonasModule) return undefined;
      const personas = mode === "nonprod" || mode === "localdev" ? manifest.personas : [];
      return `export default ${JSON.stringify(personas)};`;
    },
  };
}

function developmentFixtures(): Plugin {
  return {
    name: "liftlog-development-fixtures",
    transform(code, id) {
      // These fixtures only construct local values. When the DEV-only demo is
      // removed, Array.from/Date calls must not retain its entire training tree.
      if (id.replaceAll("\\", "/").endsWith("/lib/demo-data.ts")) {
        return { code, map: null, moduleSideEffects: false };
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const fallbackSiteUrl = mode === "production"
    ? "https://app.liftlog.cc"
    : mode === "nonprod"
      ? "https://dev.liftlog.cc"
      : "http://localhost:3000";
  const siteUrl = (environment.VITE_SITE_URL || fallbackSiteUrl).replace(/\/+$/, "");
  let gitSha = "local";
  try {
    gitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Source archives and local prototypes may not include Git metadata.
  }
  const releaseCandidate = environment.VITE_RELEASE_SHA || environment.GITHUB_SHA || gitSha;
  const releaseSha = /^(?:[0-9a-f]{7,40}|local|development|test)$/u.test(releaseCandidate)
    ? releaseCandidate
    : "local";

  return {
    cacheDir: `node_modules/.vite/${mode}`,
    plugins: [
      react(),
      testPersonas(mode),
      developmentFixtures(),
      siteMetadata(siteUrl, releaseSha),
      offlineAppShell(releaseSha),
    ],
    define: {
      __LIFTLOG_RELEASE_SHA__: JSON.stringify(releaseSha),
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            // Keep shared dependencies at their existing loading boundary by
            // default; only the ordered data/workspace groups below opt in.
            includeDependenciesRecursively: false,
            groups: [
              // These modules already load for the entry page; one compressed
              // response avoids a separate shared React runtime request.
              { name: "initial", tags: ["$initial"], priority: 100 },
              // Preserve independently loaded data boundaries before grouping
              // workspace dependencies. The entry group keeps React/auth eager.
              { name: "repository", test: /lib[\\/]repository\.ts$/, priority: 40, includeDependenciesRecursively: true },
              { name: "workout-persistence", test: /app[\\/]features[\\/]active-workout[\\/]useActiveWorkoutPersistence\.ts$/, priority: 30, includeDependenciesRecursively: true },
              {
                name: "program-authoring",
                // Keep program management lists with their editors and shared
                // history icon; the program feature remains lazy as a whole.
                test: /(?:app[\\/]features[\\/](?:program-runs[\\/](?:ProgramRun(?:Schedule)?Wizard|SelfProgramRuns)\.tsx|programs[\\/]ProgramView\.tsx|authoring[\\/](?:AuthoringDialogs\.ts|ProgramModal\.tsx|WorkoutDialogs\.tsx|ExerciseModal\.tsx|PrescriptionModal\.tsx|FormatTrackingFields\.tsx))|lib[\\/]program-run-schedule\.ts|lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]history\.js)$/,
              },
              // Shared catalog filters, run cards and icons belong to the core
              // workspace response. Grouping these small shared controls avoids
              // separate requests; dynamic feature views remain lazy.
              { name: "workspace", test: /(?:app[\\/]LiftLogApp\.tsx|app[\\/]features[\\/]program-runs[\\/]ProgramRunCompactCard\.tsx|lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]user-round\.js)$/, includeDependenciesRecursively: true },
            ],
          },
        },
      },
    },
    resolve: {
      alias: mode === "nonprod" || mode === "localdev" ? [] : [{
        find: "./TestPersonaSwitcher",
        replacement: disabledTestPersonaSwitcher,
      }],
    },
    server: {
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
    },
    preview: {
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
    },
  };
});
