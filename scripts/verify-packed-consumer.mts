import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { listIntentSkills, loadIntentSkill } from '@tanstack/intent/core'
import { Config, ConfigProvider, Crypto, Effect, FileSystem, Option, Path, Schema } from 'effect'
import { Hex } from 'effect/encoding'
// fallow-ignore-file unused-file
// Vite+ invokes this verifier through its dynamically declared packed-package task.
import { deepStrictEqual, equal, match } from 'node:assert/strict'
import { builtinModules } from 'node:module'
import ts from 'typescript-5.9'

import serverManifest from '../examples/server/package.json' with { type: 'json' }
import repositoryManifest from '../package.json' with { type: 'json' }
import { runCommand } from './run-command.mts'

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const nodePath = yield* Path.Path
  const crypto = yield* Crypto.Crypto
  const scriptDirectory = yield* nodePath.fromFileUrl(new URL('.', import.meta.url))
  const repositoryRoot = nodePath.resolve(scriptDirectory, '..')
  const artifactDirectory = nodePath.join(repositoryRoot, '.artifacts')
  const consumerFixtureDirectory = nodePath.join(repositoryRoot, 'tests', 'packed-consumer')
  const lockfilePath = nodePath.join(repositoryRoot, 'pnpm-lock.yaml')
  const typeFixtureDirectory = nodePath.join(repositoryRoot, 'tests', 'types')
  const workspaceConfigPath = nodePath.join(repositoryRoot, 'pnpm-workspace.yaml')
  const workspaceConfig = yield* fs.readFileString(workspaceConfigPath)
  const defaultTarballName = `${repositoryManifest.name.replace(/^@/u, '').replaceAll('/', '-')}-${repositoryManifest.version}.tgz`
  const tarballPath = nodePath.resolve(
    repositoryRoot,
    Option.getOrUndefined(
      yield* Config.String('EFFECT_API_QUERY_TARBALL')
        .pipe(Config.option)
        .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
    ) ?? nodePath.join(artifactDirectory, defaultTarballName),
  )
  if (!(yield* fs.exists(tarballPath))) {
    throw new Error(`Packed tarball does not exist: ${tarballPath}`)
  }
  const artifactDigest = Effect.fnUntraced(function* () {
    return Hex.encode(yield* crypto.digest('SHA-512', yield* fs.readFile(tarballPath)))
  })
  const initialDigest = yield* artifactDigest()
  const packedManifest = yield* Schema.decodeEffect(
    Schema.fromJsonString(
      Schema.Struct({
        bugs: Schema.Struct({ url: Schema.String }),
        dependencies: Schema.optionalKey(Schema.Unknown),
        description: Schema.String,
        engines: Schema.optionalKey(Schema.Unknown),
        exports: Schema.Unknown,
        homepage: Schema.String,
        keywords: Schema.Array(Schema.String),
        license: Schema.String,
        name: Schema.String,
        peerDependencies: Schema.Struct({
          '@tanstack/query-core': Schema.String,
          effect: Schema.String,
        }).annotate({ parseOptions: { onExcessProperty: 'error' } }),
        publishConfig: Schema.Struct({ access: Schema.String }).annotate({
          parseOptions: { onExcessProperty: 'error' },
        }),
        repository: Schema.Struct({ url: Schema.String }),
        sideEffects: Schema.Boolean,
        type: Schema.String,
        version: Schema.String,
      }),
    ),
  )(yield* runCommand('tar', ['-xOzf', tarballPath, 'package/package.json'], {}))
  equal(packedManifest.name, 'effect-api-query')
  equal(
    packedManifest.version,
    repositoryManifest.version,
    'The packed version must match the root manifest',
  )
  equal('dependencies' in packedManifest, false)
  equal(packedManifest.license, 'ISC')
  equal(packedManifest.sideEffects, false)
  equal(packedManifest.type, 'module')
  equal(packedManifest.repository.url, 'git+https://github.com/ueberBrot/effect-api-query.git')
  equal(packedManifest.homepage, 'https://github.com/ueberBrot/effect-api-query#readme')
  equal(packedManifest.bugs.url, 'https://github.com/ueberBrot/effect-api-query/issues')
  equal(packedManifest.description, repositoryManifest.description)
  deepStrictEqual(packedManifest.publishConfig, { access: 'public' })
  const testedVersion = (dependency: keyof typeof repositoryManifest.devDependencies): string => {
    const specifier = repositoryManifest.devDependencies[dependency]
    if (specifier !== 'catalog:') {
      return specifier
    }
    const escapedDependency = dependency.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const catalogVersion = new RegExp(
      `^  ['"]?${escapedDependency}['"]?: (?<version>\\S+)$`,
      'mu',
    ).exec(workspaceConfig)?.groups?.['version']
    if (catalogVersion === undefined) {
      throw new Error(`The default catalog must define ${dependency}`)
    }
    return catalogVersion
  }
  const lockfile = yield* fs.readFileString(lockfilePath)
  const lockedVersions = (dependency: string): readonly string[] => {
    const escapedDependency = dependency.replaceAll('/', '\\/')
    // pnpm stores the project graph last, after any package-manager/config document.
    const projectLockfile = lockfile.split(/^---[ \t]*(?:#[^\r\n]*)?\r?$/mu).at(-1)
    if (
      projectLockfile === undefined ||
      !/^lockfileVersion: ['"]9\.0['"]\r?$/mu.test(projectLockfile) ||
      !/^importers:\r?$/mu.test(projectLockfile)
    ) {
      throw new Error('The last lockfile document must define the version 9 project graph')
    }
    const lockedPackages = /^packages:\n(?<packages>[\s\S]*?)^snapshots:/mu.exec(projectLockfile)
      ?.groups?.['packages']
    if (lockedPackages === undefined) {
      throw new Error('The project lockfile must define resolved packages and snapshots')
    }
    const matches = lockedPackages.matchAll(
      new RegExp(`^  ['"]?${escapedDependency}@(?<version>[^('":]+)`, 'gmu'),
    )
    return [...new Set(Array.from(matches, (lockedMatch) => lockedMatch.groups?.['version']))]
      .filter((version): version is string => version !== undefined)
      .sort()
  }
  const overrides = /^overrides:\n(?<entries>(?:[ \t]+[^\n]*\n)*)/mu.exec(workspaceConfig)
    ?.groups?.['entries']
  match(overrides ?? '', /^ {2}['"]?vitest@\*['"]?: ['"]?catalog:['"]?$/mu)
  const vitestOverride = testedVersion('vitest')
  deepStrictEqual(lockedVersions('effect'), [testedVersion('effect')])
  deepStrictEqual(lockedVersions('vitest'), [vitestOverride])
  deepStrictEqual(packedManifest.exports, {
    '.': {
      types: './dist/index.d.mts',
      import: './dist/index.mjs',
    },
  })
  equal('engines' in packedManifest, false)
  const publicBarrel = yield* fs.readFileString(nodePath.join(repositoryRoot, 'src', 'index.ts'))
  equal(
    /\bexport\s+(?:type\s+)?\*/u.test(publicBarrel),
    false,
    'The public barrel must use named exports',
  )
  const builtModule = yield* runCommand('tar', ['-xOzf', tarballPath, 'package/dist/index.mjs'], {})
  match(builtModule, /from ["']@tanstack\/query-core["']/u)
  match(builtModule, /from ["']effect(?:\/rpc)?["']/u)
  equal(/\bnode:/u.test(builtModule), false, 'The runtime must not import Node APIs')
  for (const imported of builtModule.matchAll(/\bfrom\s*["'](?<specifier>[^"']+)["']/gu)) {
    equal(
      builtinModules.includes(imported.groups?.['specifier'] ?? ''),
      false,
      'The runtime must not import bare Node built-ins',
    )
  }
  const sourceMap = yield* Schema.decodeEffect(
    Schema.fromJsonString(
      Schema.Struct({
        sources: Schema.Array(Schema.String),
      }),
    ),
  )(yield* runCommand('tar', ['-xOzf', tarballPath, 'package/dist/index.mjs.map'], {}))
  equal(
    sourceMap.sources.some((source) => source.includes('node_modules/')),
    false,
    'The runtime must not bundle private copies of dependencies',
  )
  const builtDeclaration = yield* runCommand(
    'tar',
    ['-xOzf', tarballPath, 'package/dist/index.d.mts'],
    {},
  )
  const declarationSource = ts.createSourceFile(
    'index.d.mts',
    builtDeclaration,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const declarationNames = declarationSource.statements
    .flatMap((statement) => {
      if (ts.isExportDeclaration(statement)) {
        if (statement.exportClause === undefined) {
          throw new Error('The declaration entry must use named exports')
        }
        return ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((element) => element.name.text)
          : [statement.exportClause.name.text]
      }
      if (ts.isExportAssignment(statement)) {
        equal(statement.isExportEquals, false, 'The declaration entry must use ESM exports')
        return ['default']
      }
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
      if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) !== true) {
        return []
      }
      if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
        return ['default']
      }
      if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.map((declaration) => {
          if (!ts.isIdentifier(declaration.name)) {
            throw new Error('Exported declaration variables must have names')
          }
          return declaration.name.text
        })
      }
      if (
        ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement)
      ) {
        if (statement.name === undefined) {
          throw new Error('Exported declarations must have names')
        }
        return [statement.name.text]
      }
      throw new Error('Unsupported exported declaration')
    })
    .sort()
  deepStrictEqual(declarationNames, [
    'CreateHttpApiQueryUtilsOptions',
    'CreateRpcQueryUtilsOptions',
    'EffectHttpApiQueryConfigError',
    'EffectHttpApiQueryConfigErrorCode',
    'EffectHttpApiQueryEmptyStreamError',
    'EffectHttpApiQueryError',
    'EffectHttpApiQueryKeyError',
    'EffectHttpApiQueryKeyErrorCode',
    'EffectRpcQueryConfigError',
    'EffectRpcQueryConfigErrorCode',
    'EffectRpcQueryEmptyStreamError',
    'EffectRpcQueryError',
    'EffectRpcQueryKeyError',
    'EffectRpcQueryKeyErrorCode',
    'HttpApiKeyEncoder',
    'HttpApiQueryUtils',
    'JsonValue',
    'KeyEncoder',
    'QueryData',
    'RpcQueryUtils',
    'RunPromiseExit',
    'SkipToken',
    'StreamSnapshotOptions',
    'StreamingRpcOptions',
    'UnaryRpcOptions',
    'createHttpApiQueryUtils',
    'createRpcQueryUtils',
    'fetchStreamSnapshot',
    'isEffectHttpApiQueryError',
    'isEffectRpcQueryError',
    'skipToken',
  ])
  const queryCoreCompatibilityCases = () => {
    const supportedPeerRange = '>=5.103.1 <6'
    deepStrictEqual(packedManifest.peerDependencies, {
      '@tanstack/query-core': supportedPeerRange,
      effect: testedVersion('effect'),
    })
    const range = /^>=(?<minimum>\d+\.\d+\.\d+) <(?<nextMajor>\d+)$/u.exec(
      supportedPeerRange,
    )?.groups
    if (range?.['minimum'] === undefined || range['nextMajor'] === undefined) {
      throw new Error(`Unsupported Query Core peer range: ${supportedPeerRange}`)
    }
    const current = testedVersion('@tanstack/query-core')
    const currentReact = testedVersion('@tanstack/react-query')
    equal(currentReact, current)
    deepStrictEqual(lockedVersions('@tanstack/query-core'), [current])
    deepStrictEqual(lockedVersions('@tanstack/react-query'), [currentReact])
    const [currentMajor] = current.split('.')
    equal(
      range['nextMajor'],
      String(Number(currentMajor) + 1),
      'The Query Core peer range must stop before the next major',
    )
    const lowerBound = {
      label:
        current === range['minimum']
          ? 'query-core-lower-bound-and-current'
          : 'query-core-lower-bound',
      queryCoreVersion: range['minimum'],
      reactQueryVersion: range['minimum'],
    }
    return current === range['minimum']
      ? [lowerBound]
      : [
          lowerBound,
          {
            label: 'query-core-current',
            queryCoreVersion: current,
            reactQueryVersion: currentReact,
          },
        ]
  }
  const packedFiles = (yield* runCommand('tar', ['-tzf', tarballPath], {}))
    .trim()
    .split('\n')
    .sort()
  const skillPaths = [
    'skills/effect-api-query/SKILL.md',
    'skills/effect-api-query/references/cache-workflows.md',
    'skills/effect-api-query/references/frameworks-and-hosts.md',
    'skills/effect-api-query/references/http.md',
    'skills/effect-api-query/references/hydration-and-ssr.md',
    'skills/effect-api-query/references/query-patterns.md',
    'skills/effect-api-query/references/rpc.md',
  ]
  const skillExamples: string[] = []
  for (const path of ['LICENSE', ...skillPaths]) {
    const packedContent = yield* runCommand('tar', ['-xOzf', tarballPath, `package/${path}`], {})
    equal(
      packedContent,
      yield* fs.readFileString(nodePath.join(repositoryRoot, path)),
      `The packed ${path} must match the candidate`,
    )
    for (const sample of packedContent.matchAll(/^```ts\n(?<source>[\s\S]*?)^```/gmu)) {
      const source = sample.groups?.['source']
      if (source !== undefined) {
        skillExamples.push(source)
      }
    }
  }
  equal(skillExamples.length > 0, true, 'The packed usage skill must have compilable examples')
  equal(packedManifest.keywords.includes('tanstack-intent'), true)
  deepStrictEqual(packedFiles, [
    'package/LICENSE',
    'package/README.md',
    'package/dist/index.d.mts',
    'package/dist/index.mjs',
    'package/dist/index.mjs.map',
    'package/package.json',
    ...skillPaths.map((path) => `package/${path}`),
  ])
  const compilerCases = [
    {
      executable: nodePath.join(repositoryRoot, 'node_modules', 'typescript-5.9', 'bin', 'tsc'),
      label: 'typescript-5.9',
    },
    {
      executable: nodePath.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      label: 'typescript-current',
    },
  ] as const
  const peerCases = queryCoreCompatibilityCases()
  const runTypeScript = Effect.fnUntraced(function* (
    consumerDirectory: string,
    compiler: (typeof compilerCases)[number],
    project:
      | 'tsconfig.json'
      | 'tsconfig.openapi.json'
      | 'tsconfig.tanstack-start.json'
      | 'tsconfig.contract-baseline.json'
      | 'tsconfig.rpc-baseline.json'
      | 'tsconfig.http-baseline.json'
      | 'tsconfig.svelte-angular.json'
      | 'tsconfig.vue-solid.json',
    extendedDiagnostics: boolean,
  ) {
    console.log(`Verifying ${project} with ${compiler.label}`)
    yield* runCommand(
      process.execPath,
      [
        compiler.executable,
        '-p',
        project,
        '--pretty',
        'false',
        ...(extendedDiagnostics ? ['--extendedDiagnostics'] : []),
      ],
      { cwd: consumerDirectory, stdio: 'inherit' },
    )
  })
  const baselines: unknown[] = []
  const verifyConsumer = Effect.fnUntraced(function* (peer: (typeof peerCases)[number]) {
    const consumerDirectory = yield* fs.makeTempDirectoryScoped({
      prefix: `effect-api-query-${peer.label}-`,
    })
    yield* fs.copy(consumerFixtureDirectory, consumerDirectory, { overwrite: true })
    yield* fs.writeFileString(
      nodePath.join(consumerDirectory, 'websocket-server.ts'),
      (yield* fs.readFileString(
        nodePath.join(repositoryRoot, 'examples/server/tests/fixtures/websocket-server.ts'),
      )).replaceAll("'../../../../tests/packed-consumer/socket-client.ts'", "'./socket-client.ts'"),
    )
    const socketChecksPath = nodePath.join(consumerDirectory, 'websocket-checks.ts')
    yield* fs.writeFileString(
      socketChecksPath,
      (yield* fs.readFileString(socketChecksPath)).replaceAll(
        "'../../examples/server/tests/fixtures/websocket-server.ts'",
        "'./websocket-server.ts'",
      ),
    )
    yield* fs.copy(
      nodePath.join(repositoryRoot, 'examples', 'contracts', 'src'),
      nodePath.join(consumerDirectory, 'optimistic-contracts'),
      { overwrite: true },
    )
    const applicationDirectory = nodePath.join(consumerDirectory, 'optimistic-application')
    yield* fs.copy(
      nodePath.join(repositoryRoot, 'examples', 'vite-react', 'src', 'lib'),
      applicationDirectory,
      { overwrite: true },
    )
    for (const file of yield* fs.readDirectory(applicationDirectory)) {
      if (file.endsWith('.ts')) {
        const path = nodePath.join(applicationDirectory, file)
        yield* fs.writeFileString(
          path,
          (yield* fs.readFileString(path))
            .replaceAll(
              "'@effect-api-query/contracts/client'",
              "'../optimistic-contracts/client.ts'",
            )
            .replaceAll("'@effect-api-query/contracts'", "'../optimistic-contracts/index.ts'"),
        )
      }
    }
    for (const [directory, files] of [
      [
        'server',
        [
          'commands.ts',
          'diagnostic-operations.ts',
          'domain.ts',
          'http-handlers.ts',
          'rpc-handlers.ts',
          'server-local-rpc.ts',
          'users.ts',
          'web-handler.ts',
        ],
      ],
      ['tanstack-start', ['application.ts', 'server-application.ts', 'snapshot-preparation.ts']],
    ] as const) {
      const destination = nodePath.join(consumerDirectory, `start-${directory}`)
      yield* fs.makeDirectory(destination)
      for (const file of files) {
        const source = nodePath.join(
          repositoryRoot,
          'examples',
          directory,
          'src',
          directory === 'tanstack-start' ? 'lib' : '',
          file,
        )
        yield* fs.writeFileString(
          nodePath.join(destination, file),
          (yield* fs.readFileString(source))
            .replaceAll(
              "'@effect-api-query/contracts/client'",
              "'../optimistic-contracts/client.ts'",
            )
            .replaceAll("'@effect-api-query/contracts'", "'../optimistic-contracts/index.ts'")
            .replaceAll(
              "'@effect-api-query/server/web-handler'",
              "'../start-server/web-handler.ts'",
            ),
        )
      }
    }
    yield* fs.writeFileString(
      nodePath.join(consumerDirectory, 'optimistic-users.ts'),
      (yield* fs.readFileString(
        nodePath.join(repositoryRoot, 'tests', 'fixtures', 'optimistic-users.ts'),
      ))
        .replaceAll("'@effect-api-query/contracts/client'", "'./optimistic-contracts/client.ts'")
        .replaceAll("'@effect-api-query/contracts'", "'./optimistic-contracts/index.ts'")
        .replaceAll("'#effect-api-query'", "'effect-api-query'")
        .replaceAll(
          "'../../examples/vite-react/src/lib/application.ts'",
          "'./optimistic-application/application.ts'",
        )
        .replaceAll(
          "'../../examples/vite-react/src/lib/owner-cache.ts'",
          "'./optimistic-application/owner-cache.ts'",
        )
        .replaceAll(
          "'../../examples/vite-react/src/lib/user-writes.ts'",
          "'./optimistic-application/user-writes.ts'",
        ),
    )
    for (const file of [
      'optimistic-runtime.mts',
      'optimistic-contract.ts',
      'events-runtime.mts',
      'events-contract.ts',
    ]) {
      const path = nodePath.join(consumerDirectory, file)
      yield* fs.writeFileString(
        path,
        (yield* fs.readFileString(path))
          .replaceAll(
            "'../../examples/contracts/src/contracts.ts'",
            "'./optimistic-contracts/contracts.ts'",
          )
          .replaceAll("'../fixtures/optimistic-users.ts'", "'./optimistic-users.ts'"),
      )
    }
    const startRuntimePath = nodePath.join(consumerDirectory, 'start-ssr-runtime.mts')
    yield* fs.writeFileString(
      startRuntimePath,
      (yield* fs.readFileString(startRuntimePath))
        .replaceAll(
          "'../../examples/contracts/src/contracts.ts'",
          "'./optimistic-contracts/contracts.ts'",
        )
        .replaceAll("'../../examples/server/src/web-handler.ts'", "'./start-server/web-handler.ts'")
        .replaceAll(
          "'../../examples/tanstack-start/src/lib/server-application.ts'",
          "'./start-tanstack-start/server-application.ts'",
        )
        .replaceAll(
          "'../../examples/tanstack-start/src/lib/snapshot-preparation.ts'",
          "'./start-tanstack-start/snapshot-preparation.ts'",
        ),
    )
    const eventRecipe = nodePath.join(consumerDirectory, 'user-events.ts')
    yield* fs.writeFileString(
      eventRecipe,
      (yield* fs.readFileString(eventRecipe))
        .replaceAll(
          "'../../examples/vite-react/src/lib/application.ts'",
          "'./optimistic-application/application.ts'",
        )
        .replaceAll("'../../examples/vite-react/src/lib/owner-cache.ts'", "'./owner-cache.ts'"),
    )
    for (const fixture of [
      'public-contract.ts',
      'tanstack-start-contract.ts',
      'http-contract.ts',
      'http-stream-contract.ts',
      'type-scale.ts',
      'http-type-scale.ts',
      'docs-rpc-quick-start.ts',
      'docs-http-quick-start.ts',
    ]) {
      yield* fs.copyFile(
        nodePath.join(typeFixtureDirectory, fixture),
        nodePath.join(consumerDirectory, fixture),
      )
    }
    yield* fs.copyFile(
      nodePath.join(repositoryRoot, 'examples/vite-react/src/lib/owner-cache.ts'),
      nodePath.join(consumerDirectory, 'owner-cache.ts'),
    )
    const svelteQueryVersion = new Map([
      ['5.103.1', '6.2.1'],
      ['5.104.0', '6.3.0'],
    ]).get(peer.queryCoreVersion)
    if (svelteQueryVersion === undefined) {
      throw new Error(`No Svelte Query compatibility case for Query Core ${peer.queryCoreVersion}`)
    }
    const consumerManifest = {
      name: `effect-api-query-packed-consumer-${peer.label}`,
      private: true,
      type: 'module',
      intent: { skills: ['effect-api-query'] },
      dependencies: {
        '@angular/common': '22.2.1',
        '@angular/compiler': '22.2.1',
        '@angular/core': '22.2.1',
        '@angular/platform-browser': '22.2.1',
        '@effect/platform-node': serverManifest.dependencies['@effect/platform-node'],
        '@tanstack/angular-query-experimental': peer.queryCoreVersion,
        '@tanstack/query-core': peer.queryCoreVersion,
        '@tanstack/react-query': peer.reactQueryVersion,
        '@tanstack/solid-query': peer.queryCoreVersion,
        '@tanstack/vue-query': peer.queryCoreVersion,
        '@tanstack/react-router': testedVersion('@tanstack/react-router'),
        '@tanstack/react-router-ssr-query': testedVersion('@tanstack/react-router-ssr-query'),
        '@tanstack/react-start': testedVersion('@tanstack/react-start'),
        '@tanstack/svelte-query': svelteQueryVersion,
        '@types/node': testedVersion('@types/node'),
        '@types/react': testedVersion('@types/react'),
        '@types/react-dom': testedVersion('@types/react-dom'),
        effect: testedVersion('effect'),
        'effect-api-query': `file:${tarballPath}`,
        'openapi-fetch': '0.17.0',
        'openapi-typescript': '7.13.0',
        react: testedVersion('react'),
        'react-dom': testedVersion('react-dom'),
        rxjs: '7.8.2',
        svelte: '5.57.1',
        'solid-js': '1.9.15',
        typescript: testedVersion('typescript-5.9').replace('npm:typescript@', ''),
        vue: '3.5.43',
      },
    }
    yield* fs.writeFileString(
      nodePath.join(consumerDirectory, 'package.json'),
      JSON.stringify(consumerManifest, null, 2),
    )
    for (const [index, source] of skillExamples.entries()) {
      yield* fs.writeFileString(
        nodePath.join(consumerDirectory, `skill-example-${index}.ts`),
        source,
      )
    }
    // Prefer cached artifacts, but allow a fresh machine to fetch exact pinned versions.
    // The temporary project must resolve every peer from its own node_modules.
    yield* fs.writeFileString(
      nodePath.join(consumerDirectory, 'pnpm-workspace.yaml'),
      workspaceConfig,
    )
    yield* runCommand('pnpm', ['install', '--ignore-scripts', '--prefer-offline'], {
      cwd: consumerDirectory,
      stdio: 'inherit',
    })
    yield* runCommand(process.execPath, ['openapi-generate.mjs'], {
      cwd: consumerDirectory,
      stdio: 'inherit',
    })
    const skillUse = 'effect-api-query#effect-api-query'
    const intentOptions = { cwd: consumerDirectory }
    const catalog = listIntentSkills(intentOptions)
    deepStrictEqual(
      catalog.skills.map((skill) => skill.use),
      [skillUse],
    )
    const loadedSkill = loadIntentSkill(skillUse, intentOptions)
    equal(loadedSkill.version, packedManifest.version)
    equal(
      yield* fs.readFileString(nodePath.resolve(consumerDirectory, loadedSkill.path)),
      yield* fs.readFileString(nodePath.join(repositoryRoot, 'skills/effect-api-query/SKILL.md')),
      'Intent must load the shipped skill from the installed package',
    )
    // Intent can emit paths relative to the consumer or absolute paths when the
    // package resolves outside it (for example through a symlinked temp directory).
    const loadedReferences = new Set<string>()
    for (const link of loadedSkill.content.matchAll(/\]\((?<destination>[^)\n]+\.md)\)/gu)) {
      const destination = link.groups?.['destination']
      if (destination === undefined) {
        throw new Error('The reference link must include its destination')
      }
      loadedReferences.add(yield* fs.realPath(nodePath.resolve(consumerDirectory, destination)))
    }
    for (const path of skillPaths.slice(1)) {
      const installedReference = yield* fs.realPath(
        nodePath.resolve(consumerDirectory, loadedSkill.packageRoot, path),
      )
      equal(
        loadedReferences.has(installedReference),
        true,
        `Intent must resolve the shipped ${path} reference`,
      )
    }
    for (const compiler of compilerCases) {
      yield* runTypeScript(consumerDirectory, compiler, 'tsconfig.json', false)
      yield* runTypeScript(consumerDirectory, compiler, 'tsconfig.openapi.json', false)
      yield* runTypeScript(consumerDirectory, compiler, 'tsconfig.tanstack-start.json', false)
      yield* runTypeScript(consumerDirectory, compiler, 'tsconfig.svelte-angular.json', false)
      yield* runTypeScript(consumerDirectory, compiler, 'tsconfig.vue-solid.json', false)
      if (peer.queryCoreVersion !== testedVersion('@tanstack/query-core')) {
        yield* runTypeScript(consumerDirectory, compiler, 'tsconfig.contract-baseline.json', false)
        yield* runTypeScript(consumerDirectory, compiler, 'tsconfig.rpc-baseline.json', false)
        yield* runTypeScript(consumerDirectory, compiler, 'tsconfig.http-baseline.json', false)
      }
    }
    if (peer.queryCoreVersion === testedVersion('@tanstack/query-core')) {
      yield* runCommand(
        process.execPath,
        [nodePath.join(repositoryRoot, 'scripts/measure-packed-consumer.mts'), consumerDirectory],
        { stdio: 'inherit' },
      )
      const baseline: unknown = JSON.parse(
        yield* fs.readFileString(nodePath.join(consumerDirectory, 'packed-baseline.json')),
      )
      baselines.push(baseline)
    }
    for (const fixture of [
      'owner-cache-runtime.mts',
      'start-ssr-runtime.mts',
      'optimistic-runtime.mts',
      'events-runtime.mts',
      'websocket-runtime.mts',
      'hashing-runtime.mts',
      'filter-runtime.mts',
      'runtime.mts',
      'http-runtime.mts',
      'openapi-runtime.mts',
      'http-metadata-runtime.mts',
      'http-etag-recipe.mts',
      'http-stream-runtime.mts',
      'http-live-runtime.mts',
      'stream-cause-runtime.mts',
      'stream-policy-runtime.mts',
      'retry-runtime.mts',
      'snapshot-runtime.mts',
      'defaults-runtime.mts',
      'hydration-runtime.mts',
      'hydration-views-runtime.mts',
    ]) {
      yield* runCommand(process.execPath, ['--experimental-import-meta-resolve', fixture], {
        cwd: consumerDirectory,
        stdio: 'inherit',
      })
    }
    yield* runCommand(
      process.execPath,
      [
        nodePath.join(repositoryRoot, 'scripts', 'verify-svelte-angular-consumer.mts'),
        consumerDirectory,
      ],
      { cwd: repositoryRoot, stdio: 'inherit' },
    )
    yield* runCommand(
      process.execPath,
      [
        nodePath.join(repositoryRoot, 'scripts', 'verify-vue-solid-consumer.mts'),
        consumerDirectory,
      ],
      { cwd: repositoryRoot, stdio: 'inherit' },
    )
  }, Effect.scoped)
  for (const peer of peerCases) {
    yield* verifyConsumer(peer)
  }
  equal(yield* artifactDigest(), initialDigest, 'The tested release archive must remain unchanged')
  const baselineReport = {
    package: `${packedManifest.name}@${packedManifest.version}`,
    sha512: initialDigest,
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
    peers: { effect: testedVersion('effect'), queryCore: testedVersion('@tanstack/query-core') },
    measurements: baselines,
  }
  const baselinePath = Option.getOrUndefined(
    yield* Config.String('EFFECT_API_QUERY_BASELINE')
      .pipe(Config.option)
      .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
  )
  if (baselinePath !== undefined) {
    yield* fs.writeFileString(
      nodePath.resolve(repositoryRoot, baselinePath),
      `${JSON.stringify(baselineReport, null, 2)}\n`,
    )
  }
  console.log(
    JSON.stringify(
      {
        package: `${packedManifest.name}@${packedManifest.version}`,
        tarball: tarballPath,
        sha512: initialDigest,
        files: packedFiles,
        compilers: compilerCases.map((compiler) => compiler.label),
        peers: peerCases,
        baseline: baselineReport,
      },
      null,
      2,
    ),
  )
})
NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
