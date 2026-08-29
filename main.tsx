import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import AppEntry from "./app/AppEntry";
import AppErrorBoundary from "./app/AppErrorBoundary";
import { DevMobilePreview, shouldRenderDevMobilePreview } from "./app/DevMobilePreview";
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

const isDevelopmentPreviewFrame = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get("preview_frame") === "1";
document.documentElement.classList.toggle("dev-mobile-preview-frame", isDevelopmentPreviewFrame);

const app = (
  <StrictMode>
    <AppErrorBoundary>
      <AppEntry />
    </AppErrorBoundary>
  </StrictMode>
);

createRoot(root).render(
  shouldRenderDevMobilePreview(import.meta.env.DEV, window.location.search)
    ? <DevMobilePreview />
    : app,
);
