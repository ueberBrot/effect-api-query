import { defineConfig } from '@playwright/test'
import type { PlaywrightTestConfig } from '@playwright/test'
import { Config, ConfigProvider, Effect, Option } from 'effect'

import { browserTestDefaults, browserTestServer } from './e2e/browser-test-config.ts'

const hostedOrigin = Option.getOrUndefined(
  Effect.runSync(
    Config.String('DOCS_BASE_URL')
      .pipe(Config.option)
      .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
  ),
)

const docsConfig: PlaywrightTestConfig = {
  outputDir: 'test-results/docs',
  testDir: './e2e-docs',
  use: {
    baseURL: hostedOrigin ?? 'http://127.0.0.1:4321',
  },
}

if (hostedOrigin === undefined) {
  docsConfig.webServer = {
    ...browserTestServer(
      'vp run --ignore-depends-on docs-preview --host 127.0.0.1 --port 4321',
      'http://127.0.0.1:4321/effect-api-query/',
    ),
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
  }
}

export default defineConfig(browserTestDefaults, docsConfig)
