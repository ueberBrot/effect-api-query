import { strict as effectStrict } from "@effect/tsgo/oxlint-presets";
import { ConfigProvider, Effect, Predicate } from "effect";
import ultraciteOxfmt from "ultracite/oxfmt";
import ultraciteAntiSlop from "ultracite/oxlint/anti-slop";
import ultraciteCore from "ultracite/oxlint/core";
import ultraciteReact from "ultracite/oxlint/react";
import ultraciteShadcn from "ultracite/oxlint/shadcn";
import ultraciteTanstack from "ultracite/oxlint/tanstack";
import ultraciteVitest from "ultracite/oxlint/vitest";
import { defineConfig } from "vite-plus";
import type { OxlintConfig } from "vite-plus/lint";

const ignoredPaths = [
  ".agents/**",
  ".artifacts/**",
  ".fallow/**",
  ".vite/**",
  ".vitest/**",
  "apps/docs/.astro/**",
  "apps/docs/dist/**",
  "coverage/**",
  "dist/**",
  "examples/tanstack-start/src/routeTree.gen.ts",
  "node_modules/**",
  "playwright-report/**",
  "test-results/**",
];

const testFiles = ["tests/**/*.test.ts", "examples/**/*.test.{ts,tsx}"];
const effectTestBlocks = [
  "it.effect",
  "it.live",
  "it.scoped",
  "it.scopedLive",
  "it.effect.each",
  "it.live.each",
];
const applicationBuildTasks = ["vite-react-build", "tanstack-start-build"];
const importSorting = Predicate.isBoolean(ultraciteOxfmt.sortImports)
  ? {}
  : (ultraciteOxfmt.sortImports ?? {});

const vitestPreset: OxlintConfig = {
  ...ultraciteVitest,
  overrides: (ultraciteVitest.overrides ?? []).map((override) => ({
    ...override,
    files: testFiles,
    rules: {
      ...override.rules,
      "vitest/expect-expect": [
        "error",
        { additionalTestBlockFunctions: effectTestBlocks },
      ],
      "vitest/no-standalone-expect": [
        "error",
        {
          additionalTestBlockFunctions: effectTestBlocks,
        },
      ],
      "vitest/prefer-strict-boolean-matchers": "error",
      "vitest/prefer-to-be-truthy": "off",
      "vitest/prefer-to-be-falsy": "off",
    },
  })),
};

