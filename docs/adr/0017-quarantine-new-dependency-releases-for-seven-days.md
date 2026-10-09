# Quarantine new dependency releases for seven days

Status: Accepted.

## Context

Immediate dependency upgrades provide too little time to observe supply-chain incidents.

## Decision

pnpm enforces a strict seven-day minimum release age, frozen lockfiles in CI, and explicit
lifecycle-script permissions. Missing registry publication times fail closed. The same native
workspace settings apply to isolated consumers; frozen and cached installs remain subject to
registry publication metadata.

## Consequences

Every registry version becomes eligible seven days after publication. Release-age exceptions,
exclusions, configuration overrides, alternate installers, and missing-time bypasses are forbidden.
Already-installed dependencies may be reused read-only while an ineligible version remains blocked.
