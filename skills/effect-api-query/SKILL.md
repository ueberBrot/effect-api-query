---
name: effect-api-query
description: >-
  Use when integrating Effect RPC or HttpApi with TanStack Query through effect-api-query. Covers typed reads, writes, pagination, streams, cache filters and policies, and server-to-browser hydration. Use it to diagnose failures, cancellation, client lifetime, or reactive framework options.
license: ISC
metadata:
  purpose: >-
    Derive typed TanStack Query keys and options from ready Effect RPC and HTTP clients, preserving cache identity, typed filters and execution policies, decoded query views, registered hydration codecs, stream recovery, native framework behavior, and application-owned resource lifetime.
  type: core
  library: "@ueberbrot/effect-api-query"
  library_version: "0.7.0"
sources:
  - "**/examples/contracts/src/*.ts"
  - "**/examples/shared/http-workflows/*.ts*"
  - "e2e/http-workflows.spec.ts"
  - "src/**/*.ts"
  - "tests/**/*.ts"
  - "tests/**/*.tsx"
  - "**/examples/shared/*.ts"
  - "**/examples/vite-react/src/lib/*.ts"
  - "**/examples/vite-react/src/main.tsx"
  - "**/examples/vite-react/src/app.tsx"
  - "**/examples/shared/ui/effect-error-details.tsx"
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
  - "scripts/performance/*.mts"
  - "docs/adr/000*.md"
  - "docs/adr/0010-*.md"
  - "docs/adr/0012-*.md"
  - "docs/adr/0014-*.md"
  - "docs/adr/0015-*.md"
  - "docs/adr/002*.md"
  - "docs/adr/003*.md"
  - "docs/adr/0040-*.md"
  - "docs/adr/0042-*.md"
  - "docs/adr/0043-*.md"
  - "apps/docs/astro.config.mts"
  - "**/apps/docs/src/content/docs/**/*.md"
  - "**/apps/docs/src/content/docs/**/*.mdx"
---

# Use effect-api-query

## Set up the client

1. Read the installed package manifest for the version and peer ranges. If you are choosing dependencies or connecting a framework, router, or worker, read [frameworks and hosts](references/frameworks-and-hosts.md).
2. Acquire the Effect client before calling the factory. Use the matching reference for imports, setup, input, and custom key encoders.

   | Contract | Factory | Setup |
   | --- | --- | --- |
   | Effect RPC group | `createRpcQueryUtils` with a flat client | [RPC](references/rpc.md) |
   | Effect HttpApi declaration | `createHttpApiQueryUtils` with an HttpApiClient | [HTTP](references/http.md) |

3. Import the factory from `@ueberbrot/effect-api-query`. Keep contract identifiers literal. Build the utility tree once per client and cache owner.
4. Pass a non-empty JSON tuple as `keyPrefix`. Include safe values for any tenant, user, or backend identity that changes results. Keep credentials in the client.

The app owns the client, transport, authentication, runtime, and cache. Keep the client alive through requests and local cleanup. If execution needs Effect services, supply a `runPromiseExit` that provides them and forwards the `signal` in its second argument. Use the default runner for service-free requests.

## Build the options

| Task | Builder | Native consumer |
| --- | --- | --- |
| Read decoded data | `queryOptions` | `useQuery` or `queryClient.query` |
| Run a write | `mutationOptions` | `useMutation` or `MutationObserver`. Pass variables to `mutate`. |
| Load pages | `infiniteOptions` | `useInfiniteQuery` or `queryClient.infiniteQuery` |
| Read HTTP status and headers with data | `metadataOptions` | Ordinary query hook or observer |
| Keep ordered stream history | `streamedOptions` | Ordinary query hook or observer |
| Keep the latest stream value | `liveOptions` | Ordinary query hook or observer |

Unary RPC and buffered HTTP without multipart support reads, writes, and pages. Buffered multipart HTTP takes `FormData` through a mutation. Streaming RPC and supported HTTP SSE or NDJSON expose both stream views. Omit `input` for operations that take none. Set `maxChunks` to a positive safe integer or `"unbounded"` for accumulated history.

- Keep captured inputs unchanged. Mutating input can send a different request under the old key. Build new options when input changes.
- Pass native settings to the builder and use the returned key and function together. Use a generated concrete key for typed cache reads and writes. Set hashing on QueryClient before use and keep it stable.
- After writes, choose which reads to invalidate. Native invalidation marks entries stale and refetches active matches by default. Use a generated prefix to target one tree or the original prefix to target both adapters.

Read the reference for the task at hand.

| If you need to | Read |
| --- | --- |
| Infer types, wait for input, page, prepare input, batch or recover streams, or trace cleanup | [Query patterns](references/query-patterns.md) |
| Filter or update the cache, share policies, intercept execution, or retire an owner | [Cache workflows](references/cache-workflows.md) |
| Capture a stream for server rendering, register codecs, hydrate, or transfer a loader selection | [Hydration and SSR](references/hydration-and-ssr.md) |
| Rebuild reactive options, mount providers, use Suspense, or choose transport and versions | [Frameworks and hosts](references/frameworks-and-hosts.md) |

## Handle failures and cleanup

- Catch configuration and key preparation failures where you build the tree or options. Incompatible hashing can also fail during stream execution.
- Use `isEffectRpcQueryError` or `isEffectHttpApiQueryError` for failed Effect Exits. Inspect the full `cause` before deciding what to show, log, or retry. A runner that rejects without an Exit passes its rejection through.
- Stop consumers and cancel queries before disposal. Wait for local stream cleanup, pending preparation, and accepted mutations. Native cancellation can settle before finalizers finish. To stop server work, use an application command protocol.

Type-check one call against the installed package with strict settings. Exercise its result and cache behavior. If you changed identity or lifetime, verify that entries stay separate and disposal finishes.
