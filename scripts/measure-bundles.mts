import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { Effect } from "effect";
import viteManifest from "vite/package.json" with { type: "json" };
import { rolldown, VERSION } from "vite/rolldown";

import manifest from "../package.json" with { type: "json" };
import { currentCompiler } from "./compiler.mts";
import { assertBudget, bundleBudgets } from "./performance/budgets.mts";
import {
  packageName,
  prepareConsumer,
  repositoryRoot,
  writeReport,
} from "./performance/common.mts";

const consumers = {
  rpc: {
    imports: 'import { Rpc, RpcGroup } from "effect/rpc";',
    declaration:
      'const contract = RpcGroup.make(Rpc.make("read", { payload: { id: Schema.Int }, success: Value }));',
    factory: "createRpcQueryUtils",
    usage: "utils.read.queryOptions({ input: { id: 1 } })",
    native:
      '({ queryKey: ["bundle-baseline", "rpc", "read", "query", { id: 1 }], queryFn: ({ signal }) => Effect.runPromise(client("read", { id: 1 }), { signal }) })',
  },
  http: {
    imports:
      'import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";',
    declaration:
      'const contract = HttpApi.make("bundle-baseline").add(HttpApiGroup.make("users").add(HttpApiEndpoint.get("read", "/:id", { params: { id: Schema.Int }, success: Value })));',
    factory: "createHttpApiQueryUtils",
    usage: "utils.users.read.queryOptions({ input: { params: { id: 1 } } })",
    native:
      '({ queryKey: ["bundle-baseline", "http", "bundle-baseline", "users", "read", { params: { id: 1 } }], queryFn: ({ signal }) => Effect.runPromise(client.users.read({ params: { id: 1 } }), { signal }) })',
  },
  streamed: {
    imports: 'import { Rpc, RpcGroup } from "effect/rpc";',
    declaration:
      'const contract = RpcGroup.make(Rpc.make("watch", { success: Value, stream: true }));',
    factory: "createRpcQueryUtils",
    usage: 'utils.watch.streamedOptions({ maxChunks: "unbounded" })',
    native:
      '({ queryKey: ["bundle-baseline", "rpc", "watch", "streamed"], queryFn: streamedQuery({ streamFn: () => Stream.toAsyncIterable(client("watch", {})) }) })',
  },
  hydration: {
    imports: 'import { Rpc, RpcGroup } from "effect/rpc";',
    declaration:
      'const contract = RpcGroup.make(Rpc.make("read", { success: Value }));',
    factory: "createRpcQueryUtils",
    usage:
      '({ registry: createHydrationRegistry([queryViewCodec(utils.read, "query", Value)]), dehydrate, hydrate })',
    native: "({ dehydrate, hydrate })",
  },
} as const;

