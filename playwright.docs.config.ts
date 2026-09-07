import { defineConfig } from '@playwright/test'

import { browserTestDefaults, browserTestServer } from './e2e/browser-test-config.ts'

export default defineConfig(browserTestDefaults, {
  outputDir: 'test-results/docs',
  testDir: './e2e-docs',
  use: {
    baseURL: 'http://127.0.0.1:4321',
  },
  webServer: {
    ...browserTestServer('vp run docs-preview', 'http://127.0.0.1:4321/effect-api-query/'),
    // Keep Astro attached so Playwright owns the preview process in agent environments.
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
  },
})
