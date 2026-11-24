import { defineConfig } from "@playwright/test";

import { browserTestDefaults } from "./e2e/browser-test-config.ts";

export default defineConfig(browserTestDefaults, {
  outputDir: "test-results",
  testDir: "./e2e",
});
