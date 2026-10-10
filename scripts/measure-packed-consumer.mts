import { deepStrictEqual, equal } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import { performance } from 'node:perf_hooks'
import { gzipSync } from 'node:zlib'
import { build, version as viteVersion } from 'vite'

interface Compiler {
  readonly executable: string
  readonly label: string
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const compilerProjects = [
  [
    'contract',
    'tsconfig.contract-baseline.json',
    ['public-contract.ts', 'http-contract.ts', 'http-stream-contract.ts'],
  ],
  ['rpc', 'tsconfig.rpc-baseline.json', ['type-scale.ts']],
  ['http', 'tsconfig.http-baseline.json', ['http-type-scale.ts']],
] as const

const measureCompiler = (consumerDirectory: string, compiler: Compiler) => {
  const version = execFileSync(process.execPath, [compiler.executable, '--version'], {
    encoding: 'utf-8',
  }).trim()
  return compilerProjects.flatMap(([fixture, project, files]) => {
    const buildInfo = nodePath.join(consumerDirectory, `${fixture}-${compiler.label}.tsbuildinfo`)
    rmSync(buildInfo, { force: true })
    const fixtureHashes = Object.fromEntries(
      files.map((file) => [
        file,
        digest(readFileSync(nodePath.join(consumerDirectory, file), 'utf-8')),
      ]),
    )
    return (['cold-compiler', 'incremental-unchanged'] as const).map((phase) => {
      const started = performance.now()
      const output = execFileSync(
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
        { cwd: consumerDirectory, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 },
      )
      const milliseconds = performance.now() - started
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
      return {
        compiler: compiler.label,
        version,
        fixture,
        fixtureHashes,
        phase,
        milliseconds,
        diagnostics,
      }
    })
  })
}

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

const measureBundles = async (consumerDirectory: string) => {
  const measurements = await Promise.all(
    bundleProbes.map(async (probe) => {
      const entry = nodePath.join(consumerDirectory, `bundle-${probe.label}.mjs`)
      writeFileSync(entry, `export { ${probe.exported} } from 'effect-api-query'\n`)
      return Promise.all(
        (['external', 'included'] as const).map(async (peers) => {
          const result = await build({
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
                        id === 'effect' || id.startsWith('effect/') || id === '@tanstack/query-core'
                    : [],
              },
            },
          })
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
          return {
            probe: probe.label,
            peers,
            bytes: Buffer.byteLength(chunk.code),
            gzipBytes: gzipSync(chunk.code, { level: 9 }).byteLength,
            sha256: digest(chunk.code),
            externalImports: chunk.imports,
            renderedPackageExports: renderedExports,
            dependencyModules: dependencyModules.length,
          }
        }),
      )
    }),
  )
  return measurements.flat()
}

const measurePackedConsumer = async (consumerDirectory: string, compilers: readonly Compiler[]) => {
  const construction: unknown = JSON.parse(
    execFileSync(process.execPath, ['construction-baseline.mts'], {
      cwd: consumerDirectory,
      encoding: 'utf-8',
    }),
  )
  return {
    tools: { vite: viteVersion, minifier: 'oxc', comments: false, target: 'es2022', gzipLevel: 9 },
    construction,
    compilers: compilers.flatMap((compiler) => measureCompiler(consumerDirectory, compiler)),
    bundles: await measureBundles(consumerDirectory),
  }
}

const [consumerDirectory] = process.argv.slice(2)
if (consumerDirectory === undefined) {
  throw new Error('Pass the installed packed-consumer directory')
}
const repositoryRoot = nodePath.resolve(import.meta.dirname, '..')
const measurements = await measurePackedConsumer(consumerDirectory, [
  {
    label: 'typescript-5.9',
    executable: nodePath.join(repositoryRoot, 'node_modules/typescript-5.9/bin/tsc'),
  },
  {
    label: 'typescript-current',
    executable: nodePath.join(repositoryRoot, 'node_modules/typescript/bin/tsc'),
  },
])
writeFileSync(
  nodePath.join(consumerDirectory, 'packed-baseline.json'),
  `${JSON.stringify(measurements, null, 2)}\n`,
)
