import { exampleRpcGroup } from '@effect-api-query/contracts'
import { Effect, Layer, Scope } from 'effect'
import { HttpEffect, HttpMiddleware, HttpServerRequest } from 'effect/unstable/http'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'

import { exampleRpcHandlersLayer } from './rpc-handlers.ts'

const rpcLayer = Layer.mergeAll(exampleRpcHandlersLayer, RpcSerialization.layerJson)
const maxRequestBodyBytes = 1024 * 1024

const readRequestBody = async (request: Request): Promise<Uint8Array<ArrayBuffer> | Response> => {
  if (request.body === null) return new Uint8Array()
  const reader = request.body.getReader()
  const body = new Uint8Array(maxRequestBodyBytes)
  let length = 0
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  request.signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      request.signal.throwIfAborted()
      const chunk = await reader.read()
      request.signal.throwIfAborted()
      if (chunk.done) return body.subarray(0, length)
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

/** Builds the host-neutral HTTP RPC handler within the caller-owned Scope. */
export const makeExampleRpcWebHandler = Effect.fn('ExampleRpc.makeExampleRpcWebHandler')(
  function* () {
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
    return async (request: Request): Promise<Response> => {
      const body = await readRequestBody(request)
      if (body instanceof Response) return body
      return handler(
        new Request(request.url, {
          body: request.body === null ? null : body,
          headers: request.headers,
          method: request.method,
          signal: request.signal,
        }),
      )
    }
  },
)
