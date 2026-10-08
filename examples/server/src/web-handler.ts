import { exampleRpcGroup } from '@effect-api-query/contracts'
import { Effect, Layer, Scope } from 'effect'
import type { HttpServerRequest } from 'effect/http'
import { HttpEffect, HttpMiddleware, HttpRouter, HttpServer } from 'effect/http'
import { RpcSerialization, RpcServer } from 'effect/rpc'

import { ExampleDomain } from './domain.ts'
import { exampleHttpRoutes } from './http-handlers.ts'
import { exampleRpcHandlersLayer } from './rpc-handlers.ts'

const rpcLayer = Layer.mergeAll(exampleRpcHandlersLayer, RpcSerialization.layerJson)
const maxRequestBodyBytes = 1024 * 1024

const readRequestBody = async (request: Request): Promise<Uint8Array<ArrayBuffer> | Response> => {
  if (request.body === null) {
    return new Uint8Array()
  }
  const reader = request.body.getReader()
  const body = new Uint8Array(maxRequestBodyBytes)
  let length = 0
  const cancelReader = async () => {
    try {
      await reader.cancel()
    } catch {
      // Failed or already closed uploads no longer need cancellation.
    }
  }
  const cancel = () => {
    void cancelReader()
  }
  request.signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      request.signal.throwIfAborted()
      // Each stream read must complete before the next chunk can be requested.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const chunk = await reader.read()
      request.signal.throwIfAborted()
      if (chunk.done) {
        return body.subarray(0, length)
      }
      if (chunk.value.byteLength > maxRequestBodyBytes - length) {
        cancel()
        return new Response(null, { status: 413 })
      }
      body.set(chunk.value, length)
      length += chunk.value.byteLength
    }
  } catch {
    cancel()
    return new Response(null, { status: 400 })
  } finally {
    request.signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

const withRequestBodyLimit =
  (handler: (request: Request) => Promise<Response>) =>
  async (request: Request): Promise<Response> => {
    const body = await readRequestBody(request)
    if (body instanceof Response) {
      return body
    }
    return await handler(
      new Request(request.url, {
        body: request.body === null ? null : body,
        headers: request.headers,
        method: request.method,
        signal: request.signal,
      }),
    )
  }

/** Builds the host-neutral HTTP RPC handler within the caller-owned Scope. */
const makeRpcWebHandler = Effect.fn('ExampleRpc.makeRpcWebHandler')(function* () {
  const scope = yield* Scope.Scope
  const rpcContext = yield* Layer.buildWithScope(rpcLayer, scope)
  const rpcHttpEffect = yield* RpcServer.toHttpEffect(exampleRpcGroup).pipe(
    Effect.provide(rpcContext),
    Scope.provide(scope),
  )
  const runtimeContext = yield* Effect.context<Scope.Scope>()

  const handler = HttpEffect.toWebHandlerWith<
    Scope.Scope,
    Scope.Scope | HttpServerRequest.HttpServerRequest
  >(runtimeContext)(HttpMiddleware.logger(rpcHttpEffect))
  return withRequestBodyLimit(handler)
})

const provideDomain = Effect.fn('ExampleDomain.provide')(function* <A, E, R>(
  effect: Effect.Effect<A, E, R | ExampleDomain>,
) {
  const scope = yield* Scope.Scope
  const context = yield* Layer.buildWithScope(ExampleDomain.layer, scope)
  return yield* Effect.provide(effect, context)
})

/** Builds the RPC handler within the caller-owned Scope. */
export const makeExampleRpcWebHandler = Effect.fn('ExampleRpc.makeExampleRpcWebHandler')(() =>
  provideDomain(makeRpcWebHandler()),
)

/** Hosts RPC and HTTP contracts over one application state within the caller-owned Scope. */
export const makeExampleWebHandler = Effect.fn('ExampleServer.makeExampleWebHandler')(function* () {
  const rpc = yield* makeRpcWebHandler()
  const httpEffect = yield* HttpRouter.toHttpEffect(
    exampleHttpRoutes.pipe(Layer.provide(HttpServer.layerServices)),
  )
  const runtimeContext = yield* Effect.context<Scope.Scope>()
  const http = withRequestBodyLimit(
    HttpEffect.toWebHandlerWith<Scope.Scope, Scope.Scope | HttpServerRequest.HttpServerRequest>(
      runtimeContext,
    )(HttpMiddleware.logger(httpEffect)),
  )

  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname
    if ((path === '/rpc' || path === '/rpc/') && request.method === 'POST') {
      return await rpc(request)
    }
    if (path.startsWith('/api/')) {
      return await http(request)
    }
    return new Response(null, { status: 404 })
  }
}, provideDomain)
