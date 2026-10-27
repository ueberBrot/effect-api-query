---
"@ueberbrot/effect-api-query": minor
---

Replace the separate policy, interceptor, and leaf-configuration helpers with `configureUtils` for trees, branches, and leaves. Preserve callback inference, scope specificity, and interceptor order across repeated configuration. Repeated mutation settings merge within their scope, and explicit `undefined` clears an inherited callback.
