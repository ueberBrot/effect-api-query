import { NodeHttpServer, NodeSocket } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Layer, Scope } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { RpcClient, RpcMessage, RpcSerialization, RpcServer } from 'effect/rpc'
import { Socket } from 'effect/socket'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { Socket as TcpSocket } from 'node:net'

import {
  queryTransportCalls,
  transportGroup as group,
} from '../../../tests/fixtures/rpc-transport-queries.ts'

const handlers = group.toLayer({ 'values.read': ({ id }) => Effect.succeed(id) })

const headerBytes = (request: IncomingMessage) => {
  let headers = `${request.method ?? ''} ${request.url ?? ''} HTTP/${request.httpVersion}\r\n`
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers += `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`
  }
  return Buffer.byteLength(`${headers}\r\n`)
}

const measureHttpCalls = Effect.fn('TransportOverhead.measureHttpCalls')(function* (count: number) {
  let requests = 0
  let requestBodyBytes = 0
  let requestHeaderBytes = 0
  let nextRequestId = 0
  const connections = new Set<TcpSocket>()
  const nodeServer = createServer()
  nodeServer.on('connection', (socket) => {
    connections.add(socket)
  })
  nodeServer.on('request', (request) => {
    requests += 1
    requestHeaderBytes += headerBytes(request)
  })
  const server = yield* NodeHttpServer.make(() => nodeServer, {
    host: '127.0.0.1',
    port: 0,
    disablePreemptiveShutdown: true,
  })
  if (server.address._tag === 'UnixPathAddress') {
    return yield* Effect.die(new Error('Expected TCP address'))
  }
  const app = yield* RpcServer.toHttpEffect(group).pipe(
    Effect.provide(Layer.merge(handlers, RpcSerialization.layerJson)),
  )
  yield* server.serve(app)
  const client = yield* RpcClient.make(group, {
    flatten: true,
    disableTracing: true,
    generateRequestId: () => {
      const id = RpcMessage.RequestId(nextRequestId)
      nextRequestId += 1
      return id
    },
  }).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({
        url: `http://127.0.0.1:${String(server.address.port)}/rpc`,
        transformClient: (httpClient) =>
          HttpClient.mapRequest(httpClient, (request) => {
            if (request.body._tag !== 'Uint8Array') {
              throw new Error('Expected encoded RPC byte body')
            }
            requestBodyBytes += request.body.body.byteLength
            return request
          }),
      }).pipe(Layer.provide(RpcSerialization.layerJson), Layer.provide(FetchHttpClient.layer)),
    ),
  )
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      nodeServer.closeAllConnections()
    }),
  )
  const queries = yield* queryTransportCalls(client, count)
  return {
    ...queries,
    requests,
    requestBodyBytes,
    requestHeaderBytes,
    connections: connections.size,
    clientToServerBytes: [...connections].reduce((total, socket) => total + socket.bytesRead, 0),
  }
})

