---
"@ueberbrot/effect-api-query": patch
---

Build canonical HTTP request keys without copying the whole request twice. Compare duplicate header values with Effect structural equality instead of serializing JSON, reuse default request-part schema encoders across endpoints, and skip allocating cycle trackers for primitive key values.
