---
"@ueberbrot/effect-api-query": minor
---

Isolate generated RPC and HTTP cache namespaces with versioned keys. Root and branch filters and native prefix defaults now match the entire caller key prefix, including objects and arrays, while still matching descendants.

Upgrade the version or buster for persisted TanStack caches and discard snapshots with the old generated keys. Deploy matching versions on both sides of SSR and rebuild any hand-authored keys using the generated builders. Legacy keys can be ambiguous, so they cannot be migrated automatically.
