---
title: React Query
description: Use generated options with React Query hooks.
---

Use the utility tree created in the application's client module. Import `useQuery`,
`useMutation`, `useSuspenseQuery`, and `useQueryClient` from `@tanstack/react-query`.
The application supplies its Query provider and exposes `rpcQuery` through context or props.

## Read in a component

Inside an existing component:

```ts
const users = useQuery(rpcQuery.users.list.queryOptions())
const user = useQuery(rpcQuery.users.get.queryOptions({ input: { id: 1 } }))
```

Payload-bearing RPC reads take constructor input. Pass native options such as `select`,
`staleTime`, or `retry` to the builder; `select` changes observer data, not the cached value.

## Write and refresh

In the same component, create the mutation with an explicit invalidation policy:

```ts
const queryClient = useQueryClient()
const removeUser = useMutation(
  rpcQuery.users.delete.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rpcQuery.users.key() }),
  }),
)
```

In its event handler, supply that execution's variables:

```ts
removeUser.mutate({ id: userId })
```

Writes do not automatically refresh reads. Choose the affected generated keys in the application.

## Observe a stream

Use ordinary query hooks inside the component for either cached representation:

```ts
const events = useQuery(rpcQuery.events.watch.streamedOptions())
const latestEvent = useQuery(rpcQuery.events.watch.liveOptions())
```

`useSuspenseQuery` also accepts these options. Streams expose data while fetching continues;
see [Choose Stream History](/effect-api-query/guides/choose-stream-history/) for retention policy.

## Use an HTTP endpoint

The same hooks accept the complete decoded request:

```ts
const user = useQuery(
  http.users.get.queryOptions({ input: { params: { id: 1 }, query: { locale: 'en' } } }),
)
```

See [HTTP Metadata](/effect-api-query/guides/http-metadata/),
[Streaming](/effect-api-query/guides/streaming/), and
[HTTP Requests and Uploads](/effect-api-query/guides/http-queries-and-mutations/).
Builders own their key/function fields; configure hashing through
QueryClient defaults. [RPC Builders](/effect-api-query/reference/generated-builders/) and
[HTTP Builders](/effect-api-query/reference/http-builders/) describe the precise option contracts.

For complete components and resource setup, use the [Vite React example](/effect-api-query/examples/):
[queries](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/components/sections/queries-section.tsx),
[mutations](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/components/sections/mutations-section.tsx),
and [application ownership](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts).
