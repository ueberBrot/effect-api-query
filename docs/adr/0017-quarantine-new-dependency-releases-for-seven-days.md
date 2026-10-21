# Quarantine new dependency releases for seven days

Status: Accepted.

## Context

Upgrading dependencies immediately leaves too little time to observe supply-chain incidents.

## Decision

pnpm enforces a strict seven-day minimum release age, frozen lockfiles in CI, and explicit permissions for lifecycle scripts. Missing registry publication times fail closed. The same native workspace settings apply to isolated consumers. Frozen and cached installs still require registry publication metadata.

## Consequences

Every registry version becomes eligible seven days after publication. Release-age exceptions, exclusions, configuration overrides, alternate installers, and missing-time bypasses are forbidden. While an ineligible version remains blocked, already-installed dependencies can be reused read-only.
