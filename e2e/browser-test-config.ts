import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'

export const browserTestDefaults = defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env['CI']),
  fullyParallel: false,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  reporter: process.env['CI'] === undefined ? 'line' : [['github'], ['line']],
  retries: process.env['CI'] === undefined ? 0 : 1,
  timeout: 30_000,
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  workers: 1,
})

export const browserTestServer = (
  command: string,
  url: string,
): Exclude<NonNullable<PlaywrightTestConfig['webServer']>, readonly unknown[]> => ({
  command,
  reuseExistingServer: false,
  stderr: 'pipe',
  stdout: 'pipe',
  timeout: 120_000,
  url,
})
