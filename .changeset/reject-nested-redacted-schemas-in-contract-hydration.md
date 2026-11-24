---
"@ueberbrot/effect-api-query": patch
---

Contract-derived hydration inspects decoded schema children, declaration type parameters (such as `Option<RedactedFromValue>`), and suspended schemas for `Redacted` values and throws `HydrationCodecError` (`UnencodableSchema`) unless overridden or opted out with `false`.
