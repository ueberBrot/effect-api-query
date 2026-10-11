import { Deferred, Effect, Stream, Tracer } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { traceFeed } from '../../../tests/types/docs-stream-tracing.ts'

describe('stream tracing recipe', () => {
  it('traces lazy pulls and waits for asynchronous cleanup before ending the span', async () => {
    const spans: Tracer.NativeSpan[] = []
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      },
    })
    const cleanupStarted = Deferred.makeUnsafe<undefined>()
    const allowCleanup = Deferred.makeUnsafe<undefined>()
    const source = Stream.concat(Stream.succeed('Ready'), Stream.never).pipe(
      Stream.ensuring(
        Effect.gen(function* () {
          yield* Deferred.succeed(cleanupStarted, undefined)
          yield* Deferred.await(allowCleanup)
        }),
      ),
    )
    const iterable = await Effect.runPromise(
      Stream.toAsyncIterableEffect(traceFeed(source)).pipe(Effect.withTracer(tracer)),
    )
    expect(spans).toHaveLength(0)
    const iterator = iterable[Symbol.asyncIterator]()
    try {
      await expect(iterator.next()).resolves.toStrictEqual({ value: 'Ready', done: false })
      expect(spans[0]?.status._tag).toBe('Started')
      expect(spans[0]?.attributes.get('feed.received')).toBe(true)
      const closing = iterator.return?.()
      await Effect.runPromise(Deferred.await(cleanupStarted))
      expect(spans[0]?.status._tag).toBe('Started')
      await Effect.runPromise(Deferred.succeed(allowCleanup, undefined))
      await closing
      expect(spans[0]?.status._tag).toBe('Ended')
      expect(spans[0]?.attributes.get('feed.cleanup')).toBe(true)
    } finally {
      await Effect.runPromise(Deferred.succeed(allowCleanup, undefined))
      await iterator.return?.()
    }
  })
})
