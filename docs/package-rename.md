# Package rename inventory

The root package installs as `effect-api-query` at version `0.0.0`. One public root entry exposes
both factories. All private workspaces, source imports, task filters, service keys, and packed
fixtures use the canonical package identity. Temporary rename bridges have been removed.

## Remaining migration batches

| Ticket    | Remaining names and locations                           | Completion condition                                                                        |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| #72       | Local git remote and hosted repository/Pages references | Rename upstream and verify hosted references using the prepared metadata.                   |
| #73 / #19 | Final artifact acceptance and publication identity      | Rehearse the complete package in #73; perform account configuration and publication in #19. |

`EFFECT_API_QUERY_TARBALL` overrides the archive path. Otherwise, the verifier derives the archive
name from the root manifest. CI passes its selected archive through this same variable.

After #72 completes the upstream cutover, #73 removes this inventory and replaces the link in
ADR 0016 with the completed #62 issue. Lasting decisions remain in the ADRs.

## Intentional old names

Documentation now prepares `ueberBrot/effect-api-query` and `/effect-api-query/`. The current
upstream repository and deployed Pages site retain their old addresses until #72 completes the
[hosted cutover checklist](repository-cutover.md). Root package metadata targets the new repository.

ADR 0013 records the original root-package identity. Historical ADR rationale, closed issue and PR
references, commit history, and immutable build evidence retain their original names. When a later
decision supersedes an ADR, amend its status and preserve its rationale. The docs regression test
also retains the old Pages path to reject stale generated links.

The checkout directory is independent of package resolution. Existing local caches, ignored
artifacts, and user volumes may retain the old name and remain in place. RPC-specific factory,
type, and error names remain part of the public contract.

The Dev Container now uses `effect-api-query` volume names. Rebuild the container to use the new
caches. The rebuild creates new volumes and leaves existing `effect-rpc-query` volumes untouched.
