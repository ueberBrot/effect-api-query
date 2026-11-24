---
"@ueberbrot/effect-api-query": patch
---

Canonical HTTP request keys preserve repeated wire-parameter ordering when multiple URL-encoded entries flatten to the same serialized parameter name across query parameters, non-body payloads, or form-urlencoded payloads. Order-independent fixed-struct inputs keep their existing canonical keys.
