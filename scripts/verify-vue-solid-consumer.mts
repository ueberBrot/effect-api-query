import { writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import { createServer } from 'vite'

import { verifyFrameworkBrowser } from './verify-framework-browser.mts'

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
await verifyFrameworkBrowser(server, 'Vue and Solid reactive browser consumers passed')
