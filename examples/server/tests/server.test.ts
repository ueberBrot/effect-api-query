import { User } from '@effect-api-query/contracts'
import type { DiagnosticStatus } from '@effect-api-query/contracts'
import { makeExampleRpcClient, startExampleRpcClient } from '@effect-api-query/contracts/client'
import type { ExampleRpcClient } from '@effect-api-query/contracts/client'
import { startExampleRpcServer } from '@effect-api-query/server'
import { describe, expect, it, vi } from '@effect/vitest'
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Logger,
  Predicate,
  Result,
  Schema,
  Scope,
  Stream,
} from 'effect'
import { RpcClient } from 'effect/rpc'
import dns from 'node:dns'
import { request as nodeRequest } from 'node:http'

const waitForStatus = Effect.fn('TestExampleRpc.waitForStatus')(function* (
  client: ExampleRpcClient,
  predicate: (status: DiagnosticStatus) => boolean,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = yield* client('diagnostics.status', undefined)
    if (predicate(status)) {
      return status
    }
    yield* Effect.sleep('10 millis')
  }
  return yield* Effect.die(new Error('Timed out waiting for diagnostic status'))
})

describe('example RPC server', () => {
  it.live('rejects oversized chunked bodies before the client finishes sending', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const status = yield* Effect.promise(
        async () =>
          // The callback/event API needs a Promise bridge in the ES2022 target.
          // oxlint-disable-next-line promise/avoid-new
          new Promise<number | undefined>((resolve, reject) => {
            const request = nodeRequest(server.rpcUrl, { method: 'POST' }, (response) => {
              response.resume()
              response.once('end', () => {
                request.destroy()
                resolve(response.statusCode)
              })
            })
            request.once('error', reject)
            request.setTimeout(1000, () => {
              request.destroy(new Error('Request timed out'))
            })
            request.write(' '.repeat(1024 * 1024 + 1))
          }),
      )
      expect(status).toBe(413)
      expect((yield* Effect.promise(async () => fetch(`${server.url}/health`))).status).toBe(200)
    }),
  )

  it.live('rejects malformed request targets and continues serving requests', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      for (const path of ['//[', 'http://user:password@localhost/rpc']) {
        const status = yield* Effect.promise(
          async () =>
            // The callback/event API needs a Promise bridge in the ES2022 target.
            // oxlint-disable-next-line promise/avoid-new
            new Promise<number | undefined>((resolve, reject) => {
              const request = nodeRequest(server.url, { method: 'POST', path }, (response) => {
                response.resume()
                response.once('end', () => {
                  resolve(response.statusCode)
                })
              })
              request.once('error', reject)
              request.setTimeout(1000, () => {
                request.destroy(new Error('Request timed out'))
              })
              request.end()
            }),
        )
        expect(status).toBe(400)
      }
      expect((yield* Effect.promise(async () => fetch(`${server.url}/health`))).status).toBe(200)
      const client = yield* makeExampleRpcClient(server.rpcUrl)
      expect(yield* client('users.list', undefined)).toHaveLength(12)
    }),
  )

  it.effect('exposes explicit readiness and browser-safe RPC transport metadata', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()

      const readiness = yield* Effect.promise(async () => fetch(`${server.url}/health`))
      expect(readiness.status).toBe(200)
      const healthJson: unknown = yield* Effect.promise(async () => {
        const json: unknown = await readiness.json()
        return json
      })
      expect(
        yield* Schema.decodeUnknownEffect(Schema.Struct({ status: Schema.Literal('ready') }))(
          healthJson,
        ),
      ).toStrictEqual({ status: 'ready' })

      const preflight = yield* Effect.promise(async () =>
        fetch(server.rpcUrl, {
          headers: {
            'access-control-request-headers':
              'baggage,content-type,traceparent,tracestate,x-example-authorization',
            'access-control-request-method': 'POST',
            origin: 'http://127.0.0.1:5173',
          },
          method: 'OPTIONS',
        }),
      )
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
      expect(preflight.headers.get('access-control-allow-headers')).toBe(
        'baggage,content-type,traceparent,tracestate,x-example-authorization',
      )
      expect(preflight.headers.get('access-control-allow-methods')).toContain('POST')

      const missing = yield* Effect.promise(async () => fetch(`${server.url}/missing`))
      expect(missing.status).toBe(404)
    }),
  )

  it.effect('logs structured HTTP response metadata for RPC requests', () => {
    const entries: {
      readonly annotations: unknown
      readonly message: unknown
    }[] = []
    // Void is the deliberate success channel of this Effect factory.
    // oxlint-disable-next-line typescript/no-invalid-void-type
    const collectingLogger = Logger.make<unknown, void>((options) => {
      const entry = Logger.formatStructured.log(options)
      const annotations: unknown = entry.annotations
      const message: unknown = entry.message
      entries.push({ annotations, message })
    })

    return Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const client = yield* makeExampleRpcClient(server.rpcUrl)

      yield* client('users.list', undefined)

      expect(entries).toContainEqual({
        // Vitest's matcher returns any, widened here because entries are checked by the matcher.
        // SAFETY: expect.objectContaining is consumed only as an expected test value.
        annotations: expect.objectContaining({
          'http.method': 'POST',
          'http.status': 200,
          'http.url': '/rpc/',
        }) as unknown,
        message: 'Sent HTTP response',
      })
    }).pipe(Effect.provide(Logger.layer([collectingLogger])))
  })

  it.effect('serves deterministic user state over HTTP and resets it explicitly', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const client = yield* makeExampleRpcClient(server.rpcUrl)
      yield* client('testing.reset', undefined)

      const initialDirectory = yield* client('users.list', undefined)
      expect(initialDirectory).toHaveLength(12)
      expect(initialDirectory[0]).toStrictEqual(
        new User({ id: 1, locale: 'en', name: 'Ada Lovelace' }),
      )
      expect(initialDirectory[11]).toStrictEqual(
        new User({ id: 12, locale: 'en', name: 'James Gosling' }),
      )

      expect(yield* client('users.create', { name: 'Grace Hopper' })).toStrictEqual(
        new User({
          id: 13,
          locale: 'en',
          name: 'Grace Hopper',
        }),
      )

      expect(yield* client('testing.reset', undefined)).toBeUndefined()
      expect(yield* client('users.list', undefined)).toStrictEqual(initialDirectory)
    }),
  )

  it.live('seeds deterministically and exposes defaults, failures, middleware, and streams', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const client = yield* makeExampleRpcClient(server.rpcUrl)
      yield* client('testing.reset', undefined)

      expect(
        yield* client('testing.seed', {
          users: [{ name: 'Grace Hopper' }, { locale: 'nl', name: 'Dijkstra' }],
        }),
      ).toStrictEqual([
        new User({ id: 1, locale: 'en', name: 'Grace Hopper' }),
        new User({ id: 2, locale: 'nl', name: 'Dijkstra' }),
      ])
      expect(yield* client('users.get', { id: 1 })).toStrictEqual(
        new User({
          id: 1,
          locale: 'en',
          name: 'Grace Hopper',
        }),
      )

      const unauthorized = yield* Effect.flip(client('users.delete', { id: 1 }))
      expect(unauthorized).toMatchObject({
        _tag: 'ExampleAuthorizationError',
        reason: 'missing-example-authorization',
      })

      expect(
        yield* RpcClient.withHeaders(client('users.delete', { id: 1 }), {
          'x-example-authorization': 'allowed',
        }),
      ).toBeUndefined()
      expect(yield* client('users.list', undefined)).toStrictEqual([
        new User({ id: 2, locale: 'nl', name: 'Dijkstra' }),
      ])

      const declaredFailure = yield* Effect.exit(client('diagnostics.fail', undefined))
      expect(Exit.isFailure(declaredFailure)).toBe(true)
      if (Exit.isSuccess(declaredFailure)) {
        return yield* Effect.die('Expected diagnostics.fail to fail')
      }
      expect(Result.getOrThrow(Cause.findError(declaredFailure.cause))).toMatchObject({
        _tag: 'DiagnosticFailure',
        reason: 'requested-failure',
      })

      const streamed = yield* Stream.runCollect(client('diagnostics.stream', undefined))
      expect([...streamed]).toStrictEqual([
        'Connection opened',
        'Permissions loaded',
        'Workspace synchronized',
        'Ready',
      ])
      return yield* Effect.void
    }),
  )

  it.live('reports slow-operation interruption through the RPC interface', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const client = yield* makeExampleRpcClient(server.rpcUrl)
      yield* client('testing.reset', undefined)
      const slow = yield* client('diagnostics.slow', { durationMs: 60_000 }).pipe(Effect.forkChild)

      expect(yield* waitForStatus(client, ({ started }) => started === 1)).toStrictEqual({
        interrupted: 0,
        started: 1,
      })
      yield* Fiber.interrupt(slow)
      expect(yield* waitForStatus(client, ({ interrupted }) => interrupted === 1)).toStrictEqual({
        interrupted: 1,
        started: 1,
      })
    }),
  )

  it.live('finishes active client fibers before closing their RPC scope', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const subject = yield* Effect.acquireRelease(
        Effect.promise(async () => startExampleRpcClient(server.rpcUrl)),
        (client) => Effect.promise(async () => client.dispose()).pipe(Effect.orDie),
      )
      const observer = yield* makeExampleRpcClient(server.rpcUrl)
      yield* observer('testing.reset', undefined)

      const running = subject.runPromiseExit(
        subject.client('diagnostics.slow', {
          durationMs: 60_000,
          operationId: 'dispose-active-client',
        }),
      )

      expect(yield* waitForStatus(observer, ({ started }) => started === 1)).toStrictEqual({
        interrupted: 0,
        started: 1,
      })

      yield* Effect.promise(async () => subject.dispose())
      expect(Exit.isFailure(yield* Effect.promise(async () => running))).toBe(true)
      expect(yield* waitForStatus(observer, ({ interrupted }) => interrupted === 1)).toStrictEqual({
        interrupted: 1,
        started: 1,
      })
    }),
  )

  it.live('tracks interruptions from independently created clients', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const firstClient = yield* makeExampleRpcClient(server.rpcUrl)
      const secondClient = yield* makeExampleRpcClient(server.rpcUrl)
      yield* firstClient('testing.reset', undefined)
      const firstSlow = yield* firstClient('diagnostics.slow', { durationMs: 60_000 }).pipe(
        Effect.forkChild,
      )
      const secondSlow = yield* secondClient('diagnostics.slow', { durationMs: 60_000 }).pipe(
        Effect.forkChild,
      )

      expect(yield* waitForStatus(firstClient, ({ started }) => started === 2)).toStrictEqual({
        interrupted: 0,
        started: 2,
      })
      yield* Fiber.interrupt(firstSlow)
      expect(
        yield* waitForStatus(firstClient, ({ interrupted }) => interrupted === 1),
      ).toStrictEqual({
        interrupted: 1,
        started: 2,
      })
      yield* Fiber.interrupt(secondSlow)
      expect(
        yield* waitForStatus(firstClient, ({ interrupted }) => interrupted === 2),
      ).toStrictEqual({
        interrupted: 2,
        started: 2,
      })
    }),
  )

  it.live('stops accepting requests when its owner closes the Scope', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const server = yield* startExampleRpcServer().pipe(Scope.provide(scope))

      expect((yield* Effect.promise(async () => fetch(`${server.url}/health`))).status).toBe(200)
      yield* Scope.close(scope, Exit.void)
      yield* Effect.promise(async () =>
        expect(fetch(`${server.url}/health`)).rejects.toThrow('fetch failed'),
      )
    }),
  )

  it.live('releases its listener when the owning fiber is interrupted', () =>
    Effect.gen(function* () {
      const listening = yield* Deferred.make<number>()
      const starting = yield* startExampleRpcServer().pipe(
        Effect.tap((server) => Deferred.succeed(listening, server.port)),
        Effect.andThen(Effect.never),
        Effect.scoped,
        Effect.forkChild,
      )
      const port = yield* Deferred.await(listening)
      yield* Fiber.interrupt(starting)

      const replacement = yield* startExampleRpcServer({ port })
      expect(replacement.port).toBe(port)
      expect((yield* Effect.promise(async () => fetch(`${replacement.url}/health`))).status).toBe(
        200,
      )
    }),
  )

  it.live('releases its listener when startup is interrupted during hostname resolution', () =>
    Effect.gen(function* () {
      const reservation = yield* Scope.make()
      const reserved = yield* startExampleRpcServer().pipe(Scope.provide(reservation))
      const { port } = reserved
      yield* Scope.close(reservation, Exit.void)

      const lookupRequested = yield* Deferred.make<() => void>()
      const lookup = yield* Effect.acquireRelease(
        Effect.sync(() => vi.spyOn(dns, 'lookup')),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore()
          }),
      )
      // Node's DNS callback is controlled here to pause real server startup.
      /* oxlint-disable promise/prefer-await-to-callbacks */
      lookup.mockImplementationOnce(
        (
          _hostname,
          optionsOrCallback:
            | dns.LookupOptions
            | ((error: NodeJS.ErrnoException | null, address: string, family: number) => void),
          callback?: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
        ) => {
          Deferred.doneUnsafe(
            lookupRequested,
            Effect.succeed(() => {
              if (Predicate.isFunction(optionsOrCallback)) {
                optionsOrCallback(null, '127.0.0.1', 4)
                return
              }
              callback?.(null, [{ address: '127.0.0.1', family: 4 }])
            }),
          )
        },
      )
      /* oxlint-enable promise/prefer-await-to-callbacks */
      const starting = yield* startExampleRpcServer({ host: 'localhost', port }).pipe(
        Effect.scoped,
        Effect.forkChild,
      )
      const completeLookup = yield* Deferred.await(lookupRequested)
      const interruption = yield* Fiber.interrupt(starting).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Effect.yieldNow
      yield* Effect.sync(completeLookup)
      yield* Fiber.join(interruption)

      const replacement = yield* startExampleRpcServer({ port })
      expect(replacement.port).toBe(port)
    }),
  )
})
