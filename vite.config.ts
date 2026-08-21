import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import manifest from "./test-population/manifest.json" with { type: "json" };

const testPersonasModule = "virtual:liftlog-test-personas";
const resolvedTestPersonasModule = `\0${testPersonasModule}`;
const disabledTestPersonaSwitcher = fileURLToPath(new URL("./app/DisabledTestPersonaSwitcher.tsx", import.meta.url));

function siteMetadata(siteUrl: string): Plugin {
  return {
    name: "liftlog-site-metadata",
    transformIndexHtml(html) {
      return html.replaceAll("__LIFTLOG_SITE_URL__", siteUrl);
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
      const personas = mode === "nonprod" ? manifest.personas : [];
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

  return {
    plugins: [react(), testPersonas(mode), siteMetadata(siteUrl)],
    resolve: {
      alias: mode === "nonprod" ? [] : [{
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
