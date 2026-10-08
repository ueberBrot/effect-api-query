import { Effect, Predicate, Schema } from 'effect'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import { acquireNodeServer, closeNodeServer } from './node-server-resource.ts'
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

const nodeHeaders = (request: IncomingMessage): Headers => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry)
      }
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }
  return headers
}

const toWebRequest = (request: IncomingMessage, response: ServerResponse, url: URL): Request => {
  const controller = new AbortController()
  request.once('aborted', () => {
    controller.abort()
  })
  request.once('close', () => {
    if (!request.complete) {
      controller.abort()
    }
  })
  response.once('close', () => {
    if (!response.writableFinished) {
      controller.abort()
    }
  })

  const method = request.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const requestInit: RequestInit & { duplex?: 'half' } = {
    headers: nodeHeaders(request),
    method,
    signal: controller.signal,
  }
  if (hasBody) {
    // SAFETY: IncomingMessage emits bytes and toWeb exposes the Web stream protocol
    // consumed by Request; Node and DOM declarations use different stream types.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    requestInit.body = Readable.toWeb(request) as BodyInit
    requestInit.duplex = 'half'
  }
  return new Request(url, requestInit)
}

const writeWebResponse = async (response: Response, target: ServerResponse): Promise<void> => {
  target.statusCode = response.status
  for (const [name, value] of response.headers) {
    target.setHeader(name, value)
  }
  if (response.body === null) {
    target.end()
    return
  }

  // Node's Web stream type and the DOM stream share the same protocol at this bridge.
  // oxlint-disable-next-line promise/avoid-new
  await new Promise<void>((resolve, reject) => {
    // SAFETY: Response.body is a byte stream implementing the same Web stream
    // protocol Node consumes; only the Node/DOM declaration sets differ.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    body.once('error', reject)
    target.once('error', reject)
    target.once('finish', resolve)
    body.pipe(target)
  })
}

const setCorsHeaders = (response: ServerResponse, httpApi: boolean): void => {
  response.setHeader(
    'access-control-allow-headers',
    'baggage,content-type,traceparent,tracestate,x-example-authorization',
  )
  response.setHeader(
    'access-control-allow-methods',
    httpApi ? 'GET,POST,DELETE,OPTIONS' : 'POST,OPTIONS',
  )
  response.setHeader('access-control-allow-origin', '*')
}

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
export const startExampleRpcServer = Effect.fn('ExampleRpc.startExampleRpcServer')(function* (
  options: StartExampleRpcServerOptions = {},
) {
  const host = options.host ?? '127.0.0.1'
  const webHandler = yield* makeExampleWebHandler()
  const server = createServer((request, response) => {
    const address = server.address()
    const port = address === null || Predicate.isString(address) ? 0 : address.port
    const origin = `http://${host}:${String(port)}`
    let url: URL
    try {
      url = new URL(request.url ?? '/', origin)
    } catch {
      response.statusCode = 400
      response.end()
      return
    }
    const path = url.pathname
    const isRpcPath = path === '/rpc' || path === '/rpc/'
    const isHttpPath = path.startsWith('/api/')

    if (request.method === 'GET' && path === '/health') {
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ status: 'ready' }))
      return
    }

    if (request.method === 'OPTIONS' && (isRpcPath || isHttpPath)) {
      setCorsHeaders(response, isHttpPath)
      response.statusCode = 204
      response.end()
      return
    }

    if (!(request.method === 'POST' && isRpcPath) && !isHttpPath) {
      response.statusCode = 404
      response.end()
      return
    }

    setCorsHeaders(response, isHttpPath)
    let webRequest: Request
    try {
      webRequest = toWebRequest(request, response, url)
    } catch {
      response.statusCode = 400
      response.end()
      return
    }
    void (async () => {
      try {
        const webResponse = await webHandler(webRequest)
        await writeWebResponse(webResponse, response)
      } catch (error) {
        console.error(error)
        if (!response.headersSent) {
          response.statusCode = 500
        }
        response.end()
      }
    })()
  })

  const port = yield* acquireNodeServer(
    server,
    Effect.callback<number, ExampleRpcServerError>((resume) => {
      const onError = (cause: Error) => {
        resume(
          Effect.fail(
            new ExampleRpcServerError({
              cause,
              message: 'Example RPC server failed to listen',
            }),
          ),
        )
      }
      server.once('error', onError)
      server.listen(options.port ?? 0, host, () => {
        server.off('error', onError)
        const address = server.address()
        if (address === null || Predicate.isString(address)) {
          resume(
            Effect.promise(async () => closeNodeServer(server)).pipe(
              Effect.andThen(
                Effect.fail(
                  new ExampleRpcServerError({
                    cause: address,
                    message: 'Example RPC server did not bind a TCP address',
                  }),
                ),
              ),
            ),
          )
          return
        }
        resume(Effect.succeed(address.port))
      })
    }),
  )

  const url = `http://${host}:${String(port)}`
  return {
    host,
    port,
    httpApiUrl: `${url}/api`,
    rpcUrl: `${url}/rpc`,
    url,
  } satisfies RunningExampleRpcServer
})
