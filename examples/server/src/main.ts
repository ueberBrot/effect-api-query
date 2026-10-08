import { startExampleRpcServer } from '@effect-api-query/server'
import type {
  RunningExampleRpcServer,
  StartExampleRpcServerOptions,
} from '@effect-api-query/server'
import { NodeRuntime } from '@effect/platform-node'
import { Effect, Logger } from 'effect'

const serverOptions = { port: 3001 } satisfies StartExampleRpcServerOptions
const developmentLogger = Logger.layer([Logger.consolePretty(), Logger.tracerLogger])

const program = Effect.scoped(
  Effect.gen(function* () {
    const server: RunningExampleRpcServer = yield* startExampleRpcServer(serverOptions)
    yield* Effect.logInfo(`Example RPC server ready at ${server.rpcUrl}`)
    return yield* Effect.never
  }),
)

NodeRuntime.runMain(program.pipe(Effect.provide(developmentLogger), Effect.orDie))
