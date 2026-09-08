import { listIntentSkills, loadIntentSkill } from '@tanstack/intent/core'
// fallow-ignore-file unused-file
// Vite+ invokes this verifier through its dynamically declared packed-package task.
import { deepStrictEqual, equal, match } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import repositoryManifest from '../package.json' with { type: 'json' }

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactDirectory = join(repositoryRoot, '.artifacts')
const consumerFixtureDirectory = join(repositoryRoot, 'tests', 'packed-consumer')
const lockfilePath = join(repositoryRoot, 'pnpm-lock.yaml')
const typeFixtureDirectory = join(repositoryRoot, 'tests', 'types')
const workspaceConfigPath = join(repositoryRoot, 'pnpm-workspace.yaml')
const workspaceConfig = readFileSync(workspaceConfigPath, 'utf8')
const defaultTarballName = `${repositoryManifest.name.replace(/^@/, '').replaceAll('/', '-')}-${repositoryManifest.version}.tgz`
const tarballPath = resolve(
  repositoryRoot,
  process.env['EFFECT_API_QUERY_TARBALL'] ?? join(artifactDirectory, defaultTarballName),
)

if (!existsSync(tarballPath)) {
  throw new Error(`Packed tarball does not exist: ${tarballPath}`)
}

const artifactDigest = () => createHash('sha512').update(readFileSync(tarballPath)).digest('hex')
const initialDigest = artifactDigest()

const packedManifest = JSON.parse(
  execFileSync('tar', ['-xOzf', tarballPath, 'package/package.json'], { encoding: 'utf8' }),
) as typeof repositoryManifest

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
  if (specifier !== 'catalog:') return specifier

  const escapedDependency = dependency.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const catalogVersion = new RegExp(
    `^  ['"]?${escapedDependency}['"]?: (?<version>\\S+)$`,
    'mu',
  ).exec(workspaceConfig)?.groups?.['version']
  if (catalogVersion === undefined) {
    throw new Error(`The default catalog must define ${dependency}`)
  }
  return catalogVersion
}

const lockedVersions = (dependency: string): ReadonlyArray<string> => {
  const escapedDependency = dependency.replaceAll('/', '\\/')
  const matches = readFileSync(lockfilePath, 'utf8').matchAll(
    new RegExp(`^  ['"]?${escapedDependency}@(?<version>[^('":]+)`, 'gmu'),
  )
  return [...new Set(Array.from(matches, (match) => match.groups?.['version']))]
    .filter((version): version is string => version !== undefined)
    .sort()
}

const vitestOverride = /^  vitest: (?<version>\S+)$/mu.exec(workspaceConfig)?.groups?.['version']
if (vitestOverride === undefined) {
  throw new Error('The workspace must pin one Vitest override')
}

deepStrictEqual(lockedVersions('effect'), [testedVersion('effect')])
deepStrictEqual(lockedVersions('vitest'), [vitestOverride])

deepStrictEqual(packedManifest.exports, {
  '.': {
    types: './dist/index.d.mts',
    import: './dist/index.mjs',
  },
})
equal('engines' in packedManifest, false)

const publicBarrel = readFileSync(join(repositoryRoot, 'src', 'index.ts'), 'utf8')
equal(
  /\bexport\s+(?:type\s+)?\*/u.test(publicBarrel),
  false,
  'The public barrel must use named exports',
)

