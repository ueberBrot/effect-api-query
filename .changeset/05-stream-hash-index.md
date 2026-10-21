---
"@ueberbrot/effect-api-query": patch
---

Index stream hash-conflict checks by QueryCache and hash function. Reuse the index across executions and reconcile Query identity and insertion order through nested cache notifications, preserving collision guards when subscribers recreate removed entries. Release the subscription when the cache empties and rebuild it on the next execution. Native TanStack Query lookup behavior remains unchanged.
