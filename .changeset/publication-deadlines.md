---
"@ueberbrot/effect-api-query": minor
---

Add `publicationMaxWaitMs` to accumulated streamed queries. Partial batches flush after the deadline even when the stream stays quiet, while cancellation awaits cleanup and preserves failures. An explicit deadline contributes to the stream key; omitted deadlines preserve existing keys and count-only behavior.

Breaking changes: none.
