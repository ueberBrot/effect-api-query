---
"@ueberbrot/effect-api-query": patch
---

Cancel RPC and HTTP live queries cleanly when they abort before the first value. A stream that ends without a value still raises an empty-stream error.
