---
"@ueberbrot/effect-api-query": patch
---

Make fetch/ensure Effects report QueryClientOperationError with the exact native rejection in cause. Foreign runner wrappers can no longer masquerade as the current query's declared failure. Generated wrappers and complete Effect Causes remain intact inside cause.
