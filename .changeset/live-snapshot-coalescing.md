---
"@ueberbrot/effect-api-query": major
---

Add opt-in live snapshot coalescing with immediate first publication, fixed pending deadlines, final flush, and consistent configured cache identity.

RPC live keys now have an optional trailing policy tuple slot, including when `coalesceMs` is omitted. Default runtime key values remain unchanged, but assignments to the previous exact-length tuple types can fail to compile. This is a breaking public type change under the compatibility policy, including below 1.0. Use the generated key type or the options' `queryKey` for cache access instead of an old exact-length annotation. Literal operation paths and query data/error tags remain intact.
