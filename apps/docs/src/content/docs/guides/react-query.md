---
title: React Query
description: Use generated options with React Query hooks.
---

Create the RPC utility tree beside the application's `QueryClient`, then provide both through your
application context. Generated options pass directly to React Query hooks.

In the example below, `AppRpcQuery` is your utility tree's type, such as `typeof rpcQuery`.

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const Users = ({ rpcQuery }: { rpcQuery: AppRpcQuery }) => {
  const queryClient = useQueryClient()
  const users = useQuery(rpcQuery.users.list.queryOptions())
  const removeUser = useMutation(
    rpcQuery.users.delete.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: rpcQuery.users.key() }),
    }),
  )

  if (users.data === undefined) return null

  return (
    <ul>
      {users.data.map((user) => (
        <li key={user.id}>
          {user.name}
          <button onClick={() => removeUser.mutate({ id: user.id })}>Delete</button>
        </li>
      ))}
    </ul>
  )
}
```

Payload-bearing queries take constructor input inside the options argument:

```ts
useQuery(rpcQuery.users.get.queryOptions({ input: { id: 1 } }))
```

Pass mutation variables when calling `mutate`:

```ts
const createUser = useMutation(rpcQuery.users.create.mutationOptions())
createUser.mutate({ name: 'Ada' })
```

Streaming RPCs use the ordinary `useQuery` and `useSuspenseQuery` hooks. Choose whether the cache
should retain every value or only the latest value:

```ts
const events = useQuery(rpcQuery.events.watch.streamedOptions())
const latestEvent = useQuery(rpcQuery.events.watch.liveOptions())
```

The package owns each generated `queryFn`, `queryKey`, `queryKeyHashFn`, `mutationFn`, and
`mutationKey`. Stream builders own the same query fields. Other TanStack Query options, including `select`,
`retry`, and lifecycle callbacks, retain their normal TanStack types.

## Use an HTTP endpoint

The same hooks accept HTTP options. For an endpoint that declares an `id` parameter, use:

```ts
const user = useQuery(http.users.get.queryOptions({ input: { params: { id: 1 } } }))
```

Follow [HTTP Queries and Mutations](/effect-api-query/guides/http-queries-and-mutations/) to create
the HTTP utilities and configure mutation invalidation.

The [public RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/public-contract.ts) and
[public HTTP consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-contract.ts) compile these hook patterns.
The [Vite React example](/effect-api-query/examples/) provides the application setup.
