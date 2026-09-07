import {
  type RunningExampleRpcServer,
  type StartExampleRpcServerOptions,
  startExampleRpcServer,
} from '@effect-api-query/server'
import { Effect, Logger, Runtime } from 'effect'

const serverOptions = { port: 3001 } satisfies StartExampleRpcServerOptions
const developmentLogger = Logger.layer([Logger.consolePretty(), Logger.tracerLogger])

const program = Effect.scoped(
  Effect.gen(function* () {
    const server: RunningExampleRpcServer = yield* startExampleRpcServer(serverOptions)
    yield* Effect.logInfo(`Example RPC server ready at ${server.rpcUrl}`)
    return yield* Effect.never
  }),
)

const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  const shutdown = () => fiber.interruptUnsafe()
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  fiber.addObserver((exit) => {
    process.off('SIGINT', shutdown)
    process.off('SIGTERM', shutdown)
    teardown(exit, (code) => {
      process.exitCode = code
    })
  })
})

runMain(program.pipe(Effect.provide(developmentLogger), Effect.orDie))
