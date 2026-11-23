---
"@ueberbrot/effect-api-query": patch
---

Pass `{ interruptOnRetire: true }` to `owner.wrapRunner` to interrupt an Effect when the query owner retires, even when the caller supplies no abort signal.
