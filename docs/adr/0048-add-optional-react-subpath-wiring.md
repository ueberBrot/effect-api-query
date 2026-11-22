# Add optional React subpath wiring

Status: Accepted. Amends [ADR 0004](0004-build-core-shaped-options-and-certify-react-first.md) and extends [ADR 0040](0040-add-opt-in-query-owner-retirement.md).

## Context

React applications using generated utility trees and a `query owner` repeated the same boilerplate: creating typed React contexts, wiring `<QueryClientProvider>` with a remount boundary keyed to `QueryClient` identity, and avoiding `useEffect` disposal bugs under React 19 `<StrictMode>` and `<Activity mode="hidden">`. Adding React imports to the root entrypoint would break framework-agnostic consumers (Vue, Solid, Svelte, Angular).

## Decision

1. **Optional `./react` subpath (amends ADR 0004):** Keep the root `@ueberbrot/effect-api-query` entrypoint strictly framework-agnostic with zero React or `@tanstack/react-query` imports, type references, or `'use client'` directives. Ship thin React 18/19 context and owner wiring at `@ueberbrot/effect-api-query/react` (`createQueryUtilsContext`, `QueryOwnerProvider`, `useQueryOwner`, and their prop/context types) with optional peer dependencies `react: "^18 || ^19"` and `@tanstack/react-query: ">=5.107.1 <6"` marked optional in `peerDependenciesMeta`. Emit `'use client'` on line 1 of `dist/react.mjs` only. Native `@tanstack/react-query` hooks (`useQuery`, `useMutation`, `useSuspenseQuery`, `useQueries`, etc.) remain unwrapped.
2. **Lifecycle-neutral provider and keyed remounting (extends ADR 0040):** Implement providers with `<Context.Provider value={...}>` and `useContext` for React 18 and 19 compatibility. Key the inner `<QueryClientProvider>` with a deterministic monotonic token per `QueryClient` instance (`WeakMap<QueryClient, number>`, SSR-safe) so replacing an owner or `QueryClient` remounts downstream observers onto the new cache without remounting on ordinary re-renders. Keep providers strictly lifecycle-neutral: never call `owner.dispose()` in `useEffect` cleanup, stay safe under React 19 `<StrictMode>` and `<Activity mode="hidden">`, and render without throwing if an outgoing owner retires mid-transition. Support `provideQueryClient={false}` for hosts that already own `<QueryClientProvider>` (such as TanStack Start).

## Consequences

Vue, Solid, Svelte, and Angular consumers install and type-check `@ueberbrot/effect-api-query` with no React packages installed. React consumers opt into `@ueberbrot/effect-api-query/react` for typed utility context and owner-swap remounting while retaining caller ownership of `query owner` disposal and using native `@tanstack/react-query` hooks directly.
