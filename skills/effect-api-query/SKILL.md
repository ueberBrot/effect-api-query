---
name: effect-api-query
description: >-
  Use when integrating effect-api-query with ready Effect RPC or HttpApi clients: derive TanStack Query keys and options, select views or pagination, reuse policies or intercept execution, filter caches, recover streams, or prepare SSR hydration. Also use to diagnose execution errors, cancellation, or client lifetime, and to rebuild native framework options from reactive input.
license: ISC
metadata:
  purpose: >-
    Derive typed TanStack Query keys and options from ready Effect RPC and HTTP clients, preserving cache identity, typed filters and execution policies, decoded query views, registered hydration codecs, stream recovery, native framework behavior, and application-owned resource lifetime.
  type: core
  library: "@ueberbrot/effect-api-query"
  library_version: "0.1.0"
sources:
  - "src/**/*.ts"
  - "tests/**/*.ts"
  - "tests/**/*.tsx"
  - "**/examples/shared/*.ts"
  - "**/examples/vite-react/src/lib/*.ts"
  - "**/examples/vite-react/src/main.tsx"
  - "**/examples/vite-react/src/app.tsx"
  - "**/examples/vite-react/src/components/ui/effect-error-details.tsx"
  - "**/examples/vite-react/tests/*.ts*"
  - "**/examples/tanstack-start/src/lib/*.ts"
  - "**/examples/tanstack-start/src/router.tsx"
  - "**/examples/tanstack-start/src/components/effect-error-details.tsx"
  - "**/examples/tanstack-start/tests/*.ts*"
  - "**/examples/server/src/*.ts"
  - "**/examples/server/tests/**/*.ts"
  - "GLOSSARY.md"
  - "README.md"
  - "package.json"
  - "pnpm-workspace.yaml"
  - "scripts/*.mts"
  - "docs/adr/000*.md"
  - "docs/adr/0010-*.md"
  - "docs/adr/0012-*.md"
  - "docs/adr/0014-*.md"
  - "docs/adr/0015-*.md"
  - "docs/adr/002*.md"
  - "docs/adr/0030-*.md"
  - "**/apps/docs/src/content/docs/**/*.md"
  - "**/apps/docs/src/content/docs/**/*.mdx"
---

# Use effect-api-query

Derive options from the application's contract and ready client. Pass those options to TanStack Query. The package owns utility construction and query execution. The application owns transport, authentication, resources, and cache policy.

## Choose the adapter

Read the installed package manifest to find its version and peers. This version uses the coordinated Effect 4.0.4 set. Its Query Core peer range is `>=5.103.1 <6`. Use the installed declarations and keep contracts literal. For reactive options, version constraints, and transport ownership, read [frameworks and hosts](references/frameworks-and-hosts.md).

Read the reference for the contract you are integrating:

| Contract | Factory and input | Reference |
| --- | --- | --- |
| Effect RPC group | `createRpcQueryUtils` with payload constructor input | [RPC setup and rules](references/rpc.md) |
| Effect HttpApi | `createHttpApiQueryUtils` with decoded request parts | [HTTP setup and rules](references/http.md) |

Import both factories and error guards from `@ueberbrot/effect-api-query`, the package's one public root export. Each factory accepts an already acquired client. It builds an eager, frozen utility tree without making a request.

## Choose the operation

| Need | Builder | TanStack consumer |
| --- | --- | --- |
| Buffered read | `queryOptions({ input, ...options })` | `useQuery`, `useSuspenseQuery`, `queryClient.query` |
| Write | `mutationOptions({ ...callbacks })` | `useMutation`, `MutationObserver`, with variables passed to `mutate` |
| Cursor pagination | `infiniteOptions({ initialPageParam, input, getNextPageParam })` | `useInfiniteQuery`, `queryClient.infiniteQuery` |
| HTTP data, status, and headers | `metadataOptions({ input, ...options })` | Ordinary query hooks or observers |
| Ordered RPC or SSE history | `streamedOptions({ input, maxChunks, refetchMode })` | Ordinary query hooks or observers |
| Latest RPC or SSE value | `liveOptions({ input })` | Ordinary query hooks or observers |

Unary RPCs and buffered HTTP endpoints without multipart expose read, write, and pagination builders. Choose the builder for the application's intent. Neither the HTTP method nor the RPC name restricts that choice.

