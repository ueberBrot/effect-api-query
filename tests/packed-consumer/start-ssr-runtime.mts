import { dehydrate, hydrate } from '@tanstack/react-query'
import { Deferred, Effect, Exit, Scope } from 'effect'
import { deepStrictEqual, equal, ok } from 'node:assert/strict'

import { User } from '../../examples/contracts/src/contracts.ts'
import { makeExampleHost } from '../../examples/server/src/web-handler.ts'
import { startServerApplication } from '../../examples/tanstack-start/src/lib/server-application.ts'
import { makeSnapshotPreparation } from '../../examples/tanstack-start/src/lib/snapshot-preparation.ts'

const scope = Scope.makeUnsafe()
const host = await Effect.runPromise(makeExampleHost().pipe(Scope.provide(scope)))
const server = await startServerApplication({
  host,
  identity: 'same-owner',
  authorization: 'allowed',
})
const browser = await startServerApplication({
  host,
  identity: 'same-owner',
  authorization: 'allowed',
})
try {
  const create = server.rpcQuery.users.create.mutationOptions().mutationFn
  if (create === undefined) throw new Error('Missing generated mutation')
  await create({ name: 'Shared local state' })
  const list = server.rpcQuery.users.list.queryOptions()
  equal((await server.queryClient.query(list)).length, 13)
  const pages = server.rpcQuery.users.page.infiniteOptions({
    initialPageParam: 0,
    input: (cursor: number) => ({ cursor, pageSize: 4 }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const pageData = await server.queryClient.infiniteQuery(pages)
  ok(pageData.pages[0]?.users[0] instanceof User)
  await server.captureSnapshot(
    server.queryClient,
    server.rpcQuery.diagnostics.stream.streamedOptions(),
  )
  await server.captureSnapshot(server.queryClient, server.rpcQuery.diagnostics.stream.liveOptions())
  equal((await server.queryClient.query(server.httpQuery.users.list.queryOptions())).length, 13)
  const encodingStarted = Deferred.makeUnsafe<undefined>()
  const permitEncoding = Deferred.makeUnsafe<undefined>()
  const decodingStarted = Deferred.makeUnsafe<undefined>()
  const permitDecoding = Deferred.makeUnsafe<undefined>()
  const encoding = makeSnapshotPreparation(server, {
    beforeEncode: Deferred.succeed(encodingStarted, undefined).pipe(
      Effect.andThen(Deferred.await(permitEncoding)),
    ),
    beforeDecode: Effect.void,
  })
  const decoding = makeSnapshotPreparation(browser, {
    beforeEncode: Effect.void,
    beforeDecode: Deferred.succeed(decodingStarted, undefined).pipe(
      Effect.andThen(Deferred.await(permitDecoding)),
    ),
  })
  const native = dehydrate(server.queryClient, { shouldDehydrateMutation: () => false })
  let published = false
  const publication = (async () => {
    const queries = await encoding.encode(native.queries)
    const json = JSON.stringify({ ...native, queries })
    published = true
    return json
  })()
  await Effect.runPromise(Deferred.await(encodingStarted))
  equal(published, false)
  await Effect.runPromise(Deferred.succeed(permitEncoding, undefined))
  const json = await publication
  const encoded: typeof native = JSON.parse(json)
  const hydration = (async () => {
    const queries = await decoding.decode(encoded.queries)
    hydrate(browser.queryClient, { ...encoded, queries })
  })()
  await Effect.runPromise(Deferred.await(decodingStarted))
  equal(browser.queryClient.getQueryCache().getAll().length, 0)
  await Effect.runPromise(Deferred.succeed(permitDecoding, undefined))
  await hydration
  const browserList = browser.rpcQuery.users.list.queryOptions()
  deepStrictEqual(browserList.queryKey, list.queryKey)
  let duplicateReads = 0
  const unsubscribe = browser.queryClient.getQueryCache().subscribe((event) => {
    if (event.query.state.fetchStatus === 'fetching') duplicateReads += 1
  })
  equal((await browser.queryClient.query({ ...browserList, staleTime: 'static' })).length, 13)
  equal(duplicateReads, 0)
  unsubscribe()
  ok(browser.queryClient.getQueryData(browserList.queryKey)?.[0] instanceof User)
  const hydratedPage = browser.queryClient.getQueryData(
    browser.rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 }),
  )
  deepStrictEqual(hydratedPage?.pageParams, [0])
  ok(hydratedPage?.pages[0]?.users[0] instanceof User)
  await server.dispose()
  deepStrictEqual(
    await browser.captureSnapshot(
      browser.queryClient,
      browser.rpcQuery.diagnostics.stream.streamedOptions(),
    ),
    ['Connection opened'],
  )
  equal(
    await browser.captureSnapshot(
      browser.queryClient,
      browser.rpcQuery.diagnostics.stream.liveOptions(),
    ),
    'Connection opened',
  )
  equal(
    (
      await browser.queryClient.query({
        ...browser.httpQuery.users.list.queryOptions(),
        staleTime: 0,
      })
    ).length,
    13,
  )
  const retired = await startServerApplication({
    host,
    identity: 'retired',
    authorization: 'allowed',
  })
  const preparationStarted = Deferred.makeUnsafe<undefined>()
  const permit = Deferred.makeUnsafe<undefined>()
  let released = false
  let preparing: Promise<unknown> | undefined
  try {
    await retired.queryClient.query(retired.rpcQuery.users.list.queryOptions())
    const codecs = makeSnapshotPreparation(retired, {
      beforeEncode: Effect.scoped(
        Effect.acquireRelease(Deferred.succeed(preparationStarted, undefined), () =>
          Effect.sync(() => {
            released = true
          }),
        ).pipe(Effect.andThen(Deferred.await(permit))),
      ),
      beforeDecode: Effect.void,
    })
    preparing = (async () => {
      try {
        await codecs.encode(dehydrate(retired.queryClient).queries)
        return null
      } catch (error) {
        return error
      }
    })()
    await Effect.runPromise(Deferred.await(preparationStarted))
    await retired.dispose()
    equal(released, true)
    ok(await preparing)
    equal((await browser.queryClient.query({ ...browserList, staleTime: 0 })).length, 13)
  } finally {
    await Effect.runPromise(Deferred.succeed(permit, undefined))
    await preparing
    await retired.dispose()
  }
  console.log(
    'Packed copied Start host, request lifetimes, classes, pages, streams and async hydration verified',
  )
} finally {
  await Promise.all([server.dispose(), browser.dispose()])
  await Effect.runPromise(Scope.close(scope, Exit.void))
}
