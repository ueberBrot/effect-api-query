---
title: Query and Mutation Operations
description: Choose queries, mutations, pagination, or streams for your API calls.
---

Every unary RPC leaf exposes query, infinite-query, and mutation builders. The RPC definition does
not decide how the application uses the operation.

Every retained HTTP endpoint exposes query, infinite-query, and mutation builders regardless of
its HTTP method. Choose the builder according to the call's role in your application. HTTP stream
builders are deferred.

Use a query when TanStack should cache a result by semantic request identity. Payload-bearing query
keys contain the normalized, canonical payload, and TanStack can refetch or cancel the query.

Use a mutation when the call represents an action or write. Mutation variables arrive when the
mutation runs, and their values do not become part of the mutation key.

Use an infinite query when TanStack should accumulate paginated results. Map each page parameter
to an RPC payload or complete decoded HTTP request; the mapped initial request becomes part of
the semantic key. Keep stable filters in every page request. See
[HTTP pagination](/effect-api-query/guides/http-queries-and-mutations/#load-pages) or
[RPC pagination](/effect-api-query/reference/generated-builders/#build-an-infinite-query).

Use an accumulated streamed query when the application needs every emitted value in order. Use a
live query when it needs only the latest emitted value. Both operations close their stream iterator
when TanStack cancels the query.

```ts
const user = useQuery(rpcQuery.users.get.queryOptions({ input: { id: 1 } }))

const removeUser = useMutation(rpcQuery.users.delete.mutationOptions())
removeUser.mutate({ id: 1 })
```

After a successful mutation, invalidate the affected query prefix explicitly. The package does not
infer relationships between API operations.

The [public RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/public-contract.ts) and
[public HTTP consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-contract.ts) check these builder and hook contracts.