Buffered multipart HTTP endpoints expose only mutation builders and accept explicit `FormData`. For upload input and encoder configuration, follow the [HTTP rules](references/http.md). Streaming RPCs and supported HTTP SSE endpoints expose accumulated and live builders. Metadata provides a separate buffered HTTP query view. Inputless operations omit `input`.

Read only the branch needed for the task:

| Task | Read |
| --- | --- |
| Infer operation types, skip input, paginate, batch history, or recover streams | [Query patterns](references/query-patterns.md) |
| Reuse policies or interceptors, filter caches, apply writes or events, replace owners | [Cache workflows](references/cache-workflows.md) |
| Capture streams, register view codecs, hydrate, or dispose request work | [Hydration and SSR](references/hydration-and-ssr.md) |
| Mount native providers, recover Suspense, choose a transport, host, or versions | [Frameworks and hosts](references/frameworks-and-hosts.md) |

## Preserve generated cache identity

- Supply a non-empty JSON tuple as `keyPrefix`. If safe user, tenant, or backend identifiers distinguish results, include them. The factory cannot infer identity from a client, URL, middleware, or RPC request options.
- Pass options such as `staleTime`, `select`, and callbacks into the builder. Preserve its `queryFn` and `queryKey`. For execution behavior, use the typed interceptor helpers in [cache workflows](references/cache-workflows.md). To customize hashing, use QueryClient global or prefix `queryKeyHashFn`. Builders reject per-call hashing. Keep hashing stable while cache entries remain. Streams reject a default `queryHash` inconsistent with the key hasher or a conflicting cached identity with `UnsupportedQueryHash`. Before changing the hash policy, retire the old cache. Mutation builders own `mutationFn` and `mutationKey`.
- Treat captured inputs as immutable. When inputs change, build new options. Keys are frozen snapshots, but request inputs are not necessarily copied or frozen. Mutating an input later can make execution disagree with its key.
- Use the generated concrete key for its cache shape. Accumulated keys include normalized retention and refetch policy: `streamedKey(input, policy)`. HTTP stream keys also include decoder policy. Inputless stream keys take policy first. Concrete keys retain the unselected cache data type. Hooks, observers, and `queryClient.query` apply `select`. `getQueryData` reads the decoded cache value. If matching options already exist, use their `queryKey`.
- For prefix invalidation, use `key()` on a tree, branch, or leaf. After mutations, explicitly invalidate affected reads. RPC and HTTP roots are distinct. Use the original caller prefix only for deliberate invalidation across adapters.

## Own execution and cleanup

Keep the client's Scope or ManagedRuntime alive through every operation that uses it. An RPC client returned from a completed `Effect.scoped` region is unusable. During client setup, create utilities and reuse them across component renders.

If execution requires client or Schema services, pass a `runPromiseExit` runner that provides them. The runner must return an Effect `Exit` and forward the `signal` from its second argument. `runtime.runPromiseExit` has this shape. Service-free calls can use the factory default. A custom key encoder supplies cache identity. The runner still supplies execution services.

Ordinary queries forward TanStack cancellation to Effect. For Suspense hooks, read the cancellation limitation in [frameworks and hosts](references/frameworks-and-hosts.md). Before disposing resources, stop consumers, cancel queries, and drain local streams, pending preparation, and accepted mutations. Native cancellation can settle before finalizers finish. `fetchStreamSnapshot` drains its own capture. Mutations receive no query abort signal. A cancellable command needs an application operation identified before work starts. Owner retirement leaves completed remote work intact.

To trace spans and cleanup through stream consumption, follow the lifetime tracing recipe in [query patterns](references/query-patterns.md).

## Interpret results and failures

Buffered queries and live emissions normalize successful `undefined` to `null`. Accumulated stream elements and mutation results preserve `undefined`. For stream behavior, read the query patterns reference.

Configuration and key-generation errors can fail preparation before a hook or query function runs. Incompatible stream cache hashing rejects execution with a configuration error. Failed execution Exits become `EffectRpcQueryError` or `EffectHttpApiQueryError`. Use `isEffectRpcQueryError` or `isEffectHttpApiQueryError` to narrow the error, then inspect its preserved Effect `cause`. Runner rejections pass through unchanged.

The Cause can contain upstream request or Schema values and receives no sanitization. Expose error information that is safe for the application. Apply the application's logging policy to the Cause.

## Verify the integration

Type-check against the installed package with strict TypeScript settings. Make sure that the contract produces the intended utility path and input shape. Exercise the affected read or write and its cache behavior. For identity or lifetime changes, make sure that identities remain separate and disposal completes cleanup. Finish only when these checks pass.
