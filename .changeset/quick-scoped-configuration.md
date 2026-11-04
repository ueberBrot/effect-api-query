---
"@ueberbrot/effect-api-query": patch
---

Reduce `configureUtils` work for sparse and repeated configuration by indexing child scopes, skipping empty settings, and reusing unaffected frozen subtrees. Preserve scoped policy order, callback composition, stream defaults, and prepared-input ownership.