const builtModule = execFileSync('tar', ['-xOzf', tarballPath, 'package/dist/index.mjs'], {
  encoding: 'utf8',
})
match(builtModule, /from ["']@tanstack\/query-core["']/u)
match(builtModule, /from ["']effect(?:\/unstable\/rpc)?["']/u)
equal(/\bnode:/u.test(builtModule), false, 'The runtime must not import Node APIs')
for (const imported of builtModule.matchAll(/\bfrom\s*["'](?<specifier>[^"']+)["']/gu)) {
  equal(
    builtinModules.includes(imported.groups?.['specifier'] ?? ''),
    false,
    'The runtime must not import bare Node built-ins',
  )
}
const sourceMap = JSON.parse(
  execFileSync('tar', ['-xOzf', tarballPath, 'package/dist/index.mjs.map'], {
    encoding: 'utf8',
  }),
) as { sources: Array<string> }
equal(
  sourceMap.sources.some((source) => source.includes('node_modules/')),
  false,
  'The runtime must not bundle private copies of dependencies',
)

const builtDeclaration = execFileSync('tar', ['-xOzf', tarballPath, 'package/dist/index.d.mts'], {
  encoding: 'utf8',
})
const declarationExport = /export \{ (?<names>[^}]+) \};/u.exec(builtDeclaration)?.groups?.['names']
if (declarationExport === undefined) {
  throw new Error('The declaration entry has no root export statement')
}
const declarationNames = declarationExport
  .split(',')
  .map((name) => name.trim().replace(/^type /u, ''))
  .sort()
deepStrictEqual(declarationNames, [
  'CreateHttpApiQueryUtilsOptions',
  'CreateRpcQueryUtilsOptions',
  'EffectHttpApiQueryConfigError',
  'EffectHttpApiQueryConfigErrorCode',
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
  'StreamingRpcOptions',
  'UnaryRpcOptions',
  'createHttpApiQueryUtils',
  'createRpcQueryUtils',
  'isEffectHttpApiQueryError',
  'isEffectRpcQueryError',
  'skipToken',
])

const queryCoreCompatibilityCases = () => {
  const supportedPeerRange = '>=5.102.0 <6'
  deepStrictEqual(packedManifest.peerDependencies, {
    '@tanstack/query-core': supportedPeerRange,
    effect: testedVersion('effect'),
  })

  const range = /^>=(?<minimum>\d+\.\d+\.\d+) <(?<nextMajor>\d+)$/u.exec(supportedPeerRange)?.groups
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

const packedFiles = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .sort()
const skillPaths = [
  'skills/effect-api-query/SKILL.md',
  'skills/effect-api-query/references/http.md',
  'skills/effect-api-query/references/query-patterns.md',
  'skills/effect-api-query/references/rpc.md',
]
const skillExamples: Array<string> = []
for (const path of ['LICENSE', ...skillPaths]) {
  const packedContent = execFileSync('tar', ['-xOzf', tarballPath, `package/${path}`], {
    encoding: 'utf8',
  })
  equal(
    packedContent,
    readFileSync(join(repositoryRoot, path), 'utf8'),
    `The packed ${path} must match the candidate`,
  )
  for (const sample of packedContent.matchAll(/^```ts\n([\s\S]*?)^```/gmu)) {
    if (sample[1] !== undefined) skillExamples.push(sample[1])
  }
}
equal(skillExamples.length > 0, true, 'The packed usage skill must have compilable examples')
equal(packedManifest.keywords.includes('tanstack-intent'), true)
const changelogPath = join(repositoryRoot, 'CHANGELOG.md')
const hasChangelog = existsSync(changelogPath)
if (repositoryManifest.version !== '0.0.0') {
  equal(hasChangelog, true, 'A versioned release must include its changelog')
}
if (hasChangelog) {
  equal(
    execFileSync('tar', ['-xOzf', tarballPath, 'package/CHANGELOG.md'], { encoding: 'utf8' }),
    readFileSync(changelogPath, 'utf8'),
    'The packed changelog must match the candidate',
  )
}
deepStrictEqual(packedFiles, [
  ...(hasChangelog ? ['package/CHANGELOG.md'] : []),
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
    executable: join(repositoryRoot, 'node_modules', 'typescript-5.9', 'bin', 'tsc'),
    label: 'typescript-5.9',
  },
  {
    executable: join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    label: 'typescript-current',
  },
] as const

const peerCases = queryCoreCompatibilityCases()

const runTypeScript = (
  consumerDirectory: string,
  compiler: (typeof compilerCases)[number],
  project: 'tsconfig.json' | 'tsconfig.tanstack-start.json' | 'tsconfig.type-scale.json',
  extendedDiagnostics: boolean,
): void => {
  console.log(`Verifying ${project} with ${compiler.label}`)
  execFileSync(
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
}

const verifyConsumer = (peer: (typeof peerCases)[number]): void => {
  const consumerDirectory = mkdtempSync(join(tmpdir(), `effect-api-query-${peer.label}-`))

  try {
    cpSync(consumerFixtureDirectory, consumerDirectory, { recursive: true })
    for (const fixture of [
      'public-contract.ts',
      'tanstack-start-contract.ts',
      'http-contract.ts',
      'type-scale.ts',
      'http-type-scale.ts',
      'docs-rpc-quick-start.ts',
      'docs-http-quick-start.ts',
    ]) {
      cpSync(join(typeFixtureDirectory, fixture), join(consumerDirectory, fixture))
    }

    const consumerManifest = {
      name: `effect-api-query-packed-consumer-${peer.label}`,
      private: true,
      type: 'module',
      intent: { skills: ['effect-api-query'] },
      dependencies: {
        '@tanstack/query-core': peer.queryCoreVersion,
        '@tanstack/react-query': peer.reactQueryVersion,
        '@tanstack/react-router': testedVersion('@tanstack/react-router'),
        '@tanstack/react-router-ssr-query': testedVersion('@tanstack/react-router-ssr-query'),
        '@tanstack/react-start': testedVersion('@tanstack/react-start'),
        '@types/node': testedVersion('@types/node'),
        '@types/react': testedVersion('@types/react'),
        '@types/react-dom': testedVersion('@types/react-dom'),
        effect: testedVersion('effect'),
        'effect-api-query': `file:${tarballPath}`,
        react: testedVersion('react'),
        'react-dom': testedVersion('react-dom'),
      },
    }
    writeFileSync(
      join(consumerDirectory, 'package.json'),
      JSON.stringify(consumerManifest, null, 2),
    )
    for (const [index, source] of skillExamples.entries()) {
      writeFileSync(join(consumerDirectory, `skill-example-${index}.ts`), source)
    }

    // Prefer cached artifacts, but allow a fresh machine to fetch exact pinned versions.
    // The temporary project must resolve every peer from its own node_modules.
    execFileSync('pnpm', ['install', '--ignore-scripts', '--prefer-offline'], {
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
      readFileSync(resolve(consumerDirectory, loadedSkill.path), 'utf8'),
      readFileSync(join(repositoryRoot, 'skills/effect-api-query/SKILL.md'), 'utf8'),
      'Intent must load the shipped skill from the installed package',
    )
    // Intent can emit paths relative to the consumer or absolute paths when the
    // package resolves outside it (for example through a symlinked temp directory).
    const loadedReferences = Array.from(
      loadedSkill.content.matchAll(/\]\((?<destination>[^)\n]+\.md)\)/gu),
      (link) => realpathSync(resolve(consumerDirectory, link.groups!['destination']!)),
    )
    for (const path of skillPaths.slice(1)) {
      const installedReference = realpathSync(
        resolve(consumerDirectory, loadedSkill.packageRoot, path),
      )
      equal(
        loadedReferences.includes(installedReference),
        true,
        `Intent must resolve the shipped ${path} reference`,
      )
    }

    for (const compiler of compilerCases) {
      runTypeScript(consumerDirectory, compiler, 'tsconfig.json', false)
      runTypeScript(consumerDirectory, compiler, 'tsconfig.tanstack-start.json', false)
      runTypeScript(
        consumerDirectory,
        compiler,
        'tsconfig.type-scale.json',
        peer.queryCoreVersion === testedVersion('@tanstack/query-core') &&
          compiler.label === 'typescript-current',
      )
    }

    for (const fixture of ['runtime.mts', 'http-runtime.mts']) {
      execFileSync(process.execPath, ['--experimental-import-meta-resolve', fixture], {
        cwd: consumerDirectory,
        stdio: 'inherit',
      })
    }
  } finally {
    rmSync(consumerDirectory, { force: true, recursive: true })
  }
}

for (const peer of peerCases) {
  verifyConsumer(peer)
}

equal(artifactDigest(), initialDigest, 'The tested release archive must remain unchanged')
console.log(
  JSON.stringify(
    {
      package: `${packedManifest.name}@${packedManifest.version}`,
      tarball: tarballPath,
      sha512: initialDigest,
      files: packedFiles,
      compilers: compilerCases.map((compiler) => compiler.label),
      peers: peerCases,
    },
    null,
    2,
  ),
)
