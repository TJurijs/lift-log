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
    plugins: [
      react(),
      testPersonas(mode),
      siteMetadata(siteUrl, releaseSha),
      offlineAppShell(releaseSha),
    ],
    define: {
      __LIFTLOG_RELEASE_SHA__: JSON.stringify(releaseSha),
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
