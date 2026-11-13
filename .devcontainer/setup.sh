#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly repository_root
expected_node_version="$(tr -d '[:space:]' < "${repository_root}/.node-version")"
readonly expected_node_version
actual_node_version="$(node --version)"
readonly actual_node_version

sudo chown -R "$(id -u):$(id -g)" \
  "${repository_root}/node_modules" \
  /home/node/.local/share/pnpm/store \
  /home/node/.cache
git config --global --add safe.directory "${repository_root}"

if [[ "${actual_node_version#v}" != "${expected_node_version}" ]]; then
  printf 'Node %s does not match .node-version (%s).\n' \
    "${actual_node_version#v}" \
    "${expected_node_version}" >&2
  exit 1
fi

sudo corepack enable pnpm
corepack install
pnpm install --frozen-lockfile --store-dir /home/node/.local/share/pnpm/store

# Fail setup if the exact bundled development compiler cannot start.
pnpm exec effect-tsgo tsrs@0.21.0-ts7.1.0-beta --version
