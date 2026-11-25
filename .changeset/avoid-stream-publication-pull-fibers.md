---
"@ueberbrot/effect-api-query": patch
---

Pull stream chunks directly when no publication deadline is active, avoiding per-chunk fiber forks while preserving cancellation cleanup defects. Poll ready pulls and completed deadline gates before racing to cut overhead in batched and coalesced streams.
