---
"@ueberbrot/effect-api-query": patch
---

Reuse schema key encoders, RPC input analysis, and HTTP endpoint descriptions for immutable Effect declarations, including those requiring custom encoders. Failed suspended-schema inspection remains retryable. Each eager utility tree still binds its own ready client, runner, prefix, and custom encoders; payload values and mutable option objects are never memoized.
