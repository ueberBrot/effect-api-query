import { NodeHttpServer, NodeSocket, NodeStdio } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import {
  Config,
  ConfigProvider,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Predicate,
  Queue,
  Schema,
  Scope,
  Stdio,
  Stream,
} from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { RpcClient, RpcMessage, RpcSerialization, RpcServer } from 'effect/rpc'
import { Socket } from 'effect/socket'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { Socket as TcpSocket } from 'node:net'

import {
  queryTransportCalls,
  sharedStreamGroup,
  startSharedTransportQuery,
  transportGroup as group,
} from '../../../tests/fixtures/rpc-transport-queries.ts'

const handlers = group.toLayer({ 'values.read': ({ id }) => Effect.succeed(id) })
const textEncoder = new TextEncoder()

const headerBytes = (request: IncomingMessage) => {
  let headers = `${request.method ?? ''} ${request.url ?? ''} HTTP/${request.httpVersion}\r\n`
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers += `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`
  }
  return textEncoder.encode(`${headers}\r\n`).byteLength
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
          requestBodyBytes += Predicate.isString(data)
            ? textEncoder.encode(data).byteLength
            : data.byteLength
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

const reportMeasurement = Effect.fn('TransportOverhead.reportMeasurement')(function* (
  transport: string,
  count: number,
  measurement:
    | Effect.Success<ReturnType<typeof measureHttpCalls>>
    | Effect.Success<ReturnType<typeof measureWebSocketCalls>>,
) {
  const reporting = yield* Config.String('RPC_TRANSPORT_MEASURE')
    .pipe(Config.option)
    .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
  if (Option.isSome(reporting) && reporting.value === '1') {
    const stdio = yield* Stdio.Stdio
    yield* Stream.make(`${JSON.stringify({ transport, count, ...measurement })}\n`).pipe(
      Stream.run(stdio.stdout({ endOnDone: false })),
    )
  }
}, Effect.provide(NodeStdio.layer))

const decodeBurst = Schema.decodeUnknownOption(
  Schema.TaggedStruct('Chunk', {
    values: Schema.NonEmptyArray(Schema.Int),
  }),
)
const decodeUnaryExit = Schema.decodeUnknownOption(
  Schema.TaggedStruct('Exit', {
    exit: Schema.TaggedStruct('Success', { value: Schema.Literal(42) }),
  }),
)
const decodeWireData = Schema.decodeUnknownSync(Schema.Union([Schema.String, Schema.Uint8Array]))

