# Quarantine new dependency releases for seven days

Status: Accepted.

## Context

Immediate dependency upgrades provide too little time to observe supply-chain incidents.

## Decision

pnpm enforces a strict seven-day minimum release age, frozen lockfiles in CI, and explicit
lifecycle-script permissions. Missing registry publication times fail closed. The same policy
applies to workspace packages, examples, CI, and isolated consumers. Lockfile verification stays
enabled so frozen and cached installations also reject ineligible versions.

## Consequences

No release-age exceptions, exclusions, configuration overrides, alternate installers, or missing-time
bypasses are allowed. An ineligible version remains blocked until its registry publication is seven
days old. Record its next eligibility time and continue independent work with eligible dependencies.
Existing version-resolution overrides remain valid when they preserve this policy.

Locally built project tarballs can be verified before publication; their registry dependencies still
obey the quarantine. External installation of a newly published version waits for that version's
own seven-day eligibility. See the [install policy](../agents/install-policy.md) for consumer setup
and verification.
