# Automate releases with Changesets

Status: Accepted.

## Context

Versioning, changelog generation, and publication need one auditable path.

## Decision

Changesets and a split GitHub Actions workflow version, build, pack, and publish the root package
through npm trusted publishing with provenance. The generated changelog keeps pull-request and
commit links. Private examples remain outside versioning, and releases run only in CI.

## Consequences

While the package is unpublished at `0.0.0`, changes accumulate without Changesets. Prepare a single
initial release candidate when publication is authorized.

After initial publication, changes to published behavior, types, exports, dependency ranges, or
installation metadata require a non-empty changeset. Documentation, examples, tests, internal
tooling, and CI require none. Any bootstrap token is removed after trusted publishing is configured.
