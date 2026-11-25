---
"@ueberbrot/effect-api-query": patch
---

Decouple HTTP metadata query preparation from the shared utility tree and mark `QueryClientService` and builder registries as pure. Bundlers now drop unused HTTP metadata and structural-sharing helpers from RPC-only and minimal consumer bundles.
