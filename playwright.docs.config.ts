import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env['CI']),
  outputDir: 'test-results/docs',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  reporter: process.env['CI'] === undefined ? 'line' : [['github'], ['line']],
  retries: process.env['CI'] === undefined ? 0 : 1,
  testDir: './e2e-docs',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4321',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'vp run docs-preview',
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 120_000,
    url: 'http://127.0.0.1:4321/effect-api-query/',
  },
  workers: 1,
})
