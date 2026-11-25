---
"@ueberbrot/effect-api-query": patch
---

Reduce TypeScript instantiations for large RPC and HTTP utility trees. Standard `HttpApiClient.ForApi` clients and untouched groups bypass per-endpoint service and error derivation, prefixed `createRpcQueryUtils` calls match before unprefixed overloads, `ContainsRedacted` exits immediately on primitives, and sparse `configureUtils` retention and hydration helpers prune untouched branches.