const settleSharedStream = Effect.fn('settleSharedStream')(function* (
  completion: 'cancel' | 'complete',
) {
  let clientClosed = false
  let serverClosed = false
  let remoteFinalizers = 0
  const result = yield* Effect.gen(function* () {
    const unaryStarted = yield* Deferred.make<undefined>()
    const unaryRelease = yield* Deferred.make<undefined>()
    const serverFinalized = yield* Deferred.make<number>()
    const burstOnWire = yield* Deferred.make<readonly number[]>()
    const serverAcknowledged = yield* Deferred.make<undefined>()
    const unaryOnWire = yield* Deferred.make<42>()
    const clientSocketClosed = yield* Deferred.make<undefined>()
    const cancellationHandlers = sharedStreamGroup.toLayer({
      burst: () =>
        (completion === 'cancel'
          ? Stream.make(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16).pipe(
              Stream.concat(
                Stream.fromEffect(
                  Deferred.succeed(serverAcknowledged, undefined).pipe(
                    Effect.andThen(Effect.never),
                  ),
                ),
              ),
            )
          : Stream.make(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)
        ).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              remoteFinalizers += 1
              return remoteFinalizers
            }).pipe(Effect.flatMap((count) => Deferred.succeed(serverFinalized, count))),
          ),
        ),
      read: Effect.fnUntraced(function* () {
        yield* Deferred.succeed(unaryStarted, undefined)
        yield* Deferred.await(unaryRelease)
        return 42
      }),
    })
    const nodeServer = createServer()
    nodeServer.on('close', () => {
      serverClosed = true
    })
    const server = yield* NodeHttpServer.make(() => nodeServer, {
      host: '127.0.0.1',
      port: 0,
      disablePreemptiveShutdown: true,
    })
    if (server.address._tag === 'UnixPathAddress') {
      return yield* Effect.die(new Error('Expected TCP address'))
    }
    const app = yield* RpcServer.toHttpEffectWebsocket(sharedStreamGroup).pipe(
      Effect.provide(Layer.merge(cancellationHandlers, RpcSerialization.layerJson)),
    )
    yield* server.serve(app)
    const makeWebSocket = yield* Socket.WebSocketConstructor.pipe(
      Effect.provide(NodeSocket.layerWebSocketConstructorWS),
    )
    const runSync = Effect.runSyncWith(yield* Effect.context())
    const clientScope = yield* Scope.fork(yield* Effect.scope, 'sequential')
    const socket = yield* Socket.makeWebSocket(
      `ws://127.0.0.1:${String(server.address.port)}/rpc`,
    ).pipe(
      Scope.provide(clientScope),
      Effect.provideService(Socket.WebSocketConstructor, (url, options) => {
        const webSocket = makeWebSocket(url, options)
        const parser = RpcSerialization.json.makeUnsafe()
        webSocket.addEventListener('close', () => {
          clientClosed = true
          runSync(Deferred.succeed(clientSocketClosed, undefined))
        })
        webSocket.addEventListener('message', (event) => {
          for (const message of parser.decode(decodeWireData(event.data))) {
            const burst = decodeBurst(message)
            if (Option.isSome(burst)) {
              runSync(Deferred.succeed(burstOnWire, burst.value.values))
            }
            const unaryExit = decodeUnaryExit(message)
            if (Option.isSome(unaryExit)) {
              runSync(Deferred.succeed(unaryOnWire, unaryExit.value.exit.value))
            }
          }
        })
        return webSocket
      }),
    )
    const protocol = yield* Layer.buildWithScope(
      RpcClient.layerProtocolSocket().pipe(
        Layer.provide(RpcSerialization.layerJson),
        Layer.provide(Layer.succeed(Socket.Socket, socket)),
      ),
      clientScope,
    )
    const client = yield* RpcClient.make(sharedStreamGroup, {
      flatten: true,
      disableTracing: true,
    }).pipe(Effect.provide(protocol), Scope.provide(clientScope))
    const { queryClient, unary } = yield* startSharedTransportQuery(client, clientScope)
    yield* Deferred.await(unaryStarted).pipe(Effect.timeout('2 seconds'))
    const requestScope = yield* Scope.fork(clientScope, 'sequential')
    const { values, bufferedAtCancellation } = yield* Effect.gen(function* () {
      if (completion === 'cancel') {
        const queue = yield* client('burst', undefined, { asQueue: true })
        yield* Deferred.await(burstOnWire).pipe(Effect.timeout('2 seconds'))
        yield* Deferred.await(serverAcknowledged).pipe(Effect.timeout('2 seconds'))
        const buffered = yield* Queue.size(queue)
        yield* Scope.close(requestScope, Exit.void)
        return { values: [], bufferedAtCancellation: buffered }
      }
      const completedValues = yield* client('burst', undefined).pipe(Stream.runCollect)
      return { values: completedValues, bufferedAtCancellation: undefined }
    }).pipe(Scope.provide(requestScope), Effect.timeout('2 seconds'))
    const chunkOnWire = yield* Deferred.await(burstOnWire).pipe(Effect.timeout('2 seconds'))
    if (completion === 'complete') {
      yield* Scope.close(requestScope, Exit.void)
    }
    yield* Deferred.await(serverFinalized).pipe(Effect.timeout('2 seconds'))
    yield* Deferred.succeed(unaryRelease, undefined)
    const wireValue = yield* Deferred.await(unaryOnWire).pipe(Effect.timeout('2 seconds'))
    const unaryResult = yield* Fiber.join(unary).pipe(Effect.timeout('1 second'), Effect.exit)
    const unaryExit = Exit.isSuccess(unaryResult) ? unaryResult.value : unaryResult
    yield* Scope.close(clientScope, Exit.void)
    yield* Deferred.await(clientSocketClosed).pipe(Effect.timeout('2 seconds'))
    return {
      values,
      bufferedAtCancellation,
      chunkOnWire,
      unaryOnWire: wireValue,
      clientClosed,
      cacheEntries: queryClient.getQueryCache().getAll().length,
      unaryExit,
    }
  }).pipe(Effect.scoped)
  return { ...result, remoteFinalizers, serverClosed }
})

describe('shared RPC streams over WebSocket', () => {
  it.live.each(['cancel', 'complete'] as const)(
    'keeps an active unary query live when a valid stream settles by %s',
    (completion) =>
      Effect.gen(function* () {
        const { unaryExit, ...observations } = yield* settleSharedStream(completion)
        expect(observations).toStrictEqual({
          values:
            completion === 'cancel' ? [] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          bufferedAtCancellation: completion === 'cancel' ? 16 : undefined,
          remoteFinalizers: 1,
          chunkOnWire: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          unaryOnWire: 42,
          cacheEntries: 0,
          clientClosed: true,
          serverClosed: true,
        })
        expect(unaryExit).toStrictEqual(Exit.succeed(42))
      }),
  )
})

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
      yield* reportMeasurement('http', 8, measurement)
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
        yield* reportMeasurement('websocket', 8, measurement)
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
      yield* reportMeasurement('http', count, http)
      yield* reportMeasurement('websocket', count, websocket)
    }),
  )
})