const artifacts = path.join(repositoryRoot, ".artifacts", "performance");
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(path.join(artifacts, "bundles-"));
const context = prepareConsumer(directory);
const measurements: {
  consumer: string;
  peers: string;
  baseline: { minifiedBytes: number; gzipBytes: number };
  adapter: { minifiedBytes: number; gzipBytes: number };
  difference: { minifiedBytes: number; gzipBytes: number };
  retained: readonly {
    variant: string;
    modules: readonly { id: string; renderedBytes: number }[];
  }[];
}[] = [];
try {
  await Effect.runPromise(
    Effect.gen(function* measureBundles() {
      for (const name of ["rpc", "http", "streamed", "hydration"] as const) {
        const consumer = consumers[name];
        for (const externalPeers of [false, true]) {
          const sizes = [];
          const retained: {
            variant: string;
            modules: { id: string; renderedBytes: number }[];
          }[] = [];
          for (const utilities of [false, true]) {
            const entry = path.join(directory, "consumer.mjs");
            writeFileSync(
              entry,
              `import { Effect, Schema, Stream } from "effect";\nimport { QueryClient, experimental_streamedQuery as streamedQuery, dehydrate, hydrate } from "@tanstack/query-core";\n${consumer.imports}\n${utilities ? `import { ${consumer.factory}${name === "hydration" ? ", createHydrationRegistry, queryViewCodec" : ""} } from "${packageName}";` : ""}\nconst Value = Schema.Struct({ id: Schema.Int, label: Schema.String });\n${consumer.declaration}\nexport { contract };\nexport const create = client => {\nconst queryClient = new QueryClient();\n${utilities ? `const utils = ${consumer.factory}(contract, { client, keyPrefix: ["bundle-baseline"] });\nreturn { queryClient, options: ${consumer.usage} };` : `return { queryClient, options: ${consumer.native} };`}\n};\n`
            );
            sizes.push(
              yield* Effect.promise(async () => {
                const bundle = await rolldown({
                  input: entry,
                  platform: "browser",
                  external: externalPeers
                    ? ["effect", /^effect\//u, "@tanstack/query-core"]
                    : [],
                  treeshake: true,
                  logLevel: "silent",
                  transform: {
                    target: "es2022",
                    define: { "process.env.NODE_ENV": '"production"' },
                  },
                });
                try {
                  const result = await bundle.generate({
                    format: "esm",
                    minify: true,
                  });
                  retained.push({
                    variant: utilities ? "adapter" : "native",
                    modules: result.output.flatMap((output) =>
                      output.type === "chunk"
                        ? Object.entries(output.modules)
                            .filter(([, module]) => module.renderedLength > 0)
                            .map(([id, module]) => ({
                              id: path.relative(repositoryRoot, id),
                              renderedBytes: module.renderedLength,
                            }))
                        : []
                    ),
                  });
                  const code = result.output
                    .filter((output) => output.type === "chunk")
                    .map((output) => output.code)
                    .join("\n");
                  return {
                    minifiedBytes: Buffer.byteLength(code),
                    gzipBytes: gzipSync(code).byteLength,
                    optionalDiagnosticMarkers: {
                      owner: code.includes("Query owner is retired"),
                      descriptor: code.includes("Query descriptor rejected"),
                      effectCache: code.includes(
                        "QueryClient operation failed"
                      ),
                      sharing: code.includes("Schema sharing requires acyclic"),
                    },
                  };
                } finally {
                  await bundle.close();
                }
              })
            );
          }
          const [baseline, adapter] = sizes;
          if (baseline === undefined || adapter === undefined) {
            throw new Error("Both bundle variants must complete");
          }
          const budget =
            bundleBudgets[name][externalPeers ? "external" : "included"];
          assertBudget(
            `${name} minified delta`,
            adapter.minifiedBytes - baseline.minifiedBytes,
            budget[0]
          );
          assertBudget(
            `${name} gzip delta`,
            adapter.gzipBytes - baseline.gzipBytes,
            budget[1]
          );
          measurements.push({
            consumer: name,
            retained,
            peers: externalPeers ? "external" : "included",
            baseline,
            adapter,
            difference: {
              minifiedBytes: adapter.minifiedBytes - baseline.minifiedBytes,
              gzipBytes: adapter.gzipBytes - baseline.gzipBytes,
            },
          });
        }
      }
    })
  );
  writeReport({
    context: { ...context, rolldown: VERSION },
    workload: {
      target: "browser ESM, ES2022",
      minified: true,
      consumerSource: "built public package exports",
      baseline:
        "same exported contract, ready client and QueryClient with native options; hydration baseline uses native JSON data only",
      comparisonLimits:
        "Successful decoded scalar/object workloads only. Native stream helper has no adapter cleanup/error/key guarantees; hydration registry adds schema codecs. Deltas measure retained capability cost, not runtime equivalence or optimization gains.",
      compiler: currentCompiler,
      vite: {
        importedAs: "vite",
        package: viteManifest.name,
        version: viteManifest.version,
      },
      packageVersion: manifest.version,
      compression: "gzip per generated consumer",
    },
    measurements,
  });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
