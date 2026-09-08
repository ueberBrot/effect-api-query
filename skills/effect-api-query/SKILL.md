---
name: effect-api-query
description: >-
  Use effect-api-query to derive TanStack Query options and cache keys from
  Effect RPC or HttpApi contracts. Load when wiring createRpcQueryUtils or
  createHttpApiQueryUtils, choosing
  query or mutation builders, adding pagination or RPC streams, configuring
  cache identity, handling execution failures or cancellation, or integrating
  the library with React Query or SSR.
license: ISC
metadata:
  type: core
  library: effect-api-query
---

# Use effect-api-query

Derive options from the application's contract and ready client, then pass them
to TanStack Query. This package owns utility construction and query execution;
the application owns transport, authentication, resources, and cache policy.

## Choose the adapter

Inspect the installed `effect-api-query/package.json` for its version and peer
requirements. This library targets Effect 4 APIs; use the installed declarations
when resolving API differences. Preserve literal contract types so the factory
can infer the utility tree.

Read the reference for the contract you are integrating:

| Contract         | Factory and input                                | Reference                                  |
| ---------------- | ------------------------------------------------ | ------------------------------------------ |
| Effect RPC group | `createRpcQueryUtils`; payload constructor input | [RPC setup and rules](references/rpc.md)   |
| Effect HttpApi   | `createHttpApiQueryUtils`; decoded request parts | [HTTP setup and rules](references/http.md) |

Import both factories and error guards from `effect-api-query`. The package has
one public root export. A factory accepts an already acquired client and builds
an eager, frozen utility tree without making a request.

## Choose the operation

| Need                       | Builder                                                          | TanStack consumer                                             |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Buffered read              | `queryOptions({ input, ...options })`                            | `useQuery`, `useSuspenseQuery`, `queryClient.query`           |
| Write                      | `mutationOptions({ ...callbacks })`                              | `useMutation`, `MutationObserver`; pass variables to `mutate` |
| Cursor pagination          | `infiniteOptions({ initialPageParam, input, getNextPageParam })` | `useInfiniteQuery`, `queryClient.infiniteQuery`               |
| Ordered RPC stream history | `streamedOptions({ input, maxChunks, refetchMode })`             | Ordinary query hooks or observers                             |
| Latest RPC stream value    | `liveOptions({ input })`                                         | Ordinary query hooks or observers                             |

Unary RPCs and buffered HTTP endpoints expose read, write, and pagination builders.
Choose by application intent; HTTP method and RPC name do not restrict the choice.
Streaming RPCs expose only accumulated and live query builders. Inputless
operations omit `input`.

Read [query patterns](references/query-patterns.md) when adding conditional reads,
pagination, streaming, React Query, or server rendering.

## Preserve generated cache identity

- Supply a non-empty JSON tuple as `keyPrefix`. Include safe user, tenant, or
  backend identifiers when they distinguish results. The factory cannot infer
  identity from a client, URL, middleware, or RPC request options.
- Pass caller options such as `staleTime`, `select`, and callbacks into the
  builder. Preserve its `queryFn`, `queryKey`, and `queryKeyHashFn`; the builder
  removes caller-supplied `queryHash`. Mutation builders own `mutationFn` and
  `mutationKey`.
- Treat captured inputs as immutable and build new options when they change.
  Keys are frozen snapshots; request inputs are not necessarily copied or frozen,
  so later mutation can make execution disagree with its key.
- Use `queryKey(input)`, `infiniteKey(initialInput)`, `streamedKey(input)`, or
  `liveKey(input)` for a particular cache shape. These keys retain the cache
  data type; `select` changes observer data only.
- Use `key()` on a tree, branch, or leaf for prefix invalidation. After mutations,
  invalidate affected reads explicitly. RPC and HTTP roots are distinct; use
  the original caller prefix only for deliberate invalidation across adapters.

## Own execution and cleanup

Keep the client's Scope or ManagedRuntime alive for every operation that uses it. An RPC
client returned from an already completed `Effect.scoped` region is no longer
usable. Create utilities when setting up that client and reuse them across component renders.

When execution requires client or Schema services, pass a `runPromiseExit` runner
that provides them. It must return an Effect `Exit` and forward its second argument's
`signal`; `runtime.runPromiseExit` has this shape. Service-free calls can use the
factory default. A custom key encoder supplies cache identity; execution services
still come from the runner.

Queries forward TanStack cancellation to Effect. Cancel outstanding queries
before disposing their resources. Mutations receive no query abort signal;
durable command cancellation needs an application operation identified before
work starts. Interrupting a client call does not undo a completed write.

## Interpret results and failures

Buffered queries normalize successful `undefined` to `null`; mutations preserve
`undefined`. Streamed values follow the stream contract described in the query
patterns reference.

Configuration and key-generation errors are synchronous: an options builder may
fail before a hook or query function runs. Failed execution Exits become
`EffectRpcQueryError` or `EffectHttpApiQueryError`. Narrow with
`isEffectRpcQueryError` or `isEffectHttpApiQueryError`, then inspect the preserved
Effect `cause`. A runner rejection passes through unchanged.

The Cause is not sanitized and can contain upstream request or Schema values.
Expose application-safe error information and apply the application's logging
policy to the Cause.

## Verify the integration

Type-check against the installed package with strict TypeScript settings. Check
that the actual contract produces the intended utility path and input shape.
Exercise the affected read or write and its cache behavior; for identity or
lifetime changes, verify separation between identities and cleanup on disposal.
