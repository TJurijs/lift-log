import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function siteMetadata(siteUrl: string): Plugin {
  return {
    name: "liftlog-site-metadata",
    transformIndexHtml(html) {
      return html.replaceAll("__LIFTLOG_SITE_URL__", siteUrl);
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
    plugins: [react(), siteMetadata(siteUrl)],
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
