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

export const startPackedHostConsumer = async (queryCoreVersion: string) => {
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
