import { makeExampleRpcWebHandler } from '@effect-api-query/server/web-handler'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

describe('example RPC request body limit', () => {
  it.effect('rejects failed and aborted uploads without waiting for more bytes', () =>
    Effect.gen(function* () {
      const handler = yield* makeExampleRpcWebHandler()
      const failed = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('Upload failed'))
        },
      })
      const failedResponse = yield* Effect.promise(() =>
        handler(
          new Request('http://localhost/rpc', {
            method: 'POST',
            body: failed,
            duplex: 'half',
          } as RequestInit),
        ),
      )
      expect(failedResponse.status).toBe(400)

      const controller = new AbortController()
      let cancelled = false
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true
        },
      })
      const response = handler(
        new Request('http://localhost/rpc', {
          method: 'POST',
          body,
          signal: controller.signal,
          duplex: 'half',
        } as RequestInit),
      )
      controller.abort()
      expect((yield* Effect.promise(() => response)).status).toBe(400)
      expect(cancelled).toBe(true)
    }),
  )

  it.effect('accepts bodies up to one MiB and rejects the next byte', () =>
    Effect.gen(function* () {
      const handler = yield* makeExampleRpcWebHandler()
      for (const size of [1024 * 1024 - 1, 1024 * 1024, 1024 * 1024 + 1]) {
        const response = yield* Effect.promise(() =>
          handler(
            new Request('http://localhost/rpc', {
              method: 'POST',
              body: '[]'.padEnd(size),
            }),
          ),
        )
        expect(response.status).toBe(size > 1024 * 1024 ? 413 : 200)
        yield* Effect.promise(() => response.arrayBuffer())
      }
    }),
  )

  it.effect(
    'counts streamed bytes despite missing or misleading lengths and cancels overflow',
    () =>
      Effect.gen(function* () {
        const handler = yield* makeExampleRpcWebHandler()
        for (const headers of [{}, { 'content-length': '2' }]) {
          let cancelled = false
          const body = new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode('é'.repeat(128 * 1024)))
            },
            cancel() {
              cancelled = true
            },
          })
          const response = yield* Effect.promise(() =>
            handler(
              new Request('http://localhost/rpc', {
                method: 'POST',
                body,
                headers,
                duplex: 'half',
              } as RequestInit),
            ),
          )
          expect(response.status).toBe(413)
          expect(cancelled).toBe(true)
        }
      }),
  )
})
