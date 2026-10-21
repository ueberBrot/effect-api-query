---
"@ueberbrot/effect-api-query": minor
---

Add opt-in `publicationBatchSize` for accumulated RPC and HTTP SSE queries. Publish the first element immediately, preserve event order, and flush partial batches on completion or failure. Include nondefault publication policy in cache identity while retaining existing defaults and cancellation behavior.
