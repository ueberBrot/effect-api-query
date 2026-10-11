import { defineConfig, devices } from '@playwright/test'
import type { PlaywrightTestConfig } from '@playwright/test'
import { Config, ConfigProvider, Effect, Option } from 'effect'

const ci = Option.getOrUndefined(
  Effect.runSync(
    Config.String('CI')
      .pipe(Config.option)
      .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
  ),
)

export const browserTestDefaults = defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(ci),
  fullyParallel: false,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  reporter: ci === undefined ? 'line' : [['github'], ['line']],
  retries: ci === undefined ? 0 : 1,
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
