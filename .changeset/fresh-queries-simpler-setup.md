---
"@ueberbrot/effect-api-query": minor
---

Build utilities from a default tag-keyed RPC client or an HttpApi client, with an optional key prefix and a shared runtime option. Track a utility tree with one query-owner call. Use the same input object for keys and options, and configure view settings through flat path maps.

Run buffered operations directly with `call` or `effect`, share error handling across adapters, and build cache filters on the utility tree. Derive hydration codecs from contracts, run native cache operations from Effect, and connect scoped Reactivity invalidation. React apps can opt into typed providers and owner wiring through `@ueberbrot/effect-api-query/react`.

Requires Effect `>=4.1.4 <4.2.0` and TanStack Query Core `>=5.107.1 <6`. The React subpath uses optional React and React Query peers.
