import { defaultShouldDehydrateQuery } from '@tanstack/react-query'
import type { DehydratedState } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { Effect } from 'effect'

import type { TanStackStartApplication } from './application.ts'
import { makeSnapshotPreparation } from './snapshot-preparation.ts'
import type { SnapshotPreparation } from './snapshot-preparation.ts'

type SnapshotQueries = DehydratedState['queries']
interface RouterSnapshot {
  readonly query?: {
    initial?: DehydratedState['queries']
    readonly stream: ReadableStream<DehydratedState['queries']>
  }
}
const defaultPreparation: SnapshotPreparation = {
  beforeEncode: Effect.yieldNow,
  beforeDecode: Effect.yieldNow,
}

const prepareSnapshot = async (
  snapshot: RouterSnapshot,
  prepare: (queries: SnapshotQueries) => Promise<SnapshotQueries>,
): Promise<RouterSnapshot> => {
  if (snapshot.query === undefined) {
    return snapshot
  }
  let initial: SnapshotQueries | undefined
  try {
    initial =
      snapshot.query.initial === undefined ? undefined : await prepare(snapshot.query.initial)
  } catch (error) {
    await snapshot.query.stream.cancel(error)
    throw error
  }
  const query: NonNullable<RouterSnapshot['query']> = {
    stream: snapshot.query.stream.pipeThrough(
      new TransformStream({
        transform: async (queries, controller) => {
          controller.enqueue(await prepare(queries))
        },
      }),
    ),
  }
  if (initial !== undefined) {
    query.initial = initial
  }
  return { ...snapshot, query }
}

export const setupQuerySsr = (
  router: AnyRouter,
  application: TanStackStartApplication,
  preparation: SnapshotPreparation = defaultPreparation,
): void => {
  const codecs = makeSnapshotPreparation(application, preparation)
  setupRouterSsrQueryIntegration({
    dehydrateOptions: { shouldDehydrateQuery: defaultShouldDehydrateQuery },
    queryClient: application.queryClient,
    router,
  })
  const nativeDehydrate:
    | (() => RouterSnapshot | undefined | Promise<RouterSnapshot | undefined>)
    | undefined = router.options.dehydrate
  if (nativeDehydrate !== undefined) {
    router.options.dehydrate = async () => {
      const snapshot = await nativeDehydrate()
      return snapshot === undefined ? undefined : await prepareSnapshot(snapshot, codecs.encode)
    }
  }
  const nativeHydrate = router.options.hydrate
  if (nativeHydrate !== undefined) {
    router.options.hydrate = async (snapshot: RouterSnapshot) => {
      await nativeHydrate(await prepareSnapshot(snapshot, codecs.decode))
    }
  }
}
