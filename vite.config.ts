import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import manifest from "./test-population/manifest.json" with { type: "json" };

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
      const precache = [
        "/",
        ...Object.keys(bundle)
          .filter((fileName) => !fileName.endsWith(".map") && fileName !== "sw.js")
          .map((fileName) => `/${fileName}`),
      ];
      const cacheName = `liftlog-shell-${releaseSha}`;
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `const CACHE_NAME=${JSON.stringify(cacheName)};
const PRECACHE=${JSON.stringify(precache)};
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(PRECACHE)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("liftlog-shell-")&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{const request=event.request;if(request.method!=="GET")return;const url=new URL(request.url);if(url.origin!==self.location.origin)return;if(request.mode==="navigate"){event.respondWith(fetch(request).then(response=>{const copy=response.clone();void caches.open(CACHE_NAME).then(cache=>cache.put("/",copy));return response;}).catch(()=>caches.match("/").then(response=>response||Response.error())));return;}event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok){const copy=response.clone();void caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));}return response;})));});
`,
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