const measureWebSocketCalls = Effect.fn('TransportOverhead.measureWebSocketCalls')(function* (
  count: number,
) {
  let writes = 0
  let requestBodyBytes = 0
  let connections = 0
  let nextRequestId = 0
  let upgradeHeaderBytes = 0
  let connection: TcpSocket | undefined
  const nodeServer = createServer()
  nodeServer.on('upgrade', (request) => {
    connections += 1
    upgradeHeaderBytes += headerBytes(request)
    connection = request.socket
  })
  const server = yield* NodeHttpServer.make(() => nodeServer, {
    host: '127.0.0.1',
    port: 0,
    disablePreemptiveShutdown: true,
  })
  if (server.address._tag === 'UnixPathAddress') {
    return yield* Effect.die(new Error('Expected TCP address'))
  }
  const app = yield* RpcServer.toHttpEffectWebsocket(group).pipe(
    Effect.provide(Layer.merge(handlers, RpcSerialization.layerJson)),
  )
  yield* server.serve(app)
  const makeWebSocket = yield* Socket.WebSocketConstructor.pipe(
    Effect.provide(NodeSocket.layerWebSocketConstructorWS),
  )
  const socket = yield* Socket.makeWebSocket(
    `ws://127.0.0.1:${String(server.address.port)}/rpc`,
  ).pipe(
    Effect.provideService(Socket.WebSocketConstructor, (url, options) => {
      const webSocket = makeWebSocket(url, options)
      return {
        get readyState() {
          return webSocket.readyState
        },
        addEventListener: (...args) => {
          webSocket.addEventListener(...args)
        },
        removeEventListener: (...args) => {
          webSocket.removeEventListener(...args)
        },
        close: (...args) => {
          webSocket.close(...args)
        },
        send: (data) => {
          writes += 1
          requestBodyBytes += Buffer.byteLength(data)
          webSocket.send(data)
        },
      }
    }),
  )
  const clientScope = yield* Scope.fork(yield* Effect.scope, 'sequential')
  const protocolContext = yield* Layer.buildWithScope(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(Layer.succeed(Socket.Socket, socket)),
    ),
    clientScope,
  )
  const client = yield* RpcClient.make(group, {
    flatten: true,
    disableTracing: true,
    generateRequestId: () => {
      const id = RpcMessage.RequestId(nextRequestId)
      nextRequestId += 1
      return id
    },
  }).pipe(Effect.provide(protocolContext), Scope.provide(clientScope))
  const queries = yield* queryTransportCalls(client, count)
  const measurement = {
    ...queries,
    writes,
    requestBodyBytes,
    upgradeHeaderBytes,
    clientToServerBytes: connection?.bytesRead ?? 0,
    connections,
  }
  yield* Scope.close(clientScope, Exit.void)
  return measurement
})

const reportMeasurement = (
  transport: string,
  count: number,
  measurement:
    | Effect.Success<ReturnType<typeof measureHttpCalls>>
    | Effect.Success<ReturnType<typeof measureWebSocketCalls>>,
) => {
  if (process.env['RPC_TRANSPORT_MEASURE'] === '1') {
    process.stdout.write(`${JSON.stringify({ transport, count, ...measurement })}\n`)
  }
}

describe('independent RPC request overhead', () => {
  it.live('keeps eight independent queries as eight HTTP requests', () =>
    Effect.gen(function* () {
      const measurement = yield* measureHttpCalls(8)
      expect(measurement.values).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7])
      expect(measurement.requests).toBe(8)
      expect(measurement.cacheEntries).toBe(8)
      expect(measurement.requestHeaderBytes).toBeGreaterThan(measurement.requestBodyBytes)
      expect(measurement.clientToServerBytes).toBe(
        measurement.requestHeaderBytes + measurement.requestBodyBytes,
      )
      reportMeasurement('http', 8, measurement)
    }),
  )

  it.live(
    'multiplexes eight queries on one WebSocket without combining their request messages',
    () =>
      Effect.gen(function* () {
        const measurement = yield* measureWebSocketCalls(8)
        expect(measurement.values).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7])
        expect(measurement.writes).toBe(8)
        expect(measurement.connections).toBe(1)
        expect(measurement.cacheEntries).toBe(8)
        expect(measurement.clientToServerBytes).toBe(
          measurement.upgradeHeaderBytes + measurement.requestBodyBytes + 8 * 6,
        )
        reportMeasurement('websocket', 8, measurement)
      }),
  )

  it.live.each([1, 32])('measures %i independent calls through both transports', (count) =>
    Effect.gen(function* () {
      const http = yield* measureHttpCalls(count).pipe(Effect.scoped)
      const websocket = yield* measureWebSocketCalls(count).pipe(Effect.scoped)
      expect(http.requests).toBe(count)
      expect(websocket.writes).toBe(count)
      expect(websocket.connections).toBe(1)
      expect(http.cacheEntries).toBe(count)
      expect(websocket.cacheEntries).toBe(count)
      expect(http.values).toStrictEqual(websocket.values)
      expect(http.requestBodyBytes).toBe(websocket.requestBodyBytes)
      reportMeasurement('http', count, http)
      reportMeasurement('websocket', count, websocket)
    }),
  )
})
