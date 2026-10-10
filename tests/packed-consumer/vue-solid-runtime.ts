import type { InferDataFromTag, InferErrorFromTag } from '@tanstack/query-core'
import {
  QueryClient as SolidQueryClient,
  QueryClientProvider,
  useQuery as useSolidQuery,
} from '@tanstack/solid-query'
import {
  QueryClient as VueQueryClient,
  VueQueryPlugin,
  useQuery as useVueQuery,
} from '@tanstack/vue-query'
import { type EffectRpcQueryError, type EffectRpcQueryEmptyStreamError } from 'effect-api-query'
import { createComponent, createEffect, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { computed, createApp, defineComponent, h, ref } from 'vue'

import { expectEqual, makeFixture, waitFor } from './framework-fixture.ts'

const runVue = async () => {
  const fixture = await makeFixture('vue')
  const client = new VueQueryClient({ defaultOptions: { queries: { retry: false } } })
  const id = ref(1)
  const enabled = ref(false)
  let data: () => unknown = () => undefined
  let fetchStatus: () => string = () => 'idle'
  let views: () => unknown = () => undefined
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(
    defineComponent({
      setup() {
        const result = useVueQuery<
          number,
          EffectRpcQueryError<never> | EffectRpcQueryEmptyStreamError
        >(
          computed(() =>
            fixture.utils.values.watch.liveOptions({
              input: { id: id.value },
              enabled: () => enabled.value,
            }),
          ),
        )
        const historyOptions = computed(() =>
          fixture.utils.values.watch.streamedOptions({
            input: { id: id.value + 10 },
            maxChunks: 2,
          }),
        )
        const history = useVueQuery<
          InferDataFromTag<unknown, typeof historyOptions.value.queryKey>,
          InferErrorFromTag<Error, typeof historyOptions.value.queryKey>
        >(historyOptions)
        const liveOptions = computed(() =>
          fixture.http.values.watch.liveOptions({ input: { params: { id: id.value + 100 } } }),
        )
        const httpLive = useVueQuery<
          InferDataFromTag<unknown, typeof liveOptions.value.queryKey>,
          InferErrorFromTag<Error, typeof liveOptions.value.queryKey>
        >(liveOptions)
        const httpOptions = computed(() =>
          fixture.http.values.watch.streamedOptions({
            input: { params: { id: id.value + 110 } },
            maxChunks: 2,
          }),
        )
        const httpHistory = useVueQuery<
          InferDataFromTag<unknown, typeof httpOptions.value.queryKey>,
          InferErrorFromTag<Error, typeof httpOptions.value.queryKey>
        >(httpOptions)
        const metaOptions = computed(() =>
          fixture.http.values.read.metadataOptions({
            input: { params: { id: id.value + 100 } },
            select: (value) => value.data,
          }),
        )
        const metadata = useVueQuery<
          InferDataFromTag<unknown, typeof metaOptions.value.queryKey>,
          InferErrorFromTag<Error, typeof metaOptions.value.queryKey>,
          number
        >(metaOptions)
        data = () => result.data.value
        fetchStatus = () => result.fetchStatus.value
        views = () => [
          history.data.value,
          httpLive.data.value,
          httpHistory.data.value,
          metadata.data.value,
        ]
        return () => h('output', JSON.stringify([result.data.value, views()]))
      },
    }),
  ).use(VueQueryPlugin, { queryClient: client })
  try {
    app.mount(host)
    expectEqual(data(), undefined, 'Vue keeps a disabled stream empty')
    expectEqual(fetchStatus(), 'idle', 'Vue does not fetch its disabled stream')
    enabled.value = true
    await waitFor(() => data() === 1, 'Vue did not expose the first open-stream value')
    await waitFor(
      () => JSON.stringify(views()) === '[[11],101,[111],101]',
      'Vue did not expose every first stream view',
    )
    expectEqual(fetchStatus(), 'fetching', 'Vue first value remains open')
    expectEqual(client.isFetching(), 4, 'Vue stream views remain open')
    id.value = 2
    await waitFor(() => data() === 2, 'Vue did not rebuild options after input changed')
    await waitFor(() => fixture.finalized.includes(1), 'Vue did not finalize the replaced stream')
    await waitFor(
      () => JSON.stringify(views()) === '[[12],102,[112],102]',
      'Vue views did not follow the changed input',
    )
    expectEqual(host.textContent, '[2,[[12],102,[112],102]]', 'Vue rendered the changed views')
    app.unmount()
    await waitFor(() => fixture.finalized.includes(2), 'Vue did not finalize its unmounted stream')
    await waitFor(
      () => fixture.finalized.length === 4 && fixture.httpFinalized.length === 4,
      'Vue did not finalize every owned stream',
    )
    expectEqual(
      [...fixture.finalized].sort((a, b) => a - b),
      [1, 2, 11, 12],
      'Vue owns all RPC streams',
    )
    expectEqual(
      [...fixture.httpFinalized].sort((a, b) => a - b),
      [101, 102, 111, 112],
      'Vue owns all HTTP streams',
    )
  } finally {
    app.unmount()
    await client.cancelQueries()
    client.clear()
    await fixture.close()
    host.remove()
  }
}

const runSolid = async () => {
  const fixture = await makeFixture('solid')
  const client = new SolidQueryClient({ defaultOptions: { queries: { retry: false } } })
  const [id, setId] = createSignal(1)
  let data: () => unknown = () => undefined
  let fetchStatus: () => string = () => 'idle'
  let views: () => unknown = () => undefined
  const host = document.createElement('div')
  document.body.append(host)
  const Component = () => {
    const result = useSolidQuery(() =>
      fixture.utils.values.watch.liveOptions({ input: { id: id() } }),
    )
    const history = useSolidQuery(() =>
      fixture.utils.values.watch.streamedOptions({ input: { id: id() + 10 }, maxChunks: 2 }),
    )
    const httpLive = useSolidQuery(() =>
      fixture.http.values.watch.liveOptions({ input: { params: { id: id() + 100 } } }),
    )
    const httpHistory = useSolidQuery(() =>
      fixture.http.values.watch.streamedOptions({
        input: { params: { id: id() + 110 } },
        maxChunks: 2,
      }),
    )
    const metadata = useSolidQuery(() =>
      fixture.http.values.read.metadataOptions({
        input: { params: { id: id() + 100 } },
        select: (value) => value.data,
      }),
    )
    data = () => result.data
    fetchStatus = () => result.fetchStatus
    views = () => [history.data, httpLive.data, httpHistory.data, metadata.data]
    const output = document.createElement('output')
    createEffect(() => {
      output.textContent = JSON.stringify([result.data, views()])
    })
    return output
  }
  const dispose = render(
    () =>
      createComponent(QueryClientProvider, {
        client,
        get children() {
          return createComponent(Component, {})
        },
      }),
    host,
  )
  try {
    await waitFor(() => data() === 1, 'Solid did not expose the first open-stream value')
    await waitFor(
      () => JSON.stringify(views()) === '[[11],101,[111],101]',
      'Solid did not expose every first stream view',
    )
    expectEqual(fetchStatus(), 'fetching', 'Solid first value remains open')
    expectEqual(client.isFetching(), 4, 'Solid stream views remain open')
    setId(2)
    await waitFor(() => data() === 2, 'Solid did not rebuild options after input changed')
    await waitFor(() => fixture.finalized.includes(1), 'Solid did not finalize the replaced stream')
    await waitFor(
      () => JSON.stringify(views()) === '[[12],102,[112],102]',
      'Solid views did not follow the changed input',
    )
    expectEqual(host.textContent, '[2,[[12],102,[112],102]]', 'Solid rendered the changed views')
    dispose()
    await waitFor(
      () => fixture.finalized.includes(2),
      'Solid did not finalize its unmounted stream',
    )
    await waitFor(
      () => fixture.finalized.length === 4 && fixture.httpFinalized.length === 4,
      'Solid did not finalize every owned stream',
    )
    expectEqual(
      [...fixture.finalized].sort((a, b) => a - b),
      [1, 2, 11, 12],
      'Solid owns all RPC streams',
    )
    expectEqual(
      [...fixture.httpFinalized].sort((a, b) => a - b),
      [101, 102, 111, 112],
      'Solid owns all HTTP streams',
    )
  } finally {
    dispose()
    await client.cancelQueries()
    client.clear()
    await fixture.close()
    host.remove()
  }
}

void runVue()
  .then(runSolid)
  .then(
    () => {
      document.documentElement.dataset['frameworkStatus'] = 'passed'
    },
    (error: unknown) => {
      document.documentElement.dataset['frameworkStatus'] = 'failed'
      document.documentElement.dataset['frameworkMessage'] = String(error)
    },
  )
