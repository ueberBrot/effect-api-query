// fallow-ignore-file unused-file
// Vite+ invokes this initial-release rehearsal through its task graph.
import { deepStrictEqual, equal } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
equal(git('status', '--porcelain'), '', 'Commit all changes before rehearsing an exact candidate')
const commit = git('rev-parse', 'HEAD')
const directory = mkdtempSync(join(tmpdir(), 'effect-api-query-release-'))

try {
  execFileSync('tar', ['-x', '-C', directory], {
    input: execFileSync('git', ['archive', commit], { cwd: root }),
  })
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')

  const manifestPath = join(directory, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name: string
    version: string
  }
  equal(manifest.name, 'effect-api-query')
  equal(manifest.version, '0.0.0', 'This rehearsal projects the initial release only')
  manifest.version = '0.1.0'
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(
    join(directory, 'CHANGELOG.md'),
    `# effect-api-query

## 0.1.0

Initial release from https://github.com/ueberBrot/effect-api-query.

- Derive typed TanStack Query keys and options from Effect RPC and buffered HTTP contracts.
- Support queries, mutations, conditional queries, pagination, and typed cache access.
- Retain RPC accumulated streamed queries, bounded history, live queries, and request options.
- Preserve Effect Causes and forward query cancellation while applications own clients and runtimes.
- Separate RPC and HTTP cache identity and support custom encoders for serviceful or redacted input.
- Ship one ESM root with declarations, external Effect and Query Core peers, and ISC licensing.
- Document both adapters with Vite React and TanStack Start examples, including HTTP SSR and hydration.

HTTP streaming, multipart uploads, and raw-response modes remain outside the supported contract.
`,
  )

  for (const parent of ['apps', 'examples']) {
    for (const child of readdirSync(join(directory, parent))) {
      const path = join(parent, child, 'package.json')
      const original = JSON.parse(readFileSync(join(root, path), 'utf8')) as { private: boolean }
      equal(original.private, true, `${path} must remain private`)
      deepStrictEqual(JSON.parse(readFileSync(join(directory, path), 'utf8')), original)
    }
  }

  const run = (...args: string[]) => execFileSync('vp', args, { cwd: directory, stdio: 'inherit' })
  run('run', 'pack')
  run('pm', 'pack', '--pack-destination', '.artifacts', '--', '--config.ignore-scripts=true')
  const archives = readdirSync(join(directory, '.artifacts')).filter((file) =>
    file.endsWith('.tgz'),
  )
  deepStrictEqual(archives, ['effect-api-query-0.1.0.tgz'])
  execFileSync('vp', ['run', 'verify-packed-package'], {
    cwd: directory,
    stdio: 'inherit',
    env: { ...process.env, EFFECT_API_QUERY_TARBALL: join(directory, '.artifacts', archives[0]!) },
  })
  console.log(`Initial release rehearsal passed for ${commit}; private workspaces are unchanged.`)
} finally {
  rmSync(directory, { recursive: true, force: true })
}
