import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import AppEntry from "./app/AppEntry";
import "./app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Lift Log could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <AppEntry />
  </StrictMode>,
);
