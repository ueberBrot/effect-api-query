---
"@ueberbrot/effect-api-query": patch
---

Canonicalize HTTP request keys in a single pass, compare duplicate header values with Effect structural equality instead of serializing JSON, and cache per-part schema key encoders across endpoints. Skip allocating cycle trackers for primitive key values and avoid re-canonicalizing prepared HTTP keys.
