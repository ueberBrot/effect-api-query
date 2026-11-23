# Base release Intent reviews on pre-generation HEAD

Status: Accepted. Extends [ADR 0016](0016-automate-releases-with-changesets.md).

When `scripts/version-packages.mts` runs `intent maintainer review` after generating a release, it passes the pre-generation `HEAD` as `--base` instead of Intent's older stored baseline. Consumed Changeset files may have been added after Intent's baseline and still need deletion records so PR CI sees a clean review state.
