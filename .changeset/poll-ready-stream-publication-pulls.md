---
"@ueberbrot/effect-api-query": patch
---

Poll ready stream pulls and completed deadline gates before awaiting or racing during stream publication, reducing per-chunk overhead in batched and coalesced streams.
