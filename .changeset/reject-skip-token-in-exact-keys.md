---
"@ueberbrot/effect-api-query": patch
---

Exact key builders reject `skipToken` before invoking custom key encoders. Use `input: skipToken` on query options to skip execution.
