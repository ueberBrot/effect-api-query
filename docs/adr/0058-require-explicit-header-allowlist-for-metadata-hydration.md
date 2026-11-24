# Require explicit header allowlists for contract-derived HTTP metadata hydration

Status: Accepted. Amends [ADR 0047](0047-derive-hydration-codecs-from-contracts.md).

## Context

ADR 0047 registered `metadata` hydration codecs by default for every buffered queryable HTTP endpoint, encoding the entire raw response header map (`Schema.Record(Schema.String, Schema.String)`). Because `metadataOptions` retains all client-visible response headers in the cached envelope, dehydrating an HTTP metadata query through a default contract-derived registry can transfer server-only response headers (such as `set-cookie` or internal tokens) into browser snapshots.

In addition, contract-derived validation previously followed only encoding links when an AST carried an `encoding` chain (skipping declaration type parameters such as `Option<RedactedFromValue>`), and derived `HttpApiSchema.asNoContent` responses through their `void` transport codec (discarding cached decoded values and re-invoking the `asNoContent` factory on hydration).

## Decision

1. **Opt-in HTTP metadata hydration with an explicit header allowlist:** `createContractHydrationRegistry(httpApi)` no longer registers `metadata` codecs by default. Callers opt into derived `metadata` hydration either globally via `views: { metadata: { headers: readonly string[] } }` or per endpoint via `paths[path]: { metadata: { headers: readonly string[] } }`, or supply a custom `metadata` codec. Derived metadata codecs project raw headers case-insensitively to only the configured allowlist during both encoding and decoding, then freeze the hydrated envelope and header map.
2. **Full decoded-and-encoded `Redacted` AST validation:** Eager contract validation inspects both decoded schema children (including `Declaration.typeParameters`, structs, arrays, unions, and `Suspend` thunks) and encoding links for `effect/schema/Redacted` before and after `Schema.toCodecJson`, rejecting nested `Redacted` values with `HydrationCodecError("UnencodableSchema")` unless overridden or opted out with `false`.
3. **Preserve `HttpApiSchema.asNoContent` decoded values:** When a buffered HTTP success schema has a non-`Void` decoded AST whose encoded AST is `Void` (`HttpApiSchema.asNoContent`), derive its JSON hydration codec from `Schema.toType(schema)` so cached decoded values round-trip across `query`, `metadata.data`, and `infinite.pages` without re-invoking the factory. Plain `NoContent` / `Void` / `Undefined` responses continue to normalize to `null` per [ADR 0012](0012-normalize-undefined-query-success-to-null.md).

## Consequences

Unfiltered server-only response headers cannot leak into dehydrated browser snapshots through default contract-derived registries. Applications that hydrate HTTP metadata views explicitly declare the public response headers to transfer (or pass `headers: []` for status and data only, or supply a custom codec). Nested `Redacted` schemas fail fast at registry construction, and bodyless synthesized HTTP responses preserve exact server-cached values across hydration.
