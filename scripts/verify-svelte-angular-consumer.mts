import { chromium } from '@playwright/test'
import { Predicate, Schema } from 'effect'
import { strictEqual } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import nodePath from 'node:path'
import { createServer } from 'vite'

const consumerDirectory = process.argv.at(2)
if (consumerDirectory === undefined) {
  throw new Error('A consumer directory is required')
}
const require = createRequire(nodePath.join(consumerDirectory, 'package.json'))
interface CompilerOptions {
  filename: string
  generate: 'client'
}
interface CompilerOutput {
  js: { code: string }
}
interface SvelteCompiler {
  compile: (source: string, options: CompilerOptions) => CompilerOutput
  compileModule: (source: string, options: CompilerOptions) => CompilerOutput
}
const compiler = Schema.decodeUnknownSync(
  Schema.declare(
    (value): value is SvelteCompiler =>
      Predicate.hasProperty(value, 'compile') &&
      Predicate.isFunction(value.compile) &&
      Predicate.hasProperty(value, 'compileModule') &&
      Predicate.isFunction(value.compileModule),
  ),
)(require('svelte/compiler'))
const output = Schema.decodeUnknownSync(
  Schema.Struct({ js: Schema.Struct({ code: Schema.String }) }),
)
writeFileSync(
  nodePath.join(consumerDirectory, 'index.html'),
  '<!doctype html><html><body><script type="module" src="/svelte-angular-runtime.ts"></script></body></html>',
)
const server = await createServer({
  configFile: false,
  root: consumerDirectory,
  plugins: [
    {
      name: 'consumer-svelte',
      enforce: 'pre',
      transform(source, id) {
        const [filename] = id.split('?')
        if (filename?.endsWith('.svelte') === true) {
          return output(compiler.compile(source, { filename, generate: 'client' })).js.code
        }
        if (filename?.endsWith('.svelte.js') === true) {
          return output(compiler.compileModule(source, { filename, generate: 'client' })).js.code
        }
        return null
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { noDiscovery: true },
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
    console.log('Svelte and Angular reactive browser consumers passed')
  } finally {
    await browser.close()
  }
} finally {
  await server.close()
}
