import { defineConfig } from 'vite-plus'

const ignoredPaths = [
  '.agents/**',
  '.artifacts/**',
  '.fallow/**',
  '.vite/**',
  'apps/docs/.astro/**',
  'apps/docs/dist/**',
  'coverage/**',
  'dist/**',
  'examples/tanstack-start/src/routeTree.gen.ts',
  'node_modules/**',
  'playwright-report/**',
  'test-results/**',
]

// Packed fixtures resolve only the installed tarball from isolated temporary projects.
const packedFixtures = ['tests/packed-consumer/**', 'tests/types/**']

export default defineConfig({
  fmt: {
    ignorePatterns: ignoredPaths,
    overrides: [
      {
        files: ['*.jsonc', '**/*.jsonc'],
        options: {
          trailingComma: 'none',
        },
      },
    ],
    semi: false,
    singleQuote: true,
    sortImports: {
      customGroups: [
        {
          groupName: 'effect-api-query',
          elementNamePattern: ['#effect-api-query', '#effect-api-query/**'],
        },
      ],
      groups: [
        ['builtin', 'external'],
        'effect-api-query',
        ['parent', 'sibling', 'index'],
        ['side_effect_style', 'style'],
        'unknown',
      ],
      newlinesBetween: true,
    },
    sortTailwindcss: {
      stylesheet: './examples/vite-react/src/styles/tailwind.css',
    },
    sortPackageJson: true,
  },
  lint: {
    // Astro owns diagnostics for the docs package and uses its supported TypeScript 6 compiler.
    ignorePatterns: [...ignoredPaths, ...packedFixtures, 'apps/docs/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  check: {
    fmt: true,
    lint: true,
  },
  test: {
    fileParallelism: true,
    include: ['examples/**/*.test.ts', 'examples/**/*.test.tsx', 'tests/**/*.test.ts'],
    passWithNoTests: true,
  },
  pack: {
    attw: {
      level: 'error',
      profile: 'esm-only',
    },
    clean: true,
    deps: {
      neverBundle: ['effect', '@tanstack/query-core'],
    },
    dts: true,
    entry: ['src/index.ts'],
    format: ['esm'],
    publint: {
      level: 'error',
      strict: true,
    },
    sourcemap: true,
    target: 'es2022',
    unused: {
      ignore: {
        dependencies: ['effect'],
      },
      level: 'error',
    },
  },
  run: {
    tasks: {
      check: {
        command: 'vp check',
        dependsOn: ['pack'],
        output: [],
      },
      format: {
        command: 'vp fmt --check',
        output: [],
      },
      lint: {
        command: 'vp lint',
        dependsOn: ['pack'],
        output: [],
      },
      typecheck: {
        command: 'vp check --no-fmt --no-lint',
        dependsOn: ['pack'],
        output: [],
      },
      'effect-check': {
        command: 'effect-tsgo diagnostics --project tsconfig.json --strict',
        dependsOn: ['pack'],
        output: [],
      },
      pack: {
        command: 'vp pack',
        input: [{ auto: true }, '!dist/**'],
        output: ['dist/**'],
      },
      'packed-package': {
        command: [
          'vp pm pack --pack-destination .artifacts -- --config.ignore-scripts=true',
          'fallow dead-code --private-type-leaks --file dist/index.d.mts',
          'vp run verify-packed-package',
        ],
        dependsOn: ['pack'],
        output: ['.artifacts/*.tgz'],
      },
      'verify-packed-package': {
        command: 'node scripts/verify-packed-consumer.mts',
        cache: false,
      },
      fallow: {
        command: [
          // Public barrel exports must be exercised by repository evidence.
          'fallow dead-code --include-entry-exports',
          // Test-only reachability must not hide dead shipped internals.
          'fallow dead-code --production',
          'fallow dupes',
          'fallow health --hotspots --file-scores --min-score 75',
        ],
        cache: false,
      },
      test: {
        command: 'vp test',
        dependsOn: ['pack'],
        output: [],
      },
      e2e: {
        command: 'playwright test',
        cache: false,
      },
      'e2e:chromium': {
        command: 'playwright test --project=chromium',
        cache: false,
      },
      'e2e:firefox': {
        command: 'playwright test --project=firefox',
        cache: false,
      },
      'e2e:webkit': {
        command: 'playwright test --project=webkit',
        cache: false,
      },
      quality: {
        command: ['vp run check', 'vp run effect-check', 'vp run fallow', 'vp run test'],
      },
      server: {
        command: 'vp run --filter @effect-api-query/server dev',
        cache: false,
      },
      'vite-react-dev': {
        command:
          'vp run --parallel --log labeled --filter @effect-api-query/server --filter @effect-api-query/vite-react dev',
        cache: false,
        dependsOn: ['pack'],
      },
      'vite-react-build': {
        command: 'vp run --filter @effect-api-query/vite-react build',
        dependsOn: ['pack'],
        input: [{ auto: true }, '!examples/vite-react/dist/**'],
        output: ['examples/vite-react/dist/**'],
      },
      'vite-react-preview': {
        command: 'vp -C examples/vite-react preview',
        cache: false,
        dependsOn: ['vite-react-build'],
      },
      'tanstack-start-dev': {
        command: 'vp run --filter @effect-api-query/tanstack-start dev',
        cache: false,
        dependsOn: ['pack'],
      },
      'tanstack-start-build': {
        command: 'vp run --filter @effect-api-query/tanstack-start build',
        dependsOn: ['pack'],
        input: [{ auto: true }, '!examples/tanstack-start/dist/**'],
        output: ['examples/tanstack-start/dist/**'],
      },
      docs: {
        command: 'vp run --filter @effect-api-query/docs dev',
        cache: false,
      },
      'docs-build': {
        command: 'vp run --filter @effect-api-query/docs build',
        dependsOn: ['docs-check'],
        input: [{ auto: true }, '!apps/docs/dist/**'],
        output: ['apps/docs/dist/**'],
      },
      'docs-check': {
        command: [
          'node scripts/verify-docs-examples.mts',
          'vp run --filter @effect-api-query/docs check',
        ],
        output: [],
      },
      'docs-e2e': {
        command: 'playwright test --config playwright.docs.config.ts',
        cache: false,
      },
      'docs-preview': {
        command: 'vp run --filter @effect-api-query/docs preview',
        cache: false,
        dependsOn: ['docs-build'],
      },
      'tanstack-start-preview': {
        command: 'vp -C examples/tanstack-start preview',
        cache: false,
        dependsOn: ['tanstack-start-build'],
      },
      validate: {
        command: [
          'vp run quality',
          'vp run packed-package',
          'vp run vite-react-build',
          'vp run tanstack-start-build',
          'vp run docs-build',
          'vp run docs-e2e',
          'vp run e2e',
        ],
      },
    },
  },
  staged: {
    '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}': 'vp check --fix',
    '*.{json,jsonc,md,yaml,yml}': 'vp fmt',
  },
})
