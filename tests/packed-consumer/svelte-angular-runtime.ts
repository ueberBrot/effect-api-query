import '@angular/compiler'
import { Component, signal, provideZonelessChangeDetection } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import {
  injectQuery,
  provideTanStackQuery,
  QueryClient as AngularQueryClient,
} from '@tanstack/angular-query-experimental'
import { QueryClient } from '@tanstack/query-core'
import { QueryClient as SvelteQueryClient } from '@tanstack/svelte-query'
import { mount, unmount } from 'svelte'

import { expectEqual, makeFixture, waitFor } from './framework-fixture.ts'
import SvelteConsumer from './svelte-consumer.svelte'

if (AngularQueryClient !== QueryClient || SvelteQueryClient !== QueryClient) {
  throw new Error('Framework integrations must share Query Core bindings')
}

type View = {
  data: () => unknown
  views: () => unknown
  fetchStatus: () => string
}

const verifyOwner = async (
  name: string,
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  client: QueryClient,
  host: HTMLElement,
  view: View,
  destroy: () => Promise<void> | void,
) => {
  await waitFor(() => view.data() === 1, `${name} did not expose the first open-stream value`)
  await waitFor(
    () => JSON.stringify(view.views()) === '[[11],101,[111],101]',
    `${name} did not expose every first stream view`,
  )
  expectEqual(view.fetchStatus(), 'fetching', `${name} first value remains open`)
  expectEqual(client.isFetching(), 4, `${name} stream views remain open`)
  host.querySelector('button')?.click()
  await waitFor(() => view.data() === 2, `${name} did not rebuild options after input changed`)
  await waitFor(() => fixture.finalized.includes(1), `${name} did not finalize the replaced stream`)
  await waitFor(
    () => JSON.stringify(view.views()) === '[[12],102,[112],102]',
    `${name} views did not follow the changed input`,
  )
  await waitFor(
    () => host.querySelector('output')?.textContent === '[2,[[12],102,[112],102]]',
    `${name} did not render its changed query results`,
  )
  expectEqual(
    host.querySelector('output')?.textContent,
    '[2,[[12],102,[112],102]]',
    `${name} rendered the changed views`,
  )
  await destroy()
  await waitFor(
    () => fixture.finalized.length === 4 && fixture.httpFinalized.length === 4,
    `${name} did not finalize every owned stream`,
  )
  expectEqual(
    [...fixture.finalized].sort((a, b) => a - b),
    [1, 2, 11, 12],
    `${name} owns all RPC streams`,
  )
  expectEqual(
    [...fixture.httpFinalized].sort((a, b) => a - b),
    [101, 102, 111, 112],
    `${name} owns all HTTP streams`,
  )
}

const runSvelte = async () => {
  const fixture = await makeFixture('svelte')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.mount()
  const host = document.createElement('div')
  document.body.append(host)
  let view: View | undefined
  let mounted = true
  const component = mount(SvelteConsumer, {
    target: host,
    props: {
      fixture,
      client,
      expose: (value: View) => {
        view = value
      },
    },
  })
  try {
    await waitFor(() => view !== undefined, 'Svelte did not initialize its component')
    if (view === undefined) throw new Error('Svelte has no query result')
    await verifyOwner('Svelte', fixture, client, host, view, async () => {
      mounted = false
      await unmount(component)
    })
  } finally {
    if (mounted) await unmount(component)
    await client.cancelQueries()
    client.clear()
    client.unmount()
    await fixture.close()
    host.remove()
  }
}

const runAngular = async () => {
  const fixture = await makeFixture('angular')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let instance: AngularConsumer | undefined
  class AngularConsumer {
    readonly id = signal(1)
    readonly live = injectQuery(() =>
      fixture.utils.values.watch.liveOptions({ input: { id: this.id() } }),
    )
    readonly history = injectQuery(() =>
      fixture.utils.values.watch.streamedOptions({ input: { id: this.id() + 10 }, maxChunks: 2 }),
    )
    readonly httpLive = injectQuery(() =>
      fixture.http.values.watch.liveOptions({ input: { params: { id: this.id() + 100 } } }),
    )
    readonly httpHistory = injectQuery(() =>
      fixture.http.values.watch.streamedOptions({
        input: { params: { id: this.id() + 110 } },
        maxChunks: 2,
      }),
    )
    readonly metadata = injectQuery(() =>
      fixture.http.values.read.metadataOptions({
        input: { params: { id: this.id() + 100 } },
        select: (value) => value.data,
      }),
    )
    readonly views = () => [
      this.history.data(),
      this.httpLive.data(),
      this.httpHistory.data(),
      this.metadata.data(),
    ]
    readonly output = () => JSON.stringify([this.live.data(), this.views()])
    readonly increment = (value: number) => value + 1
    constructor() {
      instance = this
    }
  }
  Component({
    selector: 'angular-consumer',
    standalone: true,
    template:
      '<button (click)="id.update(increment)">Next input</button><output>{{ output() }}</output>',
  })(AngularConsumer)
  const host = document.createElement('angular-consumer')
  document.body.append(host)
  const application = await bootstrapApplication(AngularConsumer, {
    providers: [provideZonelessChangeDetection(), provideTanStackQuery(client)],
  })
  try {
    if (instance === undefined) throw new Error('Angular did not initialize its component')
    const owner = instance
    await verifyOwner(
      'Angular',
      fixture,
      client,
      host,
      {
        data: () => owner.live.data(),
        views: owner.views,
        fetchStatus: () => owner.live.fetchStatus(),
      },
      () => application.destroy(),
    )
  } finally {
    if (!application.destroyed) application.destroy()
    await client.cancelQueries()
    client.clear()
    await fixture.close()
    host.remove()
  }
}

void runSvelte()
  .then(runAngular)
  .then(
    () => {
      document.documentElement.dataset['frameworkStatus'] = 'passed'
    },
    (error: unknown) => {
      document.documentElement.dataset['frameworkStatus'] = 'failed'
      document.documentElement.dataset['frameworkMessage'] = String(error)
    },
  )
