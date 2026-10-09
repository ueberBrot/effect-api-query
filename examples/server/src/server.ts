import { NodeHttpServer, NodeHttpServerRequest, NodeStream } from '@effect/platform-node'
import { Effect, Option, Schema } from 'effect'
import { HttpEffect, HttpServerError, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { createServer } from 'node:http'

import { makeExampleWebHandler } from './web-handler.ts'

// Effect Schema.TaggedError is a curried class factory; only instances use new.
// oxlint-disable-next-line unicorn/throw-new-error
class ExampleRpcServerError extends Schema.TaggedError<ExampleRpcServerError>()(
  'ExampleRpcServerError',
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

const corsHeaders = (httpApi: boolean) => ({
  'access-control-allow-headers':
    'baggage,content-type,traceparent,tracestate,x-example-authorization',
  'access-control-allow-methods': httpApi ? 'GET,POST,DELETE,OPTIONS' : 'POST,OPTIONS',
  'access-control-allow-origin': '*',
})

export interface RunningExampleRpcServer {
  readonly host: string
  readonly port: number
  readonly httpApiUrl: string
  readonly rpcUrl: string
  readonly url: string
}

export interface StartExampleRpcServerOptions {
  readonly host?: string
  readonly port?: number
}

/** Starts the standalone example server and closes it with the caller's Scope. */
export const startExampleRpcServer = Effect.fn('ExampleRpc.startExampleRpcServer')(
  (options: StartExampleRpcServerOptions = {}) =>
    Effect.gen(function* () {
      const host = options.host ?? '127.0.0.1'
      const webHandler = yield* makeExampleWebHandler()
      const nodeServer = createServer()
      const server = yield* NodeHttpServer.make(() => nodeServer, {
        disablePreemptiveShutdown: true,
        host,
        port: options.port ?? 0,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ExampleRpcServerError({ cause, message: 'Example RPC server failed to listen' }),
        ),
      )
      if (server.address._tag === 'UnixPathAddress') {
        return yield* new ExampleRpcServerError({
          cause: server.address,
          message: 'Example RPC server did not bind a TCP address',
        })
      }

      const api = HttpEffect.fromWebHandler(webHandler).pipe(Effect.interruptible)
      const app = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = HttpServerRequest.toURL(request)
        if (Option.isNone(url) || url.value.username !== '' || url.value.password !== '') {
          return HttpServerResponse.empty({ status: 400 })
        }
        const path = url.value.pathname
        const isRpcPath = path === '/rpc' || path === '/rpc/'
        const isHttpPath = path.startsWith('/api/')

        if (request.method === 'GET' && path === '/health') {
          return HttpServerResponse.jsonUnsafe({ status: 'ready' })
        }
        if (request.method === 'OPTIONS' && (isRpcPath || isHttpPath)) {
          return HttpServerResponse.empty({ headers: corsHeaders(isHttpPath), status: 204 })
        }
        if (!(request.method === 'POST' && isRpcPath) && !isHttpPath) {
          return HttpServerResponse.empty({ status: 404 })
        }

        // Cancelling an oversized upload must leave its socket open to send the 413.
        const apiRequest = request.modify({})
        Object.defineProperty(apiRequest, 'stream', {
          value: NodeStream.fromReadable({
            closeOnDone: false,
            evaluate: () => NodeHttpServerRequest.toIncomingMessage(request),
            onError: (cause) =>
              new HttpServerError.HttpServerError({
                reason: new HttpServerError.RequestParseError({ cause, request }),
              }),
          }) satisfies typeof request.stream,
        })
        const response = yield* api.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, apiRequest),
        )
        return HttpServerResponse.setHeaders(response, corsHeaders(isHttpPath))
      })
      yield* server.serve(app)
      // Close active sockets before the adapter interrupts their request fibers.
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          nodeServer.closeAllConnections()
        }),
      )

      const { port } = server.address
      const url = `http://${host}:${String(port)}`
      return {
        host,
        port,
        httpApiUrl: `${url}/api`,
        rpcUrl: `${url}/rpc`,
        url,
      } satisfies RunningExampleRpcServer
    }).pipe(
      // Finish acquisition and cleanup registration before accepting interruption.
      Effect.uninterruptible,
    ),
)
