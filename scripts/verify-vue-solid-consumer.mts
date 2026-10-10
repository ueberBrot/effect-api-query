import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect, FileSystem, Path, Stdio } from 'effect'
import { createServer } from 'vite'

import { verifyFrameworkBrowser } from './verify-framework-browser.mts'

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const nodePath = yield* Path.Path
  const stdio = yield* Stdio.Stdio
  const [consumerDirectory] = yield* stdio.args
  if (consumerDirectory === undefined) {
    throw new Error('A consumer directory is required')
  }
  yield* fs.writeFileString(
    nodePath.join(consumerDirectory, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/vue-solid-runtime.ts"></script></body></html>',
  )
  yield* Effect.uninterruptible(
    Effect.promise(async () => {
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
    }),
  )
})
NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
