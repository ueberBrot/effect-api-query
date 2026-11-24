---
"@ueberbrot/effect-api-query": patch
---

Contract-derived hydration derives `HttpApiSchema.asNoContent` codecs from the decoded schema so cached synthesized values round-trip across `query`, `metadata.data`, and `infinite.pages` without re-invoking the `asNoContent` factory. Plain `NoContent` responses continue to normalize to `null`.
