---
"@ueberbrot/effect-api-query": minor
---

Add `consumeEvents` to consume a native Effect Stream sequentially without caching history. It supports startup and exit callbacks, preserves handler failures, and runs the exit callback after stream cleanup. The application owns execution and resource lifetime.