export default defineConfig({
  fmt: {
    ...ultraciteOxfmt,
    ignorePatterns: [...(ultraciteOxfmt.ignorePatterns ?? []), ...ignoredPaths],
    sortImports: {
      ...importSorting,
      customGroups: [
        ...(importSorting.customGroups ?? []),
        {
          groupName: "effect-api-query",
          elementNamePattern: ["#effect-api-query", "#effect-api-query/**"],
        },
      ],
      groups: [
        "builtin",
        "external",
        "effect-api-query",
        ["internal", "subpath"],
        ["parent", "sibling", "index"],
        "style",
        "unknown",
      ],
    },
  },
  lint: {
    extends: [
      ultraciteCore,
      ultraciteTanstack,
      ultraciteAntiSlop,
      effectStrict,
      vitestPreset,
    ],
    jsPlugins: [...ultraciteAntiSlop.jsPlugins, ...ultraciteShadcn.jsPlugins],
    settings: {
      shadcn: {
        componentImports: ["(?:^|/)components/"],
      },
    },
    ignorePatterns: [
      ...(ultraciteCore.ignorePatterns ?? []),
      ...ignoredPaths,
      "tests/types/**",
      "apps/docs/**/*.astro",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "effecttsgo/any-unknown-in-error-context": "error",
      "effecttsgo/unsafe-effect-type-assertion": "error",
    },
    overrides: [
      {
        files: ["scripts/resolve-docs-release.mts"],
        rules: {
          "anti-slop/no-runtime-typeof": "off",
        },
      },
      {
        files: [
          "src/**/*.ts",
          "examples/**/src/**/*.{ts,tsx}",
          "examples/shared/**/*.ts",
          "scripts/**/*.mts",
        ],
        rules: {
          "eslint/require-await": "off",
          "typescript/require-await": "error",
          "typescript/return-await": [
            "error",
            "error-handling-correctness-only",
          ],
        },
      },
      {
        files: [
          "examples/contracts/src/client.ts",
          "examples/server/src/**/*.ts",
          "scripts/measure-construction.mts",
        ],
        rules: {
          "eslint/func-names": ["error", "always", { generators: "never" }],
        },
      },
      {
        files: [
          "src/core/operation.ts",
          "src/core/utility-tree.ts",
          "src/core/metadata-query.ts",
        ],
        rules: {
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-unknown-returns": "off",
          "anti-slop/no-unsafe-dictionary-type": "off",
        },
      },
      {
        files: ["src/core/inference.ts"],
        rules: { "anti-slop/no-unknown-returns": "off" },
      },
      {
        files: [
          "src/core/types.ts",
          "src/core/inference.ts",
          "src/http/types.ts",
          "src/rpc/types.ts",
        ],
        rules: { "typescript/no-invalid-void-type": "off" },
      },
      {
        files: ["src/http/types.ts", "src/rpc/types.ts"],
        rules: { "typescript/no-redundant-type-constituents": "off" },
      },
      {
        files: ["src/core/types.ts", "src/http/types.ts"],
        rules: {
          "typescript/consistent-type-definitions": "off",
          "typescript/no-unnecessary-type-parameters": "off",
        },
      },
      {
        ...ultraciteReact,
        files: ["examples/**/*.{ts,tsx}"],
      },
      {
        files: ["examples/**/*.{ts,tsx}"],
        rules: ultraciteShadcn.rules ?? {},
      },
      {
        files: ["examples/**/components/ui/**/*.{ts,tsx}"],
        excludeFiles: [
          "examples/vite-react/src/components/ui/action-button.tsx",
          "examples/vite-react/src/components/ui/effect-error-details.tsx",
        ],
        rules: {
          "shadcn/no-arbitrary-values": "off",
          "shadcn/no-restyle": "off",
          "shadcn/require-static-classes": "off",
        },
      },
      {
        files: [
          "examples/contracts/src/client.ts",
          "examples/contracts/src/contracts.ts",
          "examples/contracts/src/http-api.ts",
          "examples/server/src/http-handlers.ts",
          "examples/server/src/main.ts",
          "examples/server/src/server-local-rpc.ts",
          "examples/server/src/server.ts",
          "examples/server/src/web-handler.ts",
          "examples/server/tests/fixtures/websocket-server.ts",
          "examples/server/tests/http-api.test.ts",
          "examples/server/tests/rpc-transport-overhead.test.ts",
          "examples/server/tests/rpc-websocket-consumer.test.ts",
          "examples/server/tests/server.test.ts",
          "examples/server/tests/web-handler.test.ts",
          "examples/tanstack-start/src/lib/application.ts",
          "examples/tanstack-start/tests/server-render.test.tsx",
          "examples/vite-react/src/lib/application.ts",
          "scripts/measure-construction.mts",
          "src/http/create-utils.ts",
          "src/http/operation.ts",
          "src/http/request.ts",
          "src/http/streamed-query.ts",
          "src/http/types.ts",
          "src/rpc/create-utils.ts",
          "src/rpc/operation.ts",
          "src/rpc/types.ts",
          "tests/cache-recipes.test.ts",
          "tests/contract-reuse.test.ts",
          "tests/create-http-api-query-utils.test.ts",
          "tests/create-rpc-query-utils-configuration.test.ts",
          "tests/create-rpc-query-utils-execution.test.ts",
          "tests/create-rpc-query-utils-keys.test.ts",
          "tests/create-rpc-query-utils-request-options.test.ts",
          "tests/create-rpc-query-utils-server-local.test.ts",
          "tests/create-rpc-query-utils-stream-baseline.test.ts",
          "tests/create-rpc-query-utils-stream-cache.test.ts",
          "tests/create-rpc-query-utils-stream-hashing.test.ts",
          "tests/create-rpc-query-utils-stream-publication.test.ts",
          "tests/create-rpc-query-utils-streaming.test.ts",
          "tests/create-rpc-query-utils.test.ts",
          "tests/execution-interceptor.test.ts",
          "tests/fixtures/docs-websocket-use.ts",
          "tests/fixtures/effect-rpc.ts",
          "tests/fixtures/http-client.ts",
          "tests/fixtures/optimistic-users.ts",
          "tests/fixtures/rpc-transport-queries.ts",
          "tests/fixtures/socket-client.ts",
          "tests/fixtures/user-events.ts",
          "tests/fixtures/websocket-checks.ts",
          "tests/http-cached-views.test.ts",
          "tests/http-execution.test.ts",
          "tests/http-hydration.test.ts",
          "tests/http-live-query.test.ts",
          "tests/http-metadata-options.test.ts",
          "tests/http-multipart.test.ts",
          "tests/http-query-options.test.ts",
          "tests/http-semantic-keys.test.ts",
          "tests/http-transport-cancellation.test.ts",
          "tests/hydration-codecs.test.ts",
          "tests/query-filter.test.ts",
          "tests/query-usability.test.ts",
          "tests/skills/query-usability/fixture.ts",
          "tests/skills/query-usability/grade.test.ts",
          "tests/query-policy.test.ts",
          "tests/query-view-prefix.test.ts",
          "tests/stream-publication.test.ts",
          "tests/stream-recovery.test.ts",
          "tests/stream-snapshot.test.ts",
        ],
        rules: { "effecttsgo/unstable-api-usage": "off" },
      },
      {
        files: ["src/http/errors.ts", "src/rpc/errors.ts"],
        rules: { "eslint/max-classes-per-file": ["error", 4] },
      },
      {
        files: ["tests/create-rpc-query-utils-configuration.test.ts"],
        rules: { "eslint/max-classes-per-file": ["error", 2] },
      },
      {
        files: ["tests/create-rpc-query-utils-server-local.test.ts"],
        rules: { "eslint/max-classes-per-file": ["error", 3] },
      },
      {
        files: ["tests/http-execution.test.ts"],
        rules: { "eslint/max-classes-per-file": ["error", 4] },
      },
    ],
  },
  check: {
    fmt: true,
    lint: true,
  },
  test: {
    fileParallelism: true,
    include: [
      "examples/**/*.test.ts",
      "examples/**/*.test.tsx",
      "tests/**/*.test.ts",
    ],
    passWithNoTests: true,
  },
  pack: {
    attw: {
      level: "error",
      profile: "esm-only",
    },
    clean: true,
    deps: {
      neverBundle: ["effect", "@tanstack/query-core"],
      onlyImport: ["effect", "@tanstack/query-core"],
    },
    dts: true,
    entry: ["src/index.ts"],
    format: ["esm"],
    publint: {
      level: "error",
      strict: true,
    },
    sourcemap: true,
    target: "es2022",
    unused: {
      ignore: {
        dependencies: ["effect"],
      },
      level: "error",
    },
  },
  run: {
    tasks: {
      check: {
        command: "vp check",
        dependsOn: ["pack", "docs-sync"],
        cache: {
          output: [],
        },
      },
      format: {
        command: "vp fmt --check",
        cache: {
          output: [],
        },
      },
      lint: {
        command: "vp lint",
        dependsOn: ["pack", "docs-sync"],
        cache: {
          output: [],
        },
      },
      typecheck: {
        command: "vp check --no-fmt",
        dependsOn: ["pack", "docs-sync"],
        cache: {
          output: [],
        },
      },
      "effect-check": {
        command: "effect-tsgo diagnostics --project tsconfig.json --strict",
        dependsOn: ["pack"],
        cache: {
          output: [],
        },
      },
      pack: {
        command: "vp pack",
        cache: {
          input: [{ auto: true }, "!dist/**"],
          output: ["dist/**"],
        },
      },
      "skills-check": {
        command: "intent validate skills --check",
        cache: false,
      },
      fallow: {
        command: [
          "fallow dead-code --no-cache --include-entry-exports",
          "fallow dead-code --no-cache --production",
          "fallow dupes --no-cache",
          "fallow health --no-cache --hotspots --file-scores --min-score 75",
        ],
        cache: false,
      },
      test: {
        command: "vp test",
        dependsOn: ["pack", "api-types", "server-local-types"],
        cache: {
          env: ["RPC_TRANSPORT_MEASURE", "STREAM_MEASURE"],
          output: [],
        },
      },
      "construction-baseline": {
        command: "tsx scripts/measure-construction.mts",
        cache: false,
      },
      "api-types": {
        command: [
          "tsc --project tests/types/tsconfig.json",
          "node node_modules/typescript-5.9/bin/tsc --project tests/types/tsconfig.json",
        ],
        dependsOn: ["pack"],
        cache: { output: [] },
      },
      "server-local-types": {
        command: [
          "tsc --project tests/fixtures/tsconfig.server-local.json",
          "node node_modules/typescript-5.9/bin/tsc --project tests/fixtures/tsconfig.server-local.json",
        ],
        cache: {
          output: [],
        },
      },
      e2e: {
        command: "playwright test",
        cache: false,
        dependsOn: applicationBuildTasks,
      },
      "e2e:chromium": {
        command: "playwright test --project=chromium",
        cache: false,
        dependsOn: applicationBuildTasks,
      },
      "e2e:firefox": {
        command: "playwright test --project=firefox",
        cache: false,
        dependsOn: applicationBuildTasks,
      },
      "e2e:webkit": {
        command: "playwright test --project=webkit",
        cache: false,
        dependsOn: applicationBuildTasks,
      },
      quality: {
        command: [
          "vp run check",
          "vp run effect-check",
          "vp run fallow",
          "vp run test",
        ],
      },
      server: {
        command: "vp run --filter @effect-api-query/server dev",
        cache: false,
      },
      "vite-react-dev": {
        command:
          "vp run --parallel --log labeled --filter @effect-api-query/server --filter @effect-api-query/vite-react dev",
        cache: false,
        dependsOn: ["pack"],
      },
      "vite-react-build": {
        command: "vp run --filter @effect-api-query/vite-react build",
        dependsOn: ["pack"],
        cache: {
          input: [{ auto: true }, "!examples/vite-react/dist/**"],
          output: ["examples/vite-react/dist/**"],
        },
      },
      "vite-react-preview": {
        command: "vp -C examples/vite-react preview",
        cache: false,
        dependsOn: ["vite-react-build"],
      },
      "tanstack-start-dev": {
        command: "vp run --filter @effect-api-query/tanstack-start dev",
        cache: false,
        dependsOn: ["pack"],
      },
      "tanstack-start-build": {
        command: "vp run --filter @effect-api-query/tanstack-start build",
        dependsOn: ["pack"],
        cache: {
          input: [{ auto: true }, "!examples/tanstack-start/dist/**"],
          output: ["examples/tanstack-start/dist/**"],
        },
      },
      docs: {
        command: "vp run --filter @effect-api-query/docs dev",
        cache: false,
      },
      "docs-sync": {
        // Root typed linting includes docs files that import Astro's generated modules.
        command: "vp -C apps/docs exec astro sync",
        cache: {
          output: ["apps/docs/.astro/**"],
        },
      },
      "docs-build": {
        command: "vp run --filter @effect-api-query/docs build",
        dependsOn: ["docs-check"],
        cache: {
          input: [{ auto: true }, "!apps/docs/dist/**"],
          output: ["apps/docs/dist/**"],
        },
      },
      "docs-check": {
        command: [
          "vp test -- tests/docs-examples.test.ts",
          "vp run --filter @effect-api-query/docs check",
        ],
        cache: {
          output: [],
        },
      },
      "docs-e2e": {
        command: "playwright test --config playwright.docs.config.ts",
        cache: false,
        dependsOn:
          Effect.runSync(
            ConfigProvider.fromEnv({ preserveEmptyStrings: true }).load([
              "DOCS_BASE_URL",
            ])
          )?.value === undefined
            ? ["docs-build"]
            : [],
      },
      "docs-preview": {
        command: "vp run --filter @effect-api-query/docs preview",
        cache: false,
        dependsOn: ["docs-build"],
      },
      "tanstack-start-preview": {
        command: "vp -C examples/tanstack-start preview",
        cache: false,
        dependsOn: ["tanstack-start-build"],
      },
      validate: {
        command: [
          "vp run quality",
          "vp run skills-check",
          "vp run vite-react-build",
          "vp run tanstack-start-build",
          "vp run docs-build",
          "vp run docs-e2e",
          "vp run e2e",
        ],
      },
    },
  },
  staged: {
    "*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}": [
      "vp fmt",
      () => "vp run --no-cache typecheck --fix",
    ],
    "*.{json,jsonc,md,yaml,yml}": "vp fmt",
  },
});
