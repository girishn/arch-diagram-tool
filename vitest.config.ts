import { defineConfig } from "vitest/config";

// Unit and property tests for the pure modules and a server-side render. The browser tests are Playwright's (see playwright.config.ts).
// The demo's vite.config.ts has root "demo", so tests get their own config.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
