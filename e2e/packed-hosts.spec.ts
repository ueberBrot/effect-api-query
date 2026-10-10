import { expect, test } from '@playwright/test'
import { Schema } from 'effect'
import { equal } from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build, preview } from 'vite'

const repositoryRoot = path.resolve(import.meta.dirname, '..')

const install = async (directory: string): Promise<void> => {
  const installation = spawn('pnpm', ['install', '--ignore-scripts', '--prefer-offline'], {
    cwd: directory,
    stdio: 'inherit',
  })
  const [code] = Schema.decodeUnknownSync(
    Schema.Tuple([Schema.NullOr(Schema.Int), Schema.NullOr(Schema.String)]),
  )(await once(installation, 'exit'))
  if (code !== 0) {
    throw new Error(`Host consumer installation exited with ${code}`)
  }
}

const startPackedHostConsumer = async (queryCoreVersion: string) => {
  const manifest = Schema.decodeSync(
    Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
  )(await readFile(path.join(repositoryRoot, 'package.json'), 'utf-8'))
  const archive = path.resolve(
    repositoryRoot,
    process.env['EFFECT_API_QUERY_TARBALL'] ??
      `.artifacts/effect-api-query-${manifest.version}.tgz`,
  )
  const digest = async () =>
    createHash('sha512')
      .update(await readFile(archive))
      .digest('hex')
  const sha512 = await digest()
  const directory = await mkdtemp(path.join(tmpdir(), 'effect-api-query-host-'))
  let server: Awaited<ReturnType<typeof preview>> | undefined
  const dispose = async () => {
    try {
      await server?.close()
    } finally {
      await rm(directory, { force: true, recursive: true })
      equal(await digest(), sha512, 'Host execution must preserve the exact archive')
    }
  }
  try {
    const workspace = await readFile(path.join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf-8')
    const effectVersion = /^ {2}effect: (?<version>\S+)$/mu.exec(workspace)?.groups?.['version']
    if (effectVersion === undefined) {
      throw new Error('The catalog must define Effect')
    }
    await cp(path.join(repositoryRoot, 'tests/packed-consumer/hosts'), directory, {
      recursive: true,
    })
    await writeFile(path.join(directory, 'pnpm-workspace.yaml'), workspace)
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'effect-api-query-host-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@tanstack/query-core': queryCoreVersion,
          effect: effectVersion,
          'effect-api-query': `file:${archive}`,
        },
      }),
    )
    await install(directory)
    await Promise.all(
      (
        [
          ['@tanstack/query-core', queryCoreVersion],
          ['effect', effectVersion],
          ['effect-api-query', manifest.version],
        ] as const
      ).map(async ([dependency, version]) => {
        const installed = Schema.decodeSync(
          Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
        )(await readFile(path.join(directory, 'node_modules', dependency, 'package.json'), 'utf-8'))
        equal(installed.version, version)
      }),
    )
    await build({
      configFile: false,
      root: directory,
      build: { target: 'es2022' },
      worker: { format: 'es' },
    })
    server = await preview({
      configFile: false,
      root: directory,
      preview: { host: '127.0.0.1', port: 0, strictPort: true },
    })
    const url = server.resolvedUrls?.local[0]
    if (url === undefined) {
      throw new Error('The host consumer must expose a local URL')
    }
    return { dispose, url }
  } catch (error) {
    await dispose()
    throw error
  }
}

const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf-8')
const current = /^ {2}['"]?@tanstack\/query-core['"]?: (?<version>\S+)$/mu.exec(workspace)
  ?.groups?.['version']
if (current === undefined) {
  throw new Error('The catalog must define Query Core')
}

const headerValue = Schema.Struct({
  body: Schema.Finite,
  headers: Schema.Record(Schema.String, Schema.String),
})
const hostObservation = Schema.Struct({
  host: Schema.String,
  read: Schema.Finite,
  rpc: Schema.Struct({
    mutation: Schema.Finite,
    after: Schema.Finite,
    accumulated: Schema.Array(Schema.Finite),
    live: Schema.Finite,
  }),
  http: Schema.Struct({
    read: headerValue,
    mutation: Schema.Finite,
    after: headerValue,
    accumulated: Schema.Array(Schema.Finite),
    live: Schema.Finite,
    metadata: Schema.Struct({
      data: headerValue,
      status: Schema.Finite,
      owner: Schema.String,
      frozenSnapshot: Schema.Boolean,
      frozenHeaders: Schema.Boolean,
    }),
  }),
  skipIdentity: Schema.Array(Schema.Boolean),
  ownership: Schema.Struct({
    before: Schema.Array(Schema.Finite),
    activeBefore: Schema.Array(Schema.Finite),
    activeAfterFirst: Schema.Array(Schema.Finite),
    secondData: Schema.Array(Schema.Finite),
    activeAfterBoth: Schema.Array(Schema.Finite),
    firstEvents: Schema.Array(Schema.String),
    secondEvents: Schema.Array(Schema.String),
  }),
})
const decodeResult = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ window: hostObservation, worker: hostObservation })),
)

for (const peer of new Set(['5.103.1', current])) {
  test(`packed RPC and HTTP operations execute in window and worker with Query Core ${peer}`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const host = await startPackedHostConsumer(peer)
    try {
      await page.goto(host.url)
      await expect(page.locator('#result')).toHaveAttribute('data-status', 'done', {
        timeout: 30_000,
      })
      const result = decodeResult((await page.locator('#result').textContent()) ?? '')
      expect(result.window.host).toBe('Window')
      expect(result.worker.host).toBe('DedicatedWorkerGlobalScope')
      expect(result.window.read).toBe(10)
      expect(result.worker.read).toBe(10)
      for (const observation of [result.window, result.worker]) {
        expect(observation.rpc).toEqual({
          mutation: 41,
          after: 41,
          accumulated: [41, 42, 43],
          live: 43,
        })
        expect(observation.http).toEqual({
          read: { body: 10, headers: { 'x-owner': 'Ada' } },
          mutation: 52,
          after: { body: 52, headers: { 'x-owner': 'Ada' } },
          accumulated: [52, 53, 54],
          live: 54,
          metadata: {
            data: { body: 52, headers: { 'x-owner': 'Ada' } },
            status: 200,
            owner: 'Ada',
            frozenSnapshot: true,
            frozenHeaders: true,
          },
        })
        expect(observation.skipIdentity).toEqual([true, true, true])
        expect(observation.ownership.before).toEqual([20, 20])
        expect(observation.ownership.activeBefore).toEqual([2, 2])
        expect(observation.ownership.activeAfterFirst).toEqual([0, 2])
        expect(observation.ownership.secondData).toEqual([20, 20])
        expect(observation.ownership.activeAfterBoth).toEqual([0, 0])
        for (const [name, events] of [
          ['Ada', observation.ownership.firstEvents],
          ['Grace', observation.ownership.secondEvents],
        ] as const) {
          expect(events).toEqual(
            expect.arrayContaining([
              `${name}:rpc-finalized`,
              `${name}:http-finalized`,
              `${name}:disposed`,
            ]),
          )
          expect(events.at(-1)).toBe(`${name}:disposed`)
        }
      }
    } finally {
      await host.dispose()
    }
  })
}
