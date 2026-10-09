import { readFileSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'

const repositoryRoot = nodePath.resolve(import.meta.dirname, '..')

/** Copy the workspace's quarantine and lifecycle policy into an isolated consumer. */
export const writeConsumerWorkspace = (directory: string): void => {
  const workspace = readFileSync(nodePath.join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf-8')
  for (const setting of [
    'minimumReleaseAge: 10080',
    'minimumReleaseAgeStrict: true',
    'minimumReleaseAgeIgnoreMissingTime: false',
    'trustLockfile: false',
  ]) {
    if (!workspace.split('\n').includes(setting)) {
      throw new Error(`The install policy requires ${setting}`)
    }
  }
  if (/minimumReleaseAgeExclude\s*:/u.test(workspace)) {
    throw new Error('Release-age exclusions are forbidden')
  }
  // Keep catalogs, version-resolution overrides and lifecycle permissions unchanged.
  // Every isolated fixture is its own workspace, never a member of the source tree.
  writeFileSync(
    nodePath.join(directory, 'pnpm-workspace.yaml'),
    workspace.replace(/^packages:\n(?:[ \t]+[^\n]*\n)+/mu, 'packages:\n  - .\n'),
  )
}
