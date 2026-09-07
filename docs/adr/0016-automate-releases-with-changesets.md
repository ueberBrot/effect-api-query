# Automate releases with Changesets

Status: Accepted.

## Context

Versioning, changelog generation, and publication need one auditable path.

## Decision

Changesets and a split GitHub Actions workflow version, build, pack, and publish the root package
through npm trusted publishing with provenance. The generated changelog keeps pull-request and
commit links. Private examples remain outside versioning, and releases run only in CI.

## Consequences

Changes to published behavior, types, exports, dependency ranges, or installation metadata require
a real changeset. Documentation, examples, tests, internal tooling, and CI require none. Empty
changesets do not serve as process markers. Any bootstrap token is removed after trusted publishing
is configured.
