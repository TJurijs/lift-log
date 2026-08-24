import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  test: {
    clearMocks: true,
    environment: "jsdom",
    include: ["tests/behavior/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "app/TestPersonaSwitcher.tsx"],
      thresholds: {
        "lib/capabilities.ts": {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90,
        },
        "lib/provenance.ts": {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90,
        },
      },
    },
  },
});
