import { NodeHttpPlatform, NodeRuntime, NodeServices } from '@effect/platform-node'
import { Clock, Crypto, Effect, FileSystem, Layer, Path, Stdio } from 'effect'
import { Hex } from 'effect/encoding'
import { HttpPlatform, HttpServerResponse } from 'effect/http'
import { deepStrictEqual, equal } from 'node:assert/strict'
import { build, version as viteVersion } from 'vite'

import { runCommand } from './run-command.mts'

interface Compiler {
  readonly executable: string
  readonly label: string
}

const digest = Effect.fnUntraced(function* (value: Uint8Array) {
  const crypto = yield* Crypto.Crypto
  return Hex.encode(yield* crypto.digest('SHA-256', value))
})
const compilerProjects = [
  [
    'contract',
    'tsconfig.contract-baseline.json',
    ['public-contract.ts', 'http-contract.ts', 'http-stream-contract.ts'],
  ],
  ['rpc', 'tsconfig.rpc-baseline.json', ['type-scale.ts']],
  ['http', 'tsconfig.http-baseline.json', ['http-type-scale.ts']],
] as const

const measureCompiler = Effect.fnUntraced(function* (
  consumerDirectory: string,
  compiler: Compiler,
) {
  const fs = yield* FileSystem.FileSystem
  const nodePath = yield* Path.Path
  const clock = yield* Clock.Clock
  const version = (yield* runCommand(process.execPath, [compiler.executable, '--version'])).trim()
  const measurements = []
  for (const [fixture, project, files] of compilerProjects) {
    const buildInfo = nodePath.join(consumerDirectory, `${fixture}-${compiler.label}.tsbuildinfo`)
    yield* fs.remove(buildInfo, { force: true })
    const fixtureHashes: Record<string, string> = {}
    for (const file of files) {
      fixtureHashes[file] = yield* digest(
        yield* fs.readFile(nodePath.join(consumerDirectory, file)),
      )
    }
    for (const phase of ['cold-compiler', 'incremental-unchanged'] as const) {
      const started = clock.monotonicTimeNanosUnsafe()
      const output = yield* runCommand(
        process.execPath,
        [
          compiler.executable,
          '-p',
          project,
          '--pretty',
          'false',
          '--extendedDiagnostics',
          '--incremental',
          '--tsBuildInfoFile',
          buildInfo,
        ],
        { cwd: consumerDirectory, maxBuffer: 16 * 1024 * 1024 },
      )
      const milliseconds = Number(clock.monotonicTimeNanosUnsafe() - started) / 1_000_000
      const diagnostics: Record<string, string> = {}
      for (const entry of output.matchAll(/^(?<label>[^:\n]+):\s*(?<value>[^\n]+)$/gmu)) {
        const label = entry.groups?.['label']?.trim()
        const value = entry.groups?.['value']?.trim()
        if (label !== undefined && value !== undefined) {
          diagnostics[label] = value
        }
      }
      for (const count of ['Types', 'Instantiations']) {
        equal(
          /^\d+$/u.test(diagnostics[count] ?? ''),
          true,
          `Compiler diagnostics must report ${count}`,
        )
      }
      console.log(`Measured ${fixture} with ${compiler.label}: ${phase}\n${output}`)
      measurements.push({
        compiler: compiler.label,
        version,
        fixture,
        fixtureHashes,
        phase,
        milliseconds,
        diagnostics,
      })
    }
  }
  return measurements
})

const bundleProbes = [
  {
    label: 'error-guard',
    exported: 'isEffectRpcQueryError',
    excluded: ['createRpcQueryUtils', 'createHttpApiQueryUtils', 'fetchStreamSnapshot'],
  },
  {
    label: 'rpc-adapter',
    exported: 'createRpcQueryUtils',
    excluded: ['createHttpApiQueryUtils', 'fetchStreamSnapshot'],
  },
  {
    label: 'http-adapter',
    exported: 'createHttpApiQueryUtils',
    excluded: ['createRpcQueryUtils', 'fetchStreamSnapshot'],
  },
] as const

