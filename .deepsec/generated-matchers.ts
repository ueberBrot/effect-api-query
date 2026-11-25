import { compileDeclarativeMatchers, type DeepsecPlugin } from "deepsec/config";

const specs = [
  {
    version: 1,
    slug: "effect-http-workflow-registration",
    description:
      "Finds Effect HttpApi workflow endpoint declarations, handler group registration, and mounting in the shared HTTP router.",
    noiseTier: "normal",
    filePatterns: [
      "examples/contracts/src/workflows.ts",
      "examples/server/src/workflow-handlers.ts",
      "examples/server/src/web-handler.ts",
    ],
    patterns: [
      {
        source:
          "^\\s*HttpApiEndpoint\\.(?:get|post)\\(\\s*[\"'][a-z][A-Za-z]*[\"']\\s*,\\s*[\"']/workflows/(?:document|sse|ndjson|events|snapshot|upload|readings)[\"']\\s*,",
        label: "Effect HttpApi workflow endpoint",
      },
      {
        source:
          "^(?:const [a-z]+ = HttpApiBuilder\\.group\\(\\s*workflowsApi\\s*,|export const workflowRoutes = HttpApiBuilder\\.layer\\(workflowsApi\\))",
        label: "Effect HttpApi workflow handler registration",
      },
      {
        source:
          "^\\s*Layer\\.mergeAll\\(exampleHttpRoutes,\\s*workflowRoutes\\)\\.pipe\\(",
        label: "Workflow route layer mounted in the shared Effect HTTP router",
      },
    ],
    examples: [
      '      HttpApiEndpoint.get("events", "/workflows/events", {',
      'const uploads = HttpApiBuilder.group(workflowsApi, "uploads", (handlers) =>',
      "export const workflowRoutes = HttpApiBuilder.layer(workflowsApi).pipe(",
      "      Layer.mergeAll(exampleHttpRoutes, workflowRoutes).pipe(",
    ],
    closesSurfaceIds: ["example-http-workflows"],
  },
  {
    version: 1,
    slug: "effect-rpc-http-registration",
    description:
      "Finds Effect RPC contracts and handler registration for the shared HTTP transport and the TanStack Start POST route.",
    noiseTier: "normal",
    filePatterns: [
      "examples/contracts/src/contracts.ts",
      "examples/server/src/rpc-handlers.ts",
      "examples/server/src/web-handler.ts",
      "examples/tanstack-start/src/routes/rpc.ts",
    ],
    patterns: [
      {
        source:
          "^const [A-Za-z][A-Za-z0-9]* = Rpc\\.make\\(\\s*[\"'](?:commands|diagnostics|testing|users)\\.[A-Za-z][A-Za-z0-9]*[\"']\\s*,",
        label: "Effect RPC method declaration",
      },
      {
        source:
          "^(?:const handlersLayer = exampleRpcGroup\\.toLayer\\(|\\s*return exampleRpcGroup\\.of\\(\\{)",
        label: "Effect RPC handler registry",
      },
      {
        source:
          "^\\s*const rpcHttpEffect = yield\\* RpcServer\\.toHttpEffect\\(exampleRpcGroup\\)",
        label: "Effect RPC HTTP transport binding",
      },
      {
        source:
          "^\\s*POST:\\s*async\\s*\\(\\{\\s*request\\s*\\}\\)\\s*=>\\s*await handleApiRequest\\(request\\),\\s*$",
        label: "TanStack Start POST handler for the RPC route",
      },
    ],
    examples: [
      'const CommandsStart = Rpc.make("commands.start", {',
      "const handlersLayer = exampleRpcGroup.toLayer(",
      "    const rpcHttpEffect = yield* RpcServer.toHttpEffect(exampleRpcGroup).pipe(",
      "      POST: async ({ request }) => await handleApiRequest(request),",
    ],
    closesSurfaceIds: ["example-effect-rpc"],
  },
  {
    version: 1,
    slug: "effect-decoded-rpc-request-binding",
    description:
      "Finds Effect decoded-message RPC setup and its request-scoped client binding for server rendering.",
    noiseTier: "normal",
    filePatterns: [
      "examples/server/src/server-local-rpc.ts",
      "examples/server/src/web-handler.ts",
      "examples/tanstack-start/src/lib/server-application.ts",
    ],
    patterns: [
      {
        source:
          "^\\s*const (?:server|\\{ client, write \\}) = yield\\* Rpc(?:Server|Client)\\.makeNoSerialization\\(group,",
        label: "Effect decoded-message RPC server or client binding",
      },
      {
        source:
          "^\\s*return yield\\* makeServerLocalRpcClient\\(exampleRpcGroup\\)\\.pipe\\(",
        label: "Decoded-message RPC group bound to the server context",
      },
      {
        source:
          "^\\s*host\\.makeRpcClient\\(authorization\\)\\.pipe\\(Scope\\.provide\\(scope\\)\\)",
        label: "RPC client acquisition in the SSR request scope",
      },
    ],
    examples: [
      "  const server = yield* RpcServer.makeNoSerialization(group, {",
      "  const { client, write } = yield* RpcClient.makeNoSerialization(group, {",
      "        return yield* makeServerLocalRpcClient(exampleRpcGroup).pipe(",
      "      host.makeRpcClient(authorization).pipe(Scope.provide(scope))",
    ],
    closesSurfaceIds: ["example-server-local-rpc"],
  },
  {
    version: 1,
    slug: "tanstack-start-ssr-registration",
    description:
      "Finds TanStack Start page and router registration, the server-only request host, and TanStack Query SSR integration.",
    noiseTier: "normal",
    filePatterns: [
      "examples/tanstack-start/src/routes/*.tsx",
      "examples/tanstack-start/src/router.tsx",
      "examples/tanstack-start/src/lib/server-host.ts",
      "examples/tanstack-start/src/lib/query-ssr.ts",
    ],
    patterns: [
      {
        source:
          "^export const Route\\s*=\\s*createFileRoute\\([\"']/[a-z0-9-]*[\"']\\)\\(\\{",
        label: "TanStack Start page route registration",
      },
      {
        source:
          "^export const Route\\s*=\\s*createRootRouteWithContext<TanStackStartApplication>\\(\\)\\(\\{",
        label: "TanStack Router root registration with application context",
      },
      {
        source: "^\\s*const router\\s*=\\s*createRouter\\(\\{",
        label: "TanStack Router instance registration",
      },
      {
        source:
          "^\\s*\\.server\\(async \\(\\) => await startRequestApplication\\(getRequest\\(\\)\\)\\)",
        label: "TanStack Start server branch for request application setup",
      },
      {
        source: "^import [\"']@tanstack/react-start/server-only[\"'];\\s*$",
        label: "TanStack Start server-only request host boundary",
      },
      {
        source: "^\\s*setupRouterSsrQueryIntegration\\(\\{",
        label: "TanStack Router SSR query integration",
      },
    ],
    examples: [
      'export const Route = createFileRoute("/details")({',
      "export const Route = createRootRouteWithContext<TanStackStartApplication>()({",
      "  const router = createRouter({",
      "  .server(async () => await startRequestApplication(getRequest()))",
      'import "@tanstack/react-start/server-only";',
      "  setupRouterSsrQueryIntegration({",
    ],
    closesSurfaceIds: ["example-start-ssr"],
  },
  {
    version: 1,
    slug: "astro-package-version-get",
    description:
      "Finds the Astro GET export that serves the documentation site's static package version metadata.",
    noiseTier: "normal",
    filePatterns: ["apps/docs/src/pages/package-version.json.ts"],
    patterns: [
      {
        source: "^export const GET\\s*:\\s*APIRoute\\s*=",
        label: "Astro package-version GET registration",
      },
    ],
    examples: ["export const GET: APIRoute = () =>"],
    closesSurfaceIds: ["docs-version-metadata"],
  },
  {
    version: 1,
    slug: "vite-plus-repository-command-entrypoints",
    description:
      "Finds repository Vite+ task commands, Git hook dispatch, Node CLI entry points, and Changesets version dispatch.",
    noiseTier: "normal",
    filePatterns: [
      ".vite-hooks/pre-commit",
      ".vite-hooks/pre-push",
      "examples/server/src/main.ts",
      "scripts/check-effect-compatibility.mts",
      "scripts/check-framework-consumers.mts",
      "scripts/check-skills.sh",
      "scripts/check-workflow.mts",
      "scripts/measure-construction.mts",
      "scripts/resolve-docs-release.mts",
      "scripts/version-packages.mts",
      "vite.config.ts",
    ],
    patterns: [
      {
        source:
          '^\\s*command:\\s*"node --import tsx scripts/check-(?:workflow|toolchain|framework-consumers|effect-compatibility)\\.mts",\\s*$',
        label: "Vite+ validation task command",
      },
      {
        source:
          '^node --import tsx scripts/check-workflow\\.mts (?:--staged|--push "\\$@")\\s*$',
        label: "Git hook command for repository validation",
      },
      {
        source: "^NodeRuntime\\.runMain\\(",
        label: "Effect Node process entry point",
      },
      {
        source:
          "^const \\[mode,\\s*,\\s*remote\\]\\s*=\\s*process\\.argv\\.slice\\(2\\);\\s*$",
        label: "Repository validation CLI argument dispatch",
      },
      {
        source:
          '^const args\\s*=\\s*process\\.argv\\.slice\\(2\\)\\.filter\\(\\(arg\\) => arg !== "--"\\);\\s*$',
        label: "Framework consumer CLI argument parsing",
      },
      {
        source: "^const \\{ values \\}\\s*=\\s*parseArgs\\(\\{",
        label: "Node CLI options for the Effect compatibility matrix",
      },
      {
        source: "^vp run skills-check\\s*$",
        label: "Shipped skill validation command",
      },
      {
        source: "^if\\s*\\(import\\.meta\\.main\\)\\s*\\{",
        label: "Node direct-execution guard for documentation release tooling",
      },
      {
        source: '^run\\(\\["exec",\\s*"changeset",\\s*"version"\\]\\);\\s*$',
        label: "Changesets version command dispatch",
      },
    ],
    examples: [
      '        command: "node --import tsx scripts/check-effect-compatibility.mts",',
      'node --import tsx scripts/check-workflow.mts --push "$@"',
      "NodeRuntime.runMain(",
      "const [mode, , remote] = process.argv.slice(2);",
      'const args = process.argv.slice(2).filter((arg) => arg !== "--");',
      "const { values } = parseArgs({",
      "vp run skills-check",
      "if (import.meta.main) {",
      'run(["exec", "changeset", "version"]);',
    ],
    closesSurfaceIds: ["repository-cli"],
  },
  {
    version: 1,
    slug: "github-release-docs-job-binding",
    description:
      "Finds GitHub Actions release and Pages deployment bindings and the Node entry point that resolves and verifies the released documentation build.",
    noiseTier: "normal",
    filePatterns: [
      ".github/workflows/release.yml",
      ".github/workflows/deploy-docs.yml",
      "scripts/resolve-docs-release.mts",
    ],
    patterns: [
      {
        source: "^\\s*uses:\\s*\\./\\.github/workflows/deploy-docs\\.yml\\s*$",
        label: "Reusable documentation deployment workflow binding",
      },
      {
        source:
          "^\\s*uses:\\s*(?:changesets/action/(?:version|publish)|actions/deploy-pages)@[a-f0-9]{40}\\b",
        label:
          "Pinned GitHub Actions versioning, publication, or Pages deployment step",
      },
      {
        source:
          '^\\s*run:\\s*node\\s+(?:scripts/resolve-docs-release\\.mts|"\\$RUNNER_TEMP/documentation-verifier/resolve-docs-release\\.mts"\\s+verify-build)\\s*$',
        label:
          "GitHub Actions documentation resolver or build verifier invocation",
      },
      {
        source: "^if\\s*\\(import\\.meta\\.main\\)\\s*\\{",
        label:
          "Direct Node entry point for documentation resolution and verification",
      },
    ],
    examples: [
      "    uses: ./.github/workflows/deploy-docs.yml",
      "        uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5",
      "        run: node scripts/resolve-docs-release.mts",
      '        run: node "$RUNNER_TEMP/documentation-verifier/resolve-docs-release.mts" verify-build',
      "if (import.meta.main) {",
    ],
    closesSurfaceIds: ["release-and-docs-jobs"],
  },
];

export const generatedMatchersPlugin: DeepsecPlugin = {
  name: "deepsec-generated-matchers",
  matchers: compileDeclarativeMatchers(specs),
};
