import { chromium } from '@playwright/test'
import { Predicate } from 'effect'
import { strictEqual } from 'node:assert'
import { writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import { createServer } from 'vite'

const [consumerDirectory] = process.argv.slice(2)
if (consumerDirectory === undefined) {
  throw new Error('A consumer directory is required')
}
writeFileSync(
  nodePath.join(consumerDirectory, 'index.html'),
  '<!doctype html><html><body><script type="module" src="/vue-solid-runtime.ts"></script></body></html>',
)
const server = await createServer({
  configFile: false,
  root: consumerDirectory,
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { noDiscovery: true },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
})
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
    page.on('pageerror', (error) => {
      errors.push(error.message)
    })
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
    strictEqual(result?.status, 'passed', result?.message ?? errors.join('\n'))
    strictEqual(errors.length, 0, errors.join('\n'))
    console.log('Vue and Solid reactive browser consumers passed')
  } finally {
    await browser.close()
  }
} finally {
  await server.close()
}
