---
title: React Query
description: Acquire a ready client and use generated options with native React Query hooks.
---

Pass generated options to React Query's native hooks. Build the utility tree once for its ready
client and cache owner. When component input changes, rebuild the options. Builders capture
plain input for each execution.

## Acquire and mount the client

Put the shared contract, client lifetime, and React UI in separate modules. Mount the application
once from the entry point.

This read-only example requires React, React DOM, `@tanstack/react-query`, Effect, and
`effect-api-query`. The server must implement the shared contract below: `GET /users/:id`
returns `{ id: number, name: string }`.

### Shared contract

Place `usersApi` in `http-contract.ts`. Both the server and client import this module.

Shared contract in `http-contract.ts`:

```ts
import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'

export const usersApi = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    }),
  ),
)
```

### Client lifetime

In `client.ts`, `startUsersApplication` acquires the ready HTTP API client. It keeps one runtime
and QueryClient alive until `dispose` runs. Export the application type for the UI module.

Client integration in `client.ts`:

```ts
import { QueryClient } from '@tanstack/react-query'
import { ManagedRuntime } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { FetchHttpClient } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'

import { usersApi } from './http-contract.ts'

export const startUsersApplication = async (baseUrl: string) => {
  const runtime = ManagedRuntime.make(FetchHttpClient.layer)
  const running = new Set<Promise<unknown>>()
  const runPromiseExit: RunPromiseExit = (effect, options) => {
    const pending = runtime.runPromiseExit(effect, options)
    running.add(pending)
    void pending.then(
      () => running.delete(pending),
      () => running.delete(pending),
    )
    return pending
  }
  try {
    const client = await runtime.runPromise(HttpApiClient.make(usersApi, { baseUrl }))
    const queryClient = new QueryClient()
    const http = createHttpApiQueryUtils(usersApi, {
      client,
      keyPrefix: ['users-app'],
      runPromiseExit,
    })
    return {
      http,
      queryClient,
      dispose: async () => {
        try {
          await queryClient.cancelQueries()
        } finally {
          try {
            await Promise.allSettled([...running])
          } finally {
            queryClient.clear()
            await runtime.dispose()
          }
        }
      },
    }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}

export type UsersApplication = Awaited<ReturnType<typeof startUsersApplication>>
```

The supplied runner forwards TanStack's abort options and tracks reads in progress. After
cancellation, disposal waits for their Effect finalizers before releasing the runtime.
Client acquisition finishes before React renders. If acquisition fails, the application disposes the runtime.

### Component and provider

In `users-app.tsx`, import the client setup and its application type. The component receives the
ready utility tree through props. `QueryClientProvider` exposes the matching cache to React Query.

React UI in `users-app.tsx`:

```tsx
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'

import { startUsersApplication } from './client.ts'
import type { UsersApplication } from './client.ts'

const User = ({ application }: { readonly application: UsersApplication }) => {
  const user = useQuery(application.http.users.get.queryOptions({ input: { params: { id: 1 } } }))
  if (user.isPending) {
    return <p>Loading user…</p>
  }
  if (user.isError) {
    return <p role="alert">Could not load the user.</p>
  }
  return <h1>{user.data.name}</h1>
}

export const mountUsersApplication = async (element: HTMLElement, baseUrl: string) => {
  const application = await startUsersApplication(baseUrl)
  const root = createRoot(element)
  root.render(
    <QueryClientProvider client={application.queryClient}>
      <User application={application} />
    </QueryClientProvider>,
  )
  return async () => {
    root.unmount()
    await application.dispose()
  }
}
```

### Application entry point

In `main.tsx`, mount into the root element supplied by your HTML page. Replace the base URL with
your server's URL.

Application entry point in `main.tsx`:

```ts
import { mountUsersApplication } from './users-app.tsx'

const element = document.getElementById('root')
if (element === null) {
  throw new Error('Missing application root element')
}

export const stopUsers = await mountUsersApplication(element, 'http://localhost:3000')
```

When tearing down the application, the host calls and awaits `stopUsers()`. That function
unmounts React, cancels outstanding reads, awaits their local finalizers, clears the cache, and
disposes the runtime. A browser's unload event cannot guarantee that asynchronous cleanup finishes.

This example has one buffered read. Before adding open streams or concurrent writes, use
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) to await their cleanup and settlement.
For RPC, replace client acquisition with the Scope and protocol in
[RPC Quick Start](/effect-api-query/getting-started/quick-start/) and pass the resulting RPC utility
tree to the component. The provider and React hooks stay the same.

## Choose the native hook

The provider and component above use a buffered HTTP query. RPC uses the same hooks with its
[constructor input](/effect-api-query/concepts/data-normalization/#query-stable-rpc-payloads).
HTTP takes [decoded request input](/effect-api-query/concepts/data-normalization/#decoded-http-inputs).

| Native consumer    | Generated options                      | Cached representation                                       |
| ------------------ | -------------------------------------- | ----------------------------------------------------------- |
| `useQuery`         | `queryOptions`, HTTP `metadataOptions` | Decoded data, or decoded data with status and headers       |
| `useInfiniteQuery` | `infiniteOptions`                      | Pages with their page parameters                            |
| `useQuery`         | `streamedOptions`, `liveOptions`       | Retained history, or the latest emitted value               |
| `useMutation`      | `mutationOptions`                      | Mutation result, with variables supplied when `mutate` runs |

Pass `select`, `staleTime`, retry policy, and other native options through the builder.
`select` changes observer data while the cache retains the generated view's query data.
Configure hashing on QueryClient before cache use. The package owns the generated key and function.
See [RPC Builders](/effect-api-query/reference/generated-builders/) and
[HTTP Builders](/effect-api-query/reference/http-builders/) for each view's exact contract.

## Share policy and refresh affected reads

Use [Defaults and Policies](/effect-api-query/guides/query-defaults/) to bind an endpoint-aware
policy once, then reuse it in components, imperative queries, or route loaders. A call-site
projection or callback keeps its native inference.

For writes, pass generated mutation options to `useMutation`. Supply variables through `mutate`.
Choose which generated keys the write affects. Writes do not invalidate reads automatically.
Use [Cache Keys and Filters](/effect-api-query/guides/cache-filters/) for broad or exact
invalidation and [Optimistic Updates](/effect-api-query/guides/optimistic-writes/) for response seeding,
rollback, and overlapping writes.

## Streams and Suspense

Ordinary hooks can show stream data while fetching continues. Choose
[history retention](/effect-api-query/guides/choose-stream-history/) for accumulated views and keep
clients alive until local iterator finalizers finish.

TanStack documents that cancellation does not work with its Suspense hooks. Use ordinary query
hooks when cancelling reads or stopping open stream work is part of the screen's lifecycle.
For buffered reads with Suspense, use
[Suspense and Error Recovery](/effect-api-query/guides/suspense-and-recovery/) for reset and retry,
cached-data refetch failures, and independent loading with `useSuspenseQueries`.

For router loaders and server rendering, continue with
[Router and Start](/effect-api-query/guides/tanstack-start/).
The [Vite React example](/effect-api-query/examples/#run-vite-react) is a complete application with
reads, writes, streams, private cache owners, and resource disposal.
