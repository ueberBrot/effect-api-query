import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { Effect } from "effect";
import { rolldown, VERSION } from "vite/rolldown";

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
  },
  http: {
    imports:
      'import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";',
    declaration:
      'const contract = HttpApi.make("bundle-baseline").add(HttpApiGroup.make("users").add(HttpApiEndpoint.get("read", "/:id", { params: { id: Schema.Int }, success: Value })));',
    factory: "createHttpApiQueryUtils",
    usage: "utils.users.read.queryOptions({ input: { params: { id: 1 } } })",
  },
  streamed: {
    imports: 'import { Rpc, RpcGroup } from "effect/rpc";',
    declaration:
      'const contract = RpcGroup.make(Rpc.make("watch", { success: Value, stream: true }));',
    factory: "createRpcQueryUtils",
    usage:
      "utils.watch.streamedOptions({ maxChunks: 32, publicationBatchSize: 32, publicationMaxWaitMs: 16 })",
  },
  hydration: {
    imports: 'import { Rpc, RpcGroup } from "effect/rpc";',
    declaration:
      'const contract = RpcGroup.make(Rpc.make("read", { success: Value }));',
    factory: "createRpcQueryUtils",
    usage:
      'createHydrationRegistry([queryViewCodec(utils.read, "query", Value)])',
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
}[] = [];
try {
  await Effect.runPromise(
    Effect.gen(function* measureBundles() {
      for (const [name, consumer] of Object.entries(consumers)) {
        for (const externalPeers of [false, true]) {
          const sizes = [];
          for (const utilities of [false, true]) {
            const entry = path.join(directory, "consumer.mjs");
            writeFileSync(
              entry,
              `import { Schema } from "effect";\nimport { QueryClient } from "@tanstack/query-core";\n${consumer.imports}\n${utilities ? `import { ${consumer.factory}${name === "hydration" ? ", createHydrationRegistry, queryViewCodec" : ""} } from "${packageName}";` : ""}\nconst Value = Schema.Struct({ id: Schema.Int, label: Schema.String });\n${consumer.declaration}\nexport const create = client => {\nconst queryClient = new QueryClient();\n${utilities ? `const utils = ${consumer.factory}(contract, { client, keyPrefix: ["bundle-baseline"] });\nreturn { queryClient, options: ${consumer.usage} };` : "return { queryClient, contract, client };"}\n};\n`
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
                  const code = result.output
                    .filter((output) => output.type === "chunk")
                    .map((output) => output.code)
                    .join("\n");
                  return {
                    minifiedBytes: Buffer.byteLength(code),
                    gzipBytes: gzipSync(code).byteLength,
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
          measurements.push({
            consumer: name,
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
      baseline: "same contract and QueryClient without utility construction",
      compression: "gzip per generated consumer",
    },
    measurements,
  });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
