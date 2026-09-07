# Package rename inventory

The root package installs as `effect-api-query` at version `0.0.0`, with the existing RPC exports
and one public root entry. Packed runtime and type fixtures use the new name. Private application
aliases resolve to the same root package.

## Remaining migration batches

| Ticket    | Remaining names and locations                                                                                                                                                 | Completion condition                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| #71       | Root `#effect-rpc-query` and `#effect-rpc-query/*` source aliases, remaining source-test imports, formatter import grouping, and `EFFECT_RPC_QUERY_TARBALL` verifier fallback | Private consumers use canonical names, temporary aliases and the fallback are removed, and the complete package passes certification. |
| #71 / #72 | Root repository/homepage/bugs metadata, changelog repository configuration, source/edit/social links, local git remote, and hosted repository/Pages references                | Prepare metadata in #71, then rename upstream and verify hosted references in #72.                                                    |
| #73 / #19 | Final artifact acceptance and publication identity                                                                                                                            | Rehearse the complete package in #73; perform account configuration and publication in #19.                                           |

`EFFECT_API_QUERY_TARBALL` overrides the archive path and takes precedence over
`EFFECT_RPC_QUERY_TARBALL`. When neither is set, the verifier derives the archive name from the
root manifest. The release workflow passes its selected archive through `EFFECT_API_QUERY_TARBALL`.

After #72 completes the upstream cutover, #73 removes this inventory and replaces the link in
ADR 0016 with the completed #62 issue. Lasting decisions remain in the ADRs.

## Intentional old names

Documentation now prepares `ueberBrot/effect-api-query` and `/effect-api-query/`. The current
upstream repository and deployed Pages site retain their old addresses until #72 completes the
[hosted cutover checklist](repository-cutover.md). Root package metadata is prepared in #71.

ADR 0013 records the original root-package identity. Historical ADR rationale, closed issue and PR
references, commit history, and immutable build evidence retain their original names. When a later
decision supersedes an ADR, amend its status and preserve its rationale. This inventory lists old
identifiers so contributors can find and remove each migration bridge.

The checkout directory is independent of package resolution. Existing local caches, ignored
artifacts, and user volumes may retain the old name and remain in place. RPC-specific factory,
type, and error names remain part of the public contract.

The Dev Container now uses `effect-api-query` volume names. Rebuild the container to use the new
caches. The rebuild creates new volumes and leaves existing `effect-rpc-query` volumes untouched.
