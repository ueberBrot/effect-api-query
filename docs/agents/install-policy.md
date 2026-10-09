# Dependency installation

Use the pnpm version pinned in `package.json`. Keep these workspace settings:

```yaml
minimumReleaseAge: 10080
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
trustLockfile: false
```

Every registry version, including transitive dependencies, must have a known publication time
at least seven days old. Do not approve pnpm's interactive exception prompt, add an exclusion,
override these settings through flags or environment variables, trust the lockfile without
verification, use an alternate installer, or replace an ineligible registry package with a direct
URL or copied artifact. This also applies to package-manager and tool upgrades: verify their
publication dates before updating their exact pins.

Run workspace installs from the root. CI and the Dev Container retain `--frozen-lockfile` and the
existing `allowBuilds` lifecycle permissions. Frozen lockfiles and cached artifacts are rechecked
against registry publication metadata; neither supplies an age exemption.

For a temporary consumer, call `writeConsumerWorkspace` from `scripts/install-policy.mts` before
its pnpm install. It copies the full workspace policy, including catalogs and lifecycle permissions,
and rejects weakened quarantine settings. Preserve `--ignore-scripts` for packed consumers.
Locally built project tarballs are repository artifacts; their registry dependencies still need
to satisfy the quarantine.

When an install fails, record the rejected version, registry publication time, and earliest
eligibility time. A missing publication time remains a blocking condition. Continue independent
work using already-installed dependencies read-only. Do not weaken the policy to unblock work.

Run `vp run install-policy` after changes to installation policy or consumer setup. This invokes
the real pnpm CLI against an isolated fixture registry and checks fresh resolution plus frozen
installs with cached artifacts, including under-age and missing-time rejection. The normal packed
consumer checks verify real eligible registry dependencies with the same copied policy.

After publishing a new package version, registry installation waits for that version's own
seven-day eligibility. Metadata and provenance checks and local-tarball acceptance may run sooner.
