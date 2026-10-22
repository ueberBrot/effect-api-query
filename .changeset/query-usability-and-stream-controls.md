---
"@ueberbrot/effect-api-query": minor
---

Add publication deadlines, composable leaf configuration, branch view filters, typed failure lookup, explicit input preparation, and event consumption.

- `publicationMaxWaitMs` flushes quiet accumulated-stream batches without waiting for the batch size or stream completion. It is optional and contributes to the concrete stream key when supplied.
- `configureQuery` and `configureMutation` return frozen leaves that combine typed defaults and ordered interceptors while preserving every builder's inference.
- `createBranchQueryFilter` selects one view across a root, branch, or leaf and composes with native filter conditions.
- `findDeclaredError` returns an Effect Option for a single tagged failure without hiding defects, interruptions, or composite Causes.
- `prepareInput` constructs and encodes once for repeated keys and query options on the same leaf. Retained execution inputs must remain unchanged. Handles cannot cross owners or replace mutation variables or infinite page mappers.
- `consumeEvents` consumes a native Effect Stream sequentially without caching history; the application owns its lifetime.

Compatibility: these additions preserve existing signatures, cache keys, and default behavior. No breaking changes or migration are required. Applications opting into a publication deadline intentionally use a separate accumulated-stream cache entry.
