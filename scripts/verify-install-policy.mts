import { equal, match, ok } from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'

import { writeConsumerWorkspace } from './install-policy.mts'

const root = mkdtempSync(nodePath.join(tmpdir(), 'effect-api-query-install-policy-'))
const packageName = 'effect-api-query-install-policy-fixture'
const version = '1.0.0'
let publishedAt: string | undefined = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString()
let tarball: Buffer
let registry: string
const server = createServer((request, response) => {
  if (request.url === '/fixture.tgz') {
    response.end(tarball)
    return
  }
  if (request.url !== `/${packageName}`) {
    response.writeHead(404).end()
    return
  }
  response.setHeader('content-type', 'application/json')
  response.end(
    JSON.stringify({
      name: packageName,
      'dist-tags': { latest: version },
      versions: {
        [version]: {
          name: packageName,
          version,
          dist: {
            tarball: `${registry}/fixture.tgz`,
            integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
          },
        },
      },
      time: publishedAt === undefined ? undefined : { [version]: publishedAt },
    }),
  )
})

const install = async (
  directory: string,
  frozen: boolean,
  cache: string,
): Promise<{ code: number | null; output: string }> => {
  const child = spawn(
    process.env['EFFECT_API_QUERY_PNPM'] ?? 'pnpm',
    [
      'install',
      '--ignore-scripts',
      '--prefer-offline',
      `--registry=${registry}`,
      `--store-dir=${nodePath.join(root, 'store')}`,
      `--state-dir=${nodePath.join(root, cache)}`,
      ...(frozen ? ['--frozen-lockfile'] : ['--no-frozen-lockfile']),
    ],
    {
      cwd: directory,
      env: { ...process.env, CI: 'true', XDG_CACHE_HOME: nodePath.join(root, cache) },
    },
  )
  let output = ''
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, 30_000)
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString()
  })
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString()
  })
  try {
    await once(child, 'close')
    if (timedOut) {
      throw new Error(`pnpm install timed out: ${output}`)
    }
    return { code: child.exitCode, output }
  } finally {
    clearTimeout(timeout)
  }
}

const consumer = (name: string): string => {
  const directory = nodePath.join(root, name)
  mkdirSync(directory)
  writeConsumerWorkspace(directory)
  writeFileSync(
    nodePath.join(directory, 'package.json'),
    JSON.stringify({ name, private: true, dependencies: { [packageName]: version } }),
  )
  return directory
}

try {
  writeConsumerWorkspace(root)
  const config = readFileSync(nodePath.join(root, 'pnpm-workspace.yaml'), 'utf-8')
  match(config, /^minimumReleaseAge: 10080$/mu)
  match(config, /^minimumReleaseAgeStrict: true$/mu)
  match(config, /^minimumReleaseAgeIgnoreMissingTime: false$/mu)
  match(config, /^trustLockfile: false$/mu)
  equal(/minimumReleaseAgeExclude:/u.test(config), false)
  console.log('Install policy applies to isolated consumers')

  const source = nodePath.join(root, 'package')
  mkdirSync(source)
  writeFileSync(
    nodePath.join(source, 'package.json'),
    JSON.stringify({ name: packageName, version }),
  )
  const archive = nodePath.join(root, 'fixture.tgz')
  execFileSync('tar', ['-czf', archive, '-C', root, 'package'])
  tarball = readFileSync(archive)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  // Node's address() contract distinguishes a TCP address from a Unix pipe path.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  ok(address !== null && typeof address !== 'string')
  registry = `http://127.0.0.1:${address.port}`

  const eligible = consumer('eligible')
  let result = await install(eligible, false, 'eligible-cache')
  equal(result.code, 0, result.output)
  result = await install(eligible, true, 'eligible-frozen-cache')
  equal(result.code, 0, result.output)
  console.log('PASS eligible fresh and frozen cached-artifact installs')

  // The already-resolved lockfile and populated store stay intact. Only the external
  // registry metadata changes; no age exception or alternate installer creates them.
  publishedAt = new Date().toISOString()
  result = await install(consumer('young-fresh'), false, 'young-fresh-cache')
  ok(result.code !== 0, result.output)
  match(result.output, /ERR_PNPM_NO_MATURE_MATCHING_VERSION/u)
  console.log('PASS under-age fresh resolution rejection')
  result = await install(eligible, true, 'young-frozen-cache')
  ok(result.code !== 0, result.output)
  match(result.output, /ERR_PNPM_MINIMUM_RELEASE_AGE/u)
  console.log('PASS under-age already-resolved frozen cached-artifact rejection')

  publishedAt = undefined
  result = await install(consumer('undated-fresh'), false, 'undated-fresh-cache')
  ok(result.code !== 0, result.output)
  match(result.output, /ERR_PNPM_MISSING_TIME/u)
  console.log('PASS missing publication-time fresh rejection')
  result = await install(eligible, true, 'undated-frozen-cache')
  ok(result.code !== 0, result.output)
  match(result.output, /ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION/u)
  match(result.output, /could not be checked/u)
  console.log('PASS missing publication-time already-resolved frozen cached-artifact rejection')
} finally {
  server.close()
  rmSync(root, { recursive: true, force: true })
}
