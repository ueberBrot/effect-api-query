import { NodeServices } from '@effect/platform-node'
import { expect, test } from '@playwright/test'
import { Config, ConfigProvider, Crypto, Effect, FileSystem, Option, Path, Schema } from 'effect'
import { Hex } from 'effect/encoding'
import { build, preview } from 'vite'

import { decodeUtf8 } from '../scripts/decode-utf8.mts'
import { runCommand } from '../scripts/run-command.mts'

const startPackedHostConsumer = Effect.fnUntraced(function* (queryCoreVersion: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const crypto = yield* Crypto.Crypto
  const repositoryRoot = path.resolve(yield* path.fromFileUrl(new URL('..', import.meta.url)))
  const manifest = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
  )(decodeUtf8(yield* fs.readFile(path.join(repositoryRoot, 'package.json'))))
  const configuredArchive = yield* Config.String('EFFECT_API_QUERY_TARBALL')
    .pipe(Config.option)
    .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))
  const archive = path.resolve(
    repositoryRoot,
    Option.getOrUndefined(configuredArchive) ??
      `.artifacts/effect-api-query-${manifest.version}.tgz`,
  )
  const digest = Effect.fnUntraced(function* () {
    return Hex.encode(yield* crypto.digest('SHA-512', yield* fs.readFile(archive)))
  })
  const sha512 = yield* digest()
  yield* Effect.addFinalizer(() =>
    digest().pipe(
      Effect.tap((actual) =>
        Effect.sync(() => {
          expect(actual, 'Host execution must preserve the exact archive').toBe(sha512)
        }),
      ),
      Effect.orDie,
    ),
  )
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'effect-api-query-host-' })
  const workspaceBytes = yield* fs.readFile(path.join(repositoryRoot, 'pnpm-workspace.yaml'))
  const workspace = decodeUtf8(workspaceBytes)
  const effectVersion = /^ {2}effect: (?<version>\S+)$/mu.exec(workspace)?.groups?.['version']
  if (effectVersion === undefined) {
    throw new Error('The catalog must define Effect')
  }
  yield* fs.copy(path.join(repositoryRoot, 'tests/packed-consumer/hosts'), directory, {
    overwrite: true,
  })
  yield* fs.writeFile(path.join(directory, 'pnpm-workspace.yaml'), workspaceBytes)
  yield* fs.writeFileString(
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
  yield* runCommand('pnpm', ['install', '--ignore-scripts', '--prefer-offline'], {
    cwd: directory,
    stdio: 'inherit',
  })
  for (const [dependency, version] of [
    ['@tanstack/query-core', queryCoreVersion],
    ['effect', effectVersion],
    ['effect-api-query', manifest.version],
  ] as const) {
    const installed = yield* Schema.decodeEffect(
      Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
    )(
      decodeUtf8(
        yield* fs.readFile(path.join(directory, 'node_modules', dependency, 'package.json')),
      ),
    )
    expect(installed.version).toBe(version)
  }
  yield* Effect.uninterruptible(
    Effect.promise(
      async () =>
        await build({
          configFile: false,
          root: directory,
          build: { target: 'es2022' },
          worker: { format: 'es' },
        }),
    ),
  )
  const server = yield* Effect.acquireRelease(
    Effect.promise(
      async () =>
        await preview({
          configFile: false,
          root: directory,
          preview: { host: '127.0.0.1', port: 0, strictPort: true },
        }),
    ),
    (value) =>
      Effect.promise(async () => {
        await value.close()
      }),
  )
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) {
    throw new Error('The host consumer must expose a local URL')
  }
  return { url }
})

const workspace = await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return decodeUtf8(
      yield* fs.readFile(
        yield* path.fromFileUrl(new URL('../pnpm-workspace.yaml', import.meta.url)),
      ),
    )
  }).pipe(Effect.provide(NodeServices.layer)),
)
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
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* startPackedHostConsumer(peer)
          yield* Effect.promise(async () => {
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
          })
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
    )
  })
}
