import { chromium } from '@playwright/test'
import { Predicate } from 'effect'
import { strictEqual } from 'node:assert'
import type { ViteDevServer } from 'vite'

export const verifyFrameworkBrowser = async (
  server: ViteDevServer,
  message: string,
): Promise<void> => {
  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (address === undefined || address === null || Predicate.isString(address)) {
      throw new Error('The browser consumer server has no TCP address')
    }
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.waitForFunction(
        () => document.documentElement.dataset['frameworkStatus'] !== undefined,
        undefined,
        { timeout: 30_000 },
      )
      const result = await page.evaluate(() => ({
        status: document.documentElement.dataset['frameworkStatus'],
        message: document.documentElement.dataset['frameworkMessage'],
      }))
      strictEqual(result.status, 'passed', result.message ?? errors.join('\n'))
      strictEqual(errors.length, 0, errors.join('\n'))
      console.log(message)
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
}
