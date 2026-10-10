import { Predicate, Schema } from 'effect'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import nodePath from 'node:path'
import { createServer } from 'vite'

import { verifyFrameworkBrowser } from './verify-framework-browser.mts'

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
await verifyFrameworkBrowser(server, 'Svelte and Angular reactive browser consumers passed')
