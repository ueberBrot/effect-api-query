import type { DiagnosticStatus } from '@effect-api-query/contracts'
import {
  type ExampleRpcClient,
  makeExampleRpcClient,
  startExampleRpcClient,
} from '@effect-api-query/contracts/client'
import { startExampleRpcServer } from '@effect-api-query/server'
import { describe, expect, it } from '@effect/vitest'
import { Cause, Deferred, Effect, Exit, Fiber, Logger, Result, Scope, Stream } from 'effect'
import { RpcClient } from 'effect/unstable/rpc'
import { createServer, request as nodeRequest } from 'node:http'

import { acquireNodeServer } from '../src/node-server-resource.ts'

const waitForStatus = Effect.fn('TestExampleRpc.waitForStatus')(function* (
  client: ExampleRpcClient,
  predicate: (status: DiagnosticStatus) => boolean,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = yield* client('diagnostics.status', undefined)
    if (predicate(status)) return status
    yield* Effect.sleep('10 millis')
  }
  return yield* Effect.die(new Error('Timed out waiting for diagnostic status'))
})

describe('example RPC server', () => {
  it.live('rejects oversized chunked bodies before the client finishes sending', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const status = yield* Effect.promise(
        () =>
          new Promise<number | undefined>((resolve, reject) => {
            const request = nodeRequest(server.rpcUrl, { method: 'POST' }, (response) => {
              response.resume()
              response.once('end', () => {
                request.destroy()
                resolve(response.statusCode)
              })
            })
            request.once('error', reject)
            request.setTimeout(1000, () => request.destroy(new Error('Request timed out')))
            request.write(' '.repeat(1024 * 1024 + 1))
          }),
      )
      expect(status).toBe(413)
      expect((yield* Effect.promise(() => fetch(`${server.url}/health`))).status).toBe(200)
    }),
  )

  it.live('rejects malformed request targets and continues serving requests', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      for (const path of ['//[', 'http://user:password@localhost/rpc']) {
        const status = yield* Effect.promise(
          () =>
            new Promise<number | undefined>((resolve, reject) => {
              const request = nodeRequest(server.url, { method: 'POST', path }, (response) => {
                response.resume()
                response.once('end', () => resolve(response.statusCode))
              })
              request.once('error', reject)
              request.setTimeout(1000, () => request.destroy(new Error('Request timed out')))
              request.end()
            }),
        )
        expect(status).toBe(400)
      }
      expect((yield* Effect.promise(() => fetch(`${server.url}/health`))).status).toBe(200)
      const client = yield* makeExampleRpcClient(server.rpcUrl)
      expect(yield* client('users.list', undefined)).toHaveLength(12)
    }),
  )

  it.effect('exposes explicit readiness and browser-safe RPC transport metadata', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()

      const readiness = yield* Effect.promise(() => fetch(`${server.url}/health`))
      expect(readiness.status).toBe(200)
      expect(yield* Effect.promise(() => readiness.json())).toEqual({ status: 'ready' })

      const preflight = yield* Effect.promise(() =>
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

      const missing = yield* Effect.promise(() => fetch(`${server.url}/missing`))
      expect(missing.status).toBe(404)
    }),
  )

  it.effect('logs structured HTTP response metadata for RPC requests', () => {
    const entries: Array<{
      readonly annotations: Record<string, unknown>
      readonly message: unknown
    }> = []
    const collectingLogger = Logger.make<unknown, void>((options) => {
      const entry = Logger.formatStructured.log(options)
      entries.push({ annotations: entry.annotations, message: entry.message })
    })

    return Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const client = yield* makeExampleRpcClient(server.rpcUrl)

      yield* client('users.list', undefined)

      expect(entries).toContainEqual({
        annotations: expect.objectContaining({
          'http.method': 'POST',
          'http.status': 200,
          'http.url': '/rpc/',
        }),
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
      expect(initialDirectory[0]).toEqual({ id: 1, locale: 'en', name: 'Ada Lovelace' })
      expect(initialDirectory[11]).toEqual({ id: 12, locale: 'en', name: 'James Gosling' })

      expect(yield* client('users.create', { name: 'Grace Hopper' })).toEqual({
        id: 13,
        locale: 'en',
        name: 'Grace Hopper',
      })

      expect(yield* client('testing.reset', undefined)).toBeUndefined()
      expect(yield* client('users.list', undefined)).toEqual(initialDirectory)
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
      ).toEqual([
        { id: 1, locale: 'en', name: 'Grace Hopper' },
        { id: 2, locale: 'nl', name: 'Dijkstra' },
      ])
      expect(yield* client('users.get', { id: 1 })).toEqual({
        id: 1,
        locale: 'en',
        name: 'Grace Hopper',
      })

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
      expect(yield* client('users.list', undefined)).toEqual([
        { id: 2, locale: 'nl', name: 'Dijkstra' },
      ])

      const declaredFailure = yield* Effect.exit(client('diagnostics.fail', undefined))
      expect(Exit.isFailure(declaredFailure)).toBe(true)
      if (Exit.isSuccess(declaredFailure))
        return yield* Effect.die('Expected diagnostics.fail to fail')
      expect(Result.getOrThrow(Cause.findError(declaredFailure.cause))).toMatchObject({
        _tag: 'DiagnosticFailure',
        reason: 'requested-failure',
      })

      const streamed = yield* Stream.runCollect(client('diagnostics.stream', undefined))
      expect(Array.from(streamed)).toEqual([
        'Connection opened',
        'Permissions loaded',
        'Workspace synchronized',
        'Ready',
      ])
    }),
  )

  it.live('reports slow-operation interruption through the RPC interface', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const client = yield* makeExampleRpcClient(server.rpcUrl)
      yield* client('testing.reset', undefined)
      const slow = yield* client('diagnostics.slow', { durationMs: 60_000 }).pipe(Effect.forkChild)

      expect(yield* waitForStatus(client, ({ started }) => started === 1)).toEqual({
        interrupted: 0,
        started: 1,
      })
      yield* Fiber.interrupt(slow)
      expect(yield* waitForStatus(client, ({ interrupted }) => interrupted === 1)).toEqual({
        interrupted: 1,
        started: 1,
      })
    }),
  )

  it.live('finishes active client fibers before closing their RPC scope', () =>
    Effect.gen(function* () {
      const server = yield* startExampleRpcServer()
      const subject = yield* Effect.acquireRelease(
        Effect.promise(() => startExampleRpcClient(server.rpcUrl)),
        (client) => Effect.promise(() => client.dispose()).pipe(Effect.orDie),
      )
      const observer = yield* makeExampleRpcClient(server.rpcUrl)
      yield* observer('testing.reset', undefined)

      const running = subject.runPromiseExit(
        subject.client('diagnostics.slow', {
          durationMs: 60_000,
          operationId: 'dispose-active-client',
        }),
      )

      expect(yield* waitForStatus(observer, ({ started }) => started === 1)).toEqual({
        interrupted: 0,
        started: 1,
      })

      yield* Effect.promise(() => subject.dispose())
      expect(Exit.isFailure(yield* Effect.promise(() => running))).toBe(true)
      expect(yield* waitForStatus(observer, ({ interrupted }) => interrupted === 1)).toEqual({
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

      expect(yield* waitForStatus(firstClient, ({ started }) => started === 2)).toEqual({
        interrupted: 0,
        started: 2,
      })
      yield* Fiber.interrupt(firstSlow)
      expect(yield* waitForStatus(firstClient, ({ interrupted }) => interrupted === 1)).toEqual({
        interrupted: 1,
        started: 2,
      })
      yield* Fiber.interrupt(secondSlow)
      expect(yield* waitForStatus(firstClient, ({ interrupted }) => interrupted === 2)).toEqual({
        interrupted: 2,
        started: 2,
      })
    }),
  )

  it.live('stops accepting requests when its owner closes the Scope', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const server = yield* startExampleRpcServer().pipe(Scope.provide(scope))

      expect((yield* Effect.promise(() => fetch(`${server.url}/health`))).status).toBe(200)
      yield* Scope.close(scope, Exit.void)
      yield* Effect.promise(() => expect(fetch(`${server.url}/health`)).rejects.toThrow())
    }),
  )

  it.live('releases a listener when startup is interrupted', () =>
    Effect.gen(function* () {
      const listening = yield* Deferred.make<number>()
      const finishAcquisition = yield* Deferred.make<void>()
      const owner = yield* Scope.make()
      const nodeServer = createServer()
      const listen = Effect.callback<number>((resume) => {
        nodeServer.listen(0, '127.0.0.1', () => {
          const address = nodeServer.address()
          if (address === null || typeof address === 'string') {
            resume(Effect.die('Expected a TCP address'))
            return
          }
          resume(Effect.succeed(address.port))
        })
      }).pipe(
        Effect.tap((port) => Deferred.succeed(listening, port)),
        Effect.tap(() => Deferred.await(finishAcquisition)),
      )
      const starting = yield* acquireNodeServer(nodeServer, listen).pipe(
        Scope.provide(owner),
        Effect.forkChild,
      )
      const port = yield* Deferred.await(listening)
      const interruption = yield* Fiber.interrupt(starting).pipe(Effect.forkChild)

      yield* Deferred.succeed(finishAcquisition, undefined)
      yield* Fiber.join(interruption)
      yield* Scope.close(owner, Exit.void)

      const replacement = yield* startExampleRpcServer({ port })
      expect(replacement.port).toBe(port)
    }),
  )
})