const measureBundles = Effect.fnUntraced(function* (consumerDirectory: string) {
  const fs = yield* FileSystem.FileSystem
  const nodePath = yield* Path.Path
  const platform = yield* HttpPlatform.HttpPlatform
  const measurements = yield* Effect.forEach(
    bundleProbes,
    Effect.fnUntraced(function* (probe) {
      const entry = nodePath.join(consumerDirectory, `bundle-${probe.label}.mjs`)
      yield* fs.writeFileString(entry, `export { ${probe.exported} } from 'effect-api-query'\n`)
      return yield* Effect.forEach(
        ['external', 'included'] as const,
        Effect.fnUntraced(function* (peers) {
          const result = yield* Effect.promise(
            async () =>
              await build({
                configFile: false,
                root: consumerDirectory,
                logLevel: 'silent',
                build: {
                  write: false,
                  minify: 'oxc',
                  target: 'es2022',
                  lib: { entry, formats: ['es'] },
                  rolldownOptions: {
                    output: { minify: true, comments: false },
                    external:
                      peers === 'external'
                        ? (id) =>
                            id === 'effect' ||
                            id.startsWith('effect/') ||
                            id === '@tanstack/query-core'
                        : [],
                  },
                },
              }),
          )
          if (!Array.isArray(result) && !('output' in result)) {
            throw new Error('The bundle probe unexpectedly created a watcher')
          }
          const outputs = Array.isArray(result)
            ? result.flatMap((output) => output.output)
            : result.output
          const chunks = outputs.filter((output) => output.type === 'chunk')
          equal(chunks.length, 1, 'Each bundle probe must produce one ESM chunk')
          const [chunk] = chunks
          if (chunk === undefined) {
            throw new Error('The bundle probe emitted no JavaScript')
          }
          deepStrictEqual(chunk.exports, [probe.exported])
          const packageModules = Object.entries(chunk.modules).filter(([id]) =>
            id.endsWith('/effect-api-query/dist/index.mjs'),
          )
          equal(
            packageModules.length,
            1,
            'The bundle probe must consume the installed package entry',
          )
          const renderedExports = packageModules.flatMap(([, module]) => module.renderedExports)
          equal(renderedExports.includes(probe.exported), true)
          for (const excluded of probe.excluded) {
            equal(
              renderedExports.includes(excluded),
              false,
              `${probe.label} must remove ${excluded}`,
            )
          }
          const dependencyModules = Object.keys(chunk.modules).filter(
            (id) =>
              id.includes('/node_modules/') && !id.endsWith('/effect-api-query/dist/index.mjs'),
          )
          if (peers === 'external') {
            equal(dependencyModules.length, 0)
          } else {
            equal(
              chunk.imports.length,
              0,
              'The peer-inclusive browser probe must have no external imports',
            )
          }
          const bytes = new TextEncoder().encode(chunk.code)
          const compressed = yield* platform.compression.compressResponse(
            HttpServerResponse.uint8Array(bytes),
            'gzip',
            { level: 9 },
          )
          const gzip = yield* HttpServerResponse.toClientResponse(compressed).arrayBuffer
          return {
            probe: probe.label,
            peers,
            bytes: bytes.byteLength,
            gzipBytes: gzip.byteLength,
            sha256: yield* digest(bytes),
            externalImports: chunk.imports,
            renderedPackageExports: renderedExports,
            dependencyModules: dependencyModules.length,
          }
        }),
        { concurrency: 'unbounded' },
      )
    }),
    { concurrency: 'unbounded' },
  )
  return measurements.flat()
})

const measurePackedConsumer = Effect.fnUntraced(function* (
  consumerDirectory: string,
  compilers: readonly Compiler[],
) {
  const construction: unknown = JSON.parse(
    yield* runCommand(process.execPath, ['construction-baseline.mts'], { cwd: consumerDirectory }),
  )
  const compilerMeasurements = []
  for (const compiler of compilers) {
    compilerMeasurements.push(...(yield* measureCompiler(consumerDirectory, compiler)))
  }
  return {
    tools: { vite: viteVersion, minifier: 'oxc', comments: false, target: 'es2022', gzipLevel: 9 },
    construction,
    compilers: compilerMeasurements,
    bundles: yield* measureBundles(consumerDirectory),
  }
})

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const nodePath = yield* Path.Path
  const stdio = yield* Stdio.Stdio
  const [consumerDirectory] = yield* stdio.args
  if (consumerDirectory === undefined) {
    throw new Error('Pass the installed packed-consumer directory')
  }
  const repositoryRoot = nodePath.resolve(
    yield* nodePath.fromFileUrl(new URL('..', import.meta.url)),
  )
  const measurements = yield* measurePackedConsumer(consumerDirectory, [
    {
      label: 'typescript-5.9',
      executable: nodePath.join(repositoryRoot, 'node_modules/typescript-5.9/bin/tsc'),
    },
    {
      label: 'typescript-current',
      executable: nodePath.join(repositoryRoot, 'node_modules/typescript/bin/tsc'),
    },
  ])
  yield* fs.writeFileString(
    nodePath.join(consumerDirectory, 'packed-baseline.json'),
    `${JSON.stringify(measurements, null, 2)}\n`,
  )
})
NodeRuntime.runMain(
  program.pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeHttpPlatform.layer))),
)
