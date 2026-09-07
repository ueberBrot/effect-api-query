import { defineConfig } from '@playwright/test'

import { browserTestDefaults, browserTestServer } from './e2e/browser-test-config.ts'

export default defineConfig(browserTestDefaults, {
  outputDir: 'test-results',
  testDir: './e2e',
  webServer: [
    browserTestServer('vp run server', 'http://127.0.0.1:3001/health'),
    browserTestServer('vp run --no-cache vite-react-preview', 'http://127.0.0.1:4173'),
    browserTestServer('vp run --no-cache tanstack-start-preview', 'http://127.0.0.1:3000'),
  ],
})
