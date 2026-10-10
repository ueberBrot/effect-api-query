<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query'
  import type { QueryClient } from '@tanstack/query-core'
  import type { makeFixture } from './framework-fixture.ts'

  let { fixture, client, expose }: {
    fixture: Awaited<ReturnType<typeof makeFixture>>
    client: QueryClient
    expose: (view: {
      data: () => unknown
      views: () => unknown
      fetchStatus: () => string
    }) => void
  } = $props()
  let id = $state(1)
  const live = createQuery(
    () => fixture.utils.values.watch.liveOptions({ input: { id } }),
    () => client,
  )
  const history = createQuery(
    () => fixture.utils.values.watch.streamedOptions({ input: { id: id + 10 }, maxChunks: 2 }),
    () => client,
  )
  const httpLive = createQuery(
    () => fixture.http.values.watch.liveOptions({ input: { params: { id: id + 100 } } }),
    () => client,
  )
  const httpHistory = createQuery(
    () => fixture.http.values.watch.streamedOptions({
      input: { params: { id: id + 110 } },
      maxChunks: 2,
    }),
    () => client,
  )
  const metadata = createQuery(
    () => fixture.http.values.read.metadataOptions({
      input: { params: { id: id + 100 } },
      select: (value) => value.data,
    }),
    () => client,
  )
  expose({
    data: () => live.data,
    views: () => [history.data, httpLive.data, httpHistory.data, metadata.data],
    fetchStatus: () => live.fetchStatus,
  })
</script>

<button onclick={() => id += 1}>Next input</button>
<output>{JSON.stringify([live.data, [history.data, httpLive.data, httpHistory.data, metadata.data]])}</output>
