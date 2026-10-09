import { strict as effectStrict } from '@effect/tsgo/oxlint-presets'
import ultraciteAntiSlop from 'ultracite/oxlint/anti-slop'
import ultraciteCore from 'ultracite/oxlint/core'
import ultraciteReact from 'ultracite/oxlint/react'
import ultraciteShadcn from 'ultracite/oxlint/shadcn'
import ultraciteTanstack from 'ultracite/oxlint/tanstack'
import ultraciteVitest from 'ultracite/oxlint/vitest'
import { defineConfig } from 'vite-plus'
import type { OxlintConfig } from 'vite-plus/lint'

const ignoredPaths = [
  '.agents/**',
  '.artifacts/**',
  '.fallow/**',
  '.vite/**',
  '.vitest/**',
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

const testFiles = ['tests/**/*.test.ts', 'examples/**/*.test.{ts,tsx}']
const effectTestBlocks = ['it.effect', 'it.live', 'it.scoped', 'it.scopedLive']

const vitestPreset: OxlintConfig = {
  ...ultraciteVitest,
  overrides: (ultraciteVitest.overrides ?? []).map((override) => ({
    ...override,
    files: testFiles,
    rules: {
      ...override.rules,
      'vitest/expect-expect': ['error', { additionalTestBlockFunctions: effectTestBlocks }],
      'vitest/no-standalone-expect': [
        'error',
        { additionalTestBlockFunctions: [...effectTestBlocks, 'it.effect.each', 'it.live.each'] },
      ],
      // Exact booleans catch values that truthiness-only assertions would accept.
      'vitest/prefer-strict-boolean-matchers': 'error',
      'vitest/prefer-to-be-truthy': 'off',
      'vitest/prefer-to-be-falsy': 'off',
      // Integration tests assert several states of one operation and its cleanup.
      'vitest/max-expects': ['error', { max: 50 }],
    },
  })),
}

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
    extends: [ultraciteCore, ultraciteTanstack, ultraciteAntiSlop, effectStrict, vitestPreset],
    jsPlugins: [...(ultraciteAntiSlop.jsPlugins ?? []), ...(ultraciteShadcn.jsPlugins ?? [])],
    settings: {
      shadcn: {
        // Start keeps its custom primitives in components/, without components.json.
        componentImports: ['(?:^|/)components/'],
      },
    },
    // Astro owns diagnostics for the docs package and uses its supported TypeScript 6 compiler.
    ignorePatterns: [
      ...(ultraciteCore.ignorePatterns ?? []),
      ...ignoredPaths,
      ...packedFixtures,
      'apps/docs/**',
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // Effect.fn supplies span names; its generator callbacks are anonymous.
      'eslint/func-names': ['error', 'as-needed', { generators: 'never' }],
      // The typed rule accepts async callbacks that forward an existing Promise.
      'eslint/require-await': 'off',
      'typescript/require-await': 'error',
      'typescript/return-await': ['error', 'error-handling-correctness-only'],
      // Effect/RPC functions require explicit undefined for void arguments.
      'unicorn/no-useless-undefined': ['error', { checkArguments: false }],
      // toSorted requires ES2023; this library and its consumers target ES2022.
      'unicorn/no-array-sort': 'off',
      // The patched engine adds defaults beyond the exported strict preset.
      'effecttsgo/any-unknown-in-error-context': 'error',
      'effecttsgo/experimental-api-usage': 'error',
      'effecttsgo/unsafe-effect-type-assertion': 'error',
      'effecttsgo/unstable-api-usage': 'error',
    },
    overrides: [
      {
        files: ['examples/**/*.{ts,tsx}'],
        ...ultraciteReact,
        rules: {
          ...ultraciteReact.rules,
          'react/function-component-definition': [
            'error',
            { namedComponents: 'arrow-function', unnamedComponents: 'arrow-function' },
          ],
          'react/hook-use-state': ['error', { allowDestructuredState: true }],
        },
      },
      {
        files: testFiles,
        rules: {
          // Context.Service fixtures belong with the tests exercising them.
          'eslint/max-classes-per-file': 'off',
        },
      },
      {
        files: ['examples/**/*.{ts,tsx}'],
        rules: ultraciteShadcn.rules ?? {},
      },
      {
        // shadcn installs primitives here; the custom example UI files stay checked.
        files: ['examples/**/components/ui/**/*.{ts,tsx}'],
        excludeFiles: [
          'examples/vite-react/src/components/ui/action-button.tsx',
          'examples/vite-react/src/components/ui/effect-error-details.tsx',
        ],
        rules: Object.fromEntries(
          Object.keys(ultraciteShadcn.rules ?? {}).map((rule) => [rule, 'off']),
        ),
      },
      {
        files: ['src/{http,rpc}/**/*.ts', 'tests/**/*.ts', 'examples/**/*.{ts,tsx}'],
        rules: {
          // Effect 4 transports are experimental and pinned; match the compiler policy.
          'effecttsgo/unstable-api-usage': 'off',
        },
      },
      {
        files: ['src/http/errors.ts', 'src/rpc/errors.ts'],
        rules: {
          // Each transport keeps its related tagged error family together.
          'eslint/max-classes-per-file': ['error', 4],
        },
      },
      {
        files: ['src/{core,http,rpc}/types.ts'],
        rules: {
          // void is part of Effect channel and no-payload RPC type contracts.
          'typescript/no-invalid-void-type': 'off',
          // Type aliases and interfaces differ in structural Record assignability;
          // preserve the published contract instead of enforcing one spelling.
          'typescript/consistent-type-definitions': 'off',
        },
      },
      {
        files: [
          'src/core/operation.ts',
          'src/core/schema-key.ts',
          'src/core/utility-tree.ts',
          'src/http/operation.ts',
          'src/http/request.ts',
          'src/rpc/operation.ts',
          'src/rpc/streamed-query.ts',
        ],
        rules: {
          // These runtime adapters erase caller-defined schemas/options, then validate
          // inputs with their declaration. A domain-specific replacement loses the
          // generic public contract, which the packed compile-time fixtures verify.
          'anti-slop/no-unknown-parameters': 'off',
          'anti-slop/no-unknown-returns': 'off',
          'anti-slop/no-unsafe-dictionary-type': 'off',
        },
      },
    ],
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
      onlyImport: ['effect', '@tanstack/query-core'],
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
        cache: {
          output: [],
        },
      },
      format: {
        command: 'vp fmt --check',
        cache: {
          output: [],
        },
      },
      lint: {
        command: 'vp lint',
        dependsOn: ['pack'],
        cache: {
          output: [],
        },
      },
      typecheck: {
        // Vite+ 1.0's --no-lint path reports typed rules without honoring suppressions.
        // Keep lint active so typechecking uses the same policy as the normal check.
        command: 'vp check --no-fmt',
        dependsOn: ['pack'],
        cache: {
          output: [],
        },
      },
      'effect-check': {
        command: 'effect-tsgo diagnostics --project tsconfig.json --strict',
        dependsOn: ['pack'],
        cache: {
          output: [],
        },
      },
      pack: {
        command: 'vp pack',
        cache: {
          input: [{ auto: true }, '!dist/**'],
          output: ['dist/**'],
        },
      },
      'packed-package': {
        command: [
          'vp pm pack --pack-destination .artifacts -- --config.ignore-scripts=true',
          'fallow dead-code --private-type-leaks --file dist/index.d.mts',
          'vp run verify-packed-package',
        ],
        dependsOn: ['pack', 'skills-check'],
        cache: {
          output: ['.artifacts/*.tgz'],
        },
      },
      'verify-packed-package': {
        command: 'node scripts/verify-packed-consumer.mts',
        cache: false,
      },
      'install-policy': {
        command: 'node scripts/verify-install-policy.mts',
        cache: false,
      },
      'skills-check': {
        command: 'intent validate skills --check',
        cache: {
          output: [],
        },
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
        dependsOn: ['pack', 'server-local-types'],
        cache: {
          output: [],
        },
      },
      'server-local-types': {
        command: [
          'tsc --project tests/fixtures/tsconfig.server-local.json',
          'node node_modules/typescript-5.9/bin/tsc --project tests/fixtures/tsconfig.server-local.json',
        ],
        cache: {
          env: ['RPC_TRANSPORT_MEASURE'],
          output: [],
        },
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
        command: [
          'vp run install-policy',
          'vp run check',
          'vp run effect-check',
          'vp run fallow',
          'vp run test',
        ],
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
        cache: {
          input: [{ auto: true }, '!examples/vite-react/dist/**'],
          output: ['examples/vite-react/dist/**'],
        },
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
        cache: {
          input: [{ auto: true }, '!examples/tanstack-start/dist/**'],
          output: ['examples/tanstack-start/dist/**'],
        },
      },
      docs: {
        command: 'vp run --filter @effect-api-query/docs dev',
        cache: false,
      },
      'docs-build': {
        command: 'vp run --filter @effect-api-query/docs build',
        dependsOn: ['docs-check'],
        cache: {
          input: [{ auto: true }, '!apps/docs/dist/**'],
          output: ['apps/docs/dist/**'],
        },
      },
      'docs-check': {
        command: [
          'node scripts/verify-docs-examples.mts',
          'vp run --filter @effect-api-query/docs check',
        ],
        cache: {
          output: [],
        },
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
    // Typed lint fixes need the full project context; formatting stays scoped to staged files.
    '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}': ['vp fmt', () => 'vp run --no-cache typecheck --fix'],
    '*.{json,jsonc,md,yaml,yml}': 'vp fmt',
  },
})
