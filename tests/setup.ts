import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { createTestLockManager } from "./helpers/test-lock-manager";

Object.defineProperty(navigator, "locks", {
  configurable: true,
  value: createTestLockManager(),
});

afterEach(() => {
  cleanup();
});
