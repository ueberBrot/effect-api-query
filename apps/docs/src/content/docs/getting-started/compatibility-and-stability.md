---
title: Compatibility and Stability
description: Check dependency requirements, tested integrations, module format, and the release policy.
---

Use the [compatibility table](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) to find supported dependency ranges and tested combinations. Both factories use the same requirements.

This website documents the package version shown in its header. The repository's `main` branch can contain unreleased changes.

Use ESM, ES2022, and TypeScript with `strict: true`. The minimum compiler is TypeScript 5.9. The table lists the newest compiler tested. Review new TypeScript majors and Effect minors against the supported ranges before upgrading.

Effect is stable. Its RPC and HttpApi modules still declare unstable APIs. Keep your Effect packages on matching versions. Use one resolved Query Core version for your app and its wrapper.

## Supported public contract

- Builders infer literal contract paths, accepted inputs, decoded results, and declared failures. Native Query APIs accept the generated options. [Defaults and policies](/effect-api-query/guides/query-defaults/) explains which configuration takes precedence.
- Equivalent supported inputs share a key for the same operation and view. Keep captured input unchanged and include safe identifiers when results vary by user or tenant. See [semantic keys](/effect-api-query/concepts/semantic-keys/) for identity and hashing.
- Buffered and live query results convert `undefined` to `null`. Mutations and accumulated streams keep the original value. See [streaming](/effect-api-query/guides/streaming/) for empty streams and refetch behavior.
- Failed execution Exits become typed errors with the complete Effect Cause and operation metadata. Preparation errors and rejections without an Exit have separate rules. See [errors](/effect-api-query/reference/errors/) and the [Effect cache bridge](/effect-api-query/guides/query-effects/).
- Query cancellation interrupts local Effect work. Iterator cleanup can outlast native cancellation. Mutations have no automatic query abort signal. Your app owns client disposal and any remote cancellation protocol. See [client lifecycle](/effect-api-query/concepts/client-lifecycle/).
- Use registered codecs to transfer cached views between server and browser. Infinite data also needs a codec for page parameters. See [hydration](/effect-api-query/guides/hydrate-query-views/).

## Versioning

Before 1.0, breaking changes and new features increment the minor version. Dropping support or extending a verified range also increments the minor version. Compatible fixes and tooling updates increment the patch version. See [the release policy](https://github.com/ueberBrot/effect-api-query/blob/main/docs/adr/0001-target-effect-4-release-candidate.md).
