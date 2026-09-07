# Package rename inventory

The root package installs as `effect-api-query` at version `0.0.0`. One public root entry exposes
both factories. All private workspaces, source imports, task filters, service keys, and packed
fixtures use the canonical package identity. Temporary rename bridges have been removed.

## Remaining migration batches

| Ticket    | Remaining names and locations                      | Completion condition                                                                        |
| --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| #73 / #19 | Final artifact acceptance and publication identity | Rehearse the complete package in #73; perform account configuration and publication in #19. |

`EFFECT_API_QUERY_TARBALL` overrides the archive path. Otherwise, the verifier derives the archive
name from the root manifest. CI passes its selected archive through this same variable.

The upstream cutover is recorded in [the verification record](repository-cutover.md).
Issue #73 removes this inventory and replaces the link in
ADR 0016 with the completed #62 issue. Lasting decisions remain in the ADRs.

## Intentional old names

The repository is `ueberBrot/effect-api-query`, and the deployed documentation uses
`/effect-api-query/`. The [cutover record](repository-cutover.md) retains the old addresses solely
to document observed redirects and the old Pages 404. Root package metadata uses the new repository.

ADR 0013 records the original root-package identity. Historical ADR rationale, closed issue and PR
references, commit history, and immutable build evidence retain their original names. When a later
decision supersedes an ADR, amend its status and preserve its rationale. The docs regression test
also retains the old Pages path to reject stale generated links.

The checkout directory is independent of package resolution. Existing local caches, ignored
artifacts, and user volumes may retain the old name and remain in place. RPC-specific factory,
type, and error names remain part of the public contract.

The Dev Container now uses `effect-api-query` volume names. Rebuild the container to use the new
caches. The rebuild creates new volumes and leaves existing `effect-rpc-query` volumes untouched.
