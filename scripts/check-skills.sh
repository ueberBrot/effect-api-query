#!/bin/sh
set -eu

vp run skills-check

review_base=${INTENT_REVIEW_BASE:-}
if [ -z "$review_base" ] && [ "${GITHUB_ACTIONS:-}" != "true" ]; then
	if ! review_base=$(git merge-base HEAD refs/remotes/origin/main); then
		printf '%s\n' 'Cannot determine the Intent review base. Run git fetch origin main or set INTENT_REVIEW_BASE to the PR base.' >&2
		exit 1
	fi
fi

set -- vp exec intent maintainer check --github-summary
if [ -n "$review_base" ]; then
	set -- "$@" --base "$review_base"
fi
exec "$@"
