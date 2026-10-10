# Changelog

## 0.1.0

Initial release of typed TanStack Query utilities derived from Effect RPC and HttpApi contracts.

- Build query, mutation, and infinite-query options for unary RPCs and supported buffered HTTP endpoints without multipart. Factories consume application-owned ready clients and preserve typed keys, constructor-aware RPC inputs, decoded HTTP request parts, and custom key encoders.
- Consume RPC streams and supported HTTP SSE endpoints as ordered accumulated histories or latest-value live queries. Accumulated keys include retention and refetch policy; HTTP stream keys also include decoder policy.
- Normalize successful buffered query values and live emissions from `undefined` to `null`. Accumulated elements and mutation results preserve their decoded values.
- Respect QueryClient global and prefix hashing defaults while keeping canonical keys immutable and broad prefixes available for invalidation.
- Preserve complete Effect Causes in RPC and HTTP execution errors, including independent stream interruption. Queries forward cancellation and release local stream resources.
- Read buffered HTTP data with immutable status/header metadata through a separate cached view, and send explicit `FormData` through buffered multipart mutations.
- Capture successful data from open streams with `fetchStreamSnapshot`, awaiting its local iterator cleanup before returning.
- Include application recipes for paired hydration codecs, SSR preparation, retries, optimistic writes, owner changes, persistence, and event-driven refresh; native framework and browser/worker consumers verify their documented integration boundaries.
- Ship one side-effect-free ES2022 ESM root with declarations, source maps, ISC licensing, and a package-discoverable TanStack Intent usage skill.

The exact Effect peer is **4.0.0**. Coordinate Effect runtime, testing, and platform versions when upgrading; RPC and HTTP API modules remain unstable. Query Core peers are **`>=5.103.1 <6`**, tested at **5.103.1** and **5.104.0** with strict TypeScript **5.9.3** and **7.0.2**. Framework, host, HTTP, and transport limits are documented in the [compatibility reference](https://ueberbrot.github.io/effect-api-query/reference/compatibility-and-limits/).
