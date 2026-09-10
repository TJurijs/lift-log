import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import AppEntry from "./app/AppEntry";
import AppErrorBoundary from "./app/AppErrorBoundary";
import { DevMobilePreview } from "./app/DevMobilePreview";
import { devMobilePreviewEnabled, getDevMobilePreviewState } from "./lib/dev-mobile-preview";
import "./app/globals.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Offline recovery is an enhancement; registration must never block startup.
    });
  });
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Lift Log could not find its application root.");
}

const mobilePreview = devMobilePreviewEnabled && getDevMobilePreviewState(
  { DEV: import.meta.env.DEV, MODE: import.meta.env.MODE },
  window.location.search,
);
document.documentElement.classList.toggle("dev-mobile-preview-frame", Boolean(mobilePreview && mobilePreview.isFrame));
// Keep the environment check inline so Vite excludes preview styles from production.
if (import.meta.env.DEV || import.meta.env.MODE === "nonprod" || import.meta.env.MODE === "localdev") {
  if (mobilePreview && (mobilePreview.isPreview || mobilePreview.isFrame)) {
    void import("./app/dev-mobile-preview.css");
  }
}

const app = (
  <StrictMode>
    <AppErrorBoundary>
      <AppEntry />
    </AppErrorBoundary>
  </StrictMode>
);

createRoot(root).render(
  devMobilePreviewEnabled && mobilePreview && mobilePreview.isPreview
    ? <DevMobilePreview />
    : app,
);
