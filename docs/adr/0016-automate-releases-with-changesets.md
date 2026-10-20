# Automate releases with Changesets

Status: Accepted.

## Context

Versioning, changelog generation, and publication need a shared, auditable path.

## Decision

Changesets and a split GitHub Actions workflow version, build, pack, and publish the root package. Publication uses npm trusted publishing with provenance. The generated changelog keeps links to pull requests and commits. Private examples remain outside versioning. Releases run only in CI.

## Consequences

Before initial publication, changes accumulate without Changesets. When publication is authorized, prepare a single initial release candidate.

After initial publication, changes to published behavior, types, exports, dependency ranges, or installation metadata require a non-empty changeset. Documentation, examples, tests, internal tooling, and CI require none. After configuring trusted publishing, remove any bootstrap token.
