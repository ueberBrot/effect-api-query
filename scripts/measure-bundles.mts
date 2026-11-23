import { ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import viteManifest from "vite/package.json" with { type: "json" };
import { rolldown, VERSION } from "vite/rolldown";

import manifest from "../package.json" with { type: "json" };
import { currentCompiler } from "./compiler.mts";
import { capture, run } from "./lib/exec.mts";
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
    usage: 'utils.watch.streamedOptions({ maxChunks: "unbounded" })',
  },
  hydration: {
    imports: 'import { Rpc, RpcGroup } from "effect/rpc";',
    declaration:
      'const contract = RpcGroup.make(Rpc.make("read", { success: Value }));',
    factory: "createRpcQueryUtils",
    usage:
      '({ registry: createHydrationRegistry([queryViewCodec(utils.read, "query", Value)]), dehydrate, hydrate })',
  },
} as const;

const artifacts = path.join(repositoryRoot, ".artifacts", "performance");
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(path.join(artifacts, "bundles-"));
const measure = async (
  entry: string,
  consumer: (typeof consumers)[keyof typeof consumers],
  externalPeers: boolean
) => {
  const imports =
    consumer.factory +
    (consumer === consumers.hydration
      ? ", createHydrationRegistry, queryViewCodec"
      : "");
  writeFileSync(
    entry,
    `import { Schema } from "effect";
import { QueryClient, dehydrate, hydrate } from "@tanstack/query-core";
${consumer.imports}
import { ${imports} } from "${packageName}";
const Value = Schema.Struct({ id: Schema.Int, label: Schema.String });
${consumer.declaration}
export { contract };
export const create = client => {
  const queryClient = new QueryClient();
  const utils = ${consumer.factory}(contract, { client, keyPrefix: ["bundle-baseline"] });
  return { queryClient, options: ${consumer.usage} };
};
`
  );
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
    const result = await bundle.generate({ format: "esm", minify: true });
    const code = result.output
      .filter((output) => output.type === "chunk")
      .map((output) => output.code)
      .join("\n");
    return {
      minifiedBytes: Buffer.byteLength(code),
      gzipBytes: gzipSync(code).byteLength,
      reactivityBridge:
        code.includes(".registerUnsafe(") || code.includes("effect/reactivity"),
    };
  } finally {
    await bundle.close();
  }
};

try {
  const mainRefs = capture(
    "git",
    [
      "for-each-ref",
      "--format=%(refname)",
      "refs/remotes/origin/main",
      "refs/heads/main",
    ],
    { cwd: repositoryRoot }
  )
    .trim()
    .split("\n");
  const mainRef = mainRefs.includes("refs/remotes/origin/main")
    ? "refs/remotes/origin/main"
    : "refs/heads/main";
  const mainRevision = capture("git", ["rev-parse", "--verify", mainRef], {
    cwd: repositoryRoot,
  }).trim();
  const mainSource = path.join(directory, "main-source");
  const archive = path.join(directory, "main.tar");
  mkdirSync(mainSource);
  run("git", ["archive", "--format=tar", "--output", archive, mainRevision], {
    cwd: repositoryRoot,
  });
  run("tar", ["-xf", archive, "-C", mainSource]);
  symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(mainSource, "node_modules"),
    "junction"
  );
  execFileSync("vp", ["pack"], {
    cwd: mainSource,
    stdio: ["ignore", process.stderr, "inherit"],
  });

  const currentDirectory = path.join(directory, "current");
  const mainDirectory = path.join(directory, "main");
  const context = prepareConsumer(currentDirectory);
  const mainPackage = path.join(mainDirectory, "node_modules", packageName);
  mkdirSync(mainPackage, { recursive: true });
  copyFileSync(
    path.join(mainSource, "package.json"),
    path.join(mainPackage, "package.json")
  );
  cpSync(path.join(mainSource, "dist"), path.join(mainPackage, "dist"), {
    recursive: true,
  });
  copyFileSync(
    path.join(currentDirectory, "package.json"),
    path.join(mainDirectory, "package.json")
  );

  const comparisons = await Promise.allSettled(
    Object.entries(consumers).flatMap(([name, consumer]) =>
      [false, true].map(async (externalPeers) => {
        const peers = externalPeers ? "external" : "included";
        const entry = `${name}-${peers}.mjs`;
        const main = await measure(
          path.join(mainDirectory, entry),
          consumer,
          externalPeers
        );
        const current = await measure(
          path.join(currentDirectory, entry),
          consumer,
          externalPeers
        );
        ok(
          !current.reactivityBridge,
          `${name} (${peers}) retained an unused Reactivity bridge`
        );
        return {
          consumer: name,
          peers,
          main: {
            minifiedBytes: main.minifiedBytes,
            gzipBytes: main.gzipBytes,
          },
          current: {
            minifiedBytes: current.minifiedBytes,
            gzipBytes: current.gzipBytes,
          },
          difference: {
            minifiedBytes: current.minifiedBytes - main.minifiedBytes,
            gzipBytes: current.gzipBytes - main.gzipBytes,
          },
        };
      })
    )
  );
  const measurements = comparisons.map((comparison) => {
    if (comparison.status === "rejected") {
      throw comparison.reason;
    }
    return comparison.value;
  });

  writeReport({
    context: { ...context, rolldown: VERSION },
    workload: {
      target: "browser ESM, ES2022",
      minified: true,
      consumerSource: "built public package exports",
      main: { ref: mainRef, revision: mainRevision },
      dependencies:
        "Both revisions use the current checkout's installed toolchain and peers.",
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
