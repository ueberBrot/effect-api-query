---
"@ueberbrot/effect-api-query": patch
---

Cancel live RPC and HTTP queries cleanly when they are aborted before the first value. Typed policy maps now accept SSE decoder defaults on HTTP SSE leaves. HTTP key generation ignores object key order when comparing values for header names that differ only in case.

Use Query Core's `query` API for `queryEffects.fetch` and `queryEffects.ensure`. Reduce compiler work for large HTTP utility trees and runtime work for structural sharing, HTTP calls, cache matching, and policy setup. The Vite React example now tracks HTTP metadata queries during owner retirement.
