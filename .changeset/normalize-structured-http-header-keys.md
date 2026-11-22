---
"@ueberbrot/effect-api-query": patch
---

When HTTP header names differ only in case, compare their structured values without relying on object key order. Conflicting values still raise a key-generation error.
