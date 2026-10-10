---
name: effect-api-query
description: >-
  Use when integrating effect-api-query with an Effect RPC or HttpApi contract:
  derive TanStack Query keys and options, choose buffered or streaming views,
  configure metadata, pagination, defaults or cache filters, coordinate writes
  and cache owners, capture or hydrate SSR data, or rebuild native framework
  queries from reactive input. Also use when diagnosing execution failures,
  cancellation, or ready-client lifetime in these integrations.
license: ISC
metadata:
  purpose: >-
    Derive typed TanStack Query keys and options from ready Effect RPC and HTTP
    clients, preserving cache identity, decoded query views, native framework
    behavior, and application-owned execution, hydration, and resource lifetime.
  type: core
  library: effect-api-query
  library_version: '0.1.0'
sources:
  - 'src/**/*.ts'
  - 'tests/**/*.ts'
  - '**/tests/packed-consumer/**'
  - '**/examples/vite-react/src/lib/*.ts'
  - '**/examples/vite-react/src/main.tsx'
  - '**/examples/vite-react/src/app.tsx'
  - '**/examples/vite-react/tests/*.ts*'
  - '**/examples/tanstack-start/src/lib/*.ts'
  - '**/examples/tanstack-start/tests/*.ts*'
  - '**/examples/server/src/*.ts'
  - '**/examples/server/tests/rpc-transport-overhead.test.ts'
  - 'GLOSSARY.md'
  - 'README.md'
  - 'CHANGELOG.md'
  - 'package.json'
  - 'pnpm-workspace.yaml'
  - 'scripts/*.mts'
  - 'docs/adr/000*.md'
  - 'docs/adr/0012-*.md'
  - 'docs/adr/0014-*.md'
  - 'docs/adr/002*.md'
  - '**/apps/docs/src/content/docs/**/*.md'
  - '**/apps/docs/src/content/docs/**/*.mdx'
---

# Use effect-api-query

Derive options from the application's contract and ready client, then pass them
to TanStack Query. This package owns utility construction and query execution;
the application owns transport, authentication, resources, and cache policy.

## Choose the adapter

Inspect the installed package manifest for its version and peers. The reviewed
coordinated Effect set is exactly 4.0.0; Query Core peers are `>=5.103.1 <6`.
Use the installed declarations and preserve literal contracts. Wider peer ranges
do not certify every release; [frameworks and hosts](references/frameworks-and-hosts.md)
records the tested combinations and current upstream limits.

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
| HTTP data/status/headers   | `metadataOptions({ input, ...options })`                         | Ordinary query hooks or observers                             |
| Ordered RPC or SSE history | `streamedOptions({ input, maxChunks, refetchMode })`             | Ordinary query hooks or observers                             |
| Latest RPC or SSE value    | `liveOptions({ input })`                                         | Ordinary query hooks or observers                             |

Unary RPCs and buffered HTTP endpoints without multipart expose read, write, and pagination builders.
Choose by application intent; HTTP method and RPC name do not restrict the choice.
Buffered multipart HTTP endpoints expose mutation builders only and accept explicit `FormData`;
follow the [HTTP rules](references/http.md) for upload input and encoder configuration.
Streaming RPCs and supported HTTP SSE endpoints expose accumulated and live
builders. Metadata is a separate buffered HTTP query view. Inputless operations
omit `input`.

Read only the branch needed for the task:

| Task                                                                           | Read                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Skip missing input, paginate, or choose stream history                         | [Query patterns](references/query-patterns.md)             |
| Set defaults, filter caches, apply optimistic writes or events, replace owners | [Cache workflows](references/cache-workflows.md)           |
| Capture open streams, serialize query views, or dispose request work           | [Hydration and SSR](references/hydration-and-ssr.md)       |
| Connect reactive hooks, choose transport/host, or assess version support       | [Frameworks and hosts](references/frameworks-and-hosts.md) |

## Preserve generated cache identity

- Supply a non-empty JSON tuple as `keyPrefix`. Include safe user, tenant, or
  backend identifiers when they distinguish results. The factory cannot infer
  identity from a client, URL, middleware, or RPC request options.
- Pass caller options such as `staleTime`, `select`, and callbacks into the
  builder. Preserve its `queryFn` and `queryKey`. Configure custom hashing through
  QueryClient global or prefix defaults; builders reject per-call `queryKeyHashFn`
  and `queryHash`. Mutation builders own `mutationFn` and `mutationKey`.
- Treat captured inputs as immutable and build new options when they change.
  Keys are frozen snapshots; request inputs are not necessarily copied or frozen,
  so later mutation can make execution disagree with its key.
- Use the generated concrete key for its cache shape. Accumulated keys include
  normalized retention/refetch policy: `streamedKey(input, policy)`. HTTP stream
  keys also include decoder policy. Inputless stream keys take policy first.
  Concrete keys retain the unselected cache data type; `select` changes observer
  data only. Use the matching options' `queryKey` when it already exists.
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

Queries forward TanStack cancellation to Effect. Stop consumers, cancel queries,
and drain local streams, pending preparation, and accepted mutations before
disposing resources. Native cancellation can settle before finalizers finish;
`fetchStreamSnapshot` drains its own capture. Mutations receive no query abort
signal. A cancellable command needs an application operation identified before
work starts; owner retirement leaves completed remote work intact.

## Interpret results and failures

Buffered queries and live emissions normalize successful `undefined` to `null`.
Accumulated stream elements and mutation results preserve `undefined`. See the
query patterns reference for stream behavior.

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
