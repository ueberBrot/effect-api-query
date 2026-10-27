import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Schema } from "effect";

import {
  choices,
  packageName,
  packageVersion,
  prepareConsumer,
  positiveIntegers,
  repositoryRoot,
  writeReport,
} from "./performance/common.mts";

const counts = positiveIntegers("TYPE_COUNTS", [50, 250, 1000]);
const selectedCompilers = choices("TYPE_COMPILERS", ["current", "minimum"]);
const adapters = choices("TYPE_ADAPTERS", ["rpc", "http"]);
const compilers = [
  { name: "current", package: "typescript" },
  { name: "minimum", package: "typescript-5.9" },
] as const;
const consumers = ["contract", "raw", "configured"] as const;
type Consumer = (typeof consumers)[number];

interface CompilerDiagnostics {
  readonly files: number;
  readonly identifiers: number;
  readonly symbols: number;
  readonly types: number;
  readonly instantiations: number;
  readonly memoryBytes: number;
  readonly checkMilliseconds: number;
  readonly totalMilliseconds: number;
}
const parseDiagnostics = (output: string): CompilerDiagnostics => {
  const diagnostics = new Map<string, string>();
  for (const line of output.split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      diagnostics.set(
        line.slice(0, separator),
        line.slice(separator + 1).trim()
      );
    }
  }
  const metric = (name: string, unit = "") =>
    Schema.decodeUnknownSync(Schema.FiniteFromString)(
      diagnostics.get(name)?.replace(unit, "")
    );
  return {
    files: metric("Files"),
    identifiers: metric("Identifiers"),
    symbols: metric("Symbols"),
    types: metric("Types"),
    instantiations: metric("Instantiations"),
    memoryBytes: metric("Memory used", "K") * 1024,
    checkMilliseconds: metric("Check time", "s") * 1000,
    totalMilliseconds: metric("Total time", "s") * 1000,
  };
};
const fixture = (
  adapter: "rpc" | "http",
  count: number,
  consumer: Consumer
) => {
  const utilities = consumer !== "contract";
  const configured = consumer === "configured";
  const last = count - 1;
  const imports = `import { Schema } from "effect";\n${
    adapter === "rpc"
      ? 'import { Rpc, RpcGroup, type RpcClient } from "effect/rpc";'
      : 'import { HttpApi, HttpApiEndpoint, HttpApiGroup, type HttpApiClient } from "effect/http-api";'
  }\n${utilities ? `import { QueryClient } from "@tanstack/query-core";\nimport { ${adapter === "rpc" ? "createRpcQueryUtils" : "createHttpApiQueryUtils"}${configured ? ", configureUtils" : ""} } from "${packageName}";` : ""}`;
  const success =
    "const Value = Schema.Struct({ id: Schema.Int, label: Schema.String });";
  const contract =
    adapter === "rpc"
      ? `const contract = RpcGroup.make(\n${Array.from({ length: count }, (_, index) => `Rpc.make("scale.read-${index}", { payload: { id: Schema.Int }, success: Value }),`).join("\n")}\n);\ndeclare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof contract>>;`
      : `const endpoint = <const Name extends string>(name: Name) => HttpApiEndpoint.get(name, "/:id", { params: { id: Schema.Int }, success: Value });\nconst contract = HttpApi.make("type-baseline").add(HttpApiGroup.make("scale").add(\n${Array.from({ length: count }, (_, index) => `endpoint("read-${index}"),`).join("\n")}\n));\ndeclare const client: HttpApiClient.ForApi<typeof contract>;`;
  const configuration = configured
    ? `const utils = configureUtils(raw, { query: { policy: { retry: false } }, scoped: { scale: { scoped: { "read-${last}": { query: { policy: { staleTime: 1000 }, interceptors: [async ({ next }) => { const value = await next(); value.label satisfies string; return value; }] } } } } } });\n`
    : "";
  const use = utilities
    ? `const ${configured ? "raw" : "utils"} = ${adapter === "rpc" ? "createRpcQueryUtils" : "createHttpApiQueryUtils"}(contract, { client, keyPrefix: ["type-baseline"] });\n${configuration}const options = utils.scale["read-${last}"].queryOptions({ input: ${adapter === "rpc" ? "{ id: 1 }" : "{ params: { id: 1 } }"}, select: value => value.label });\nconst cached = new QueryClient().getQueryData(options.queryKey);\nconst id: number | undefined = cached?.id;\nexport { options, id };`
    : `const operation = ${adapter === "rpc" ? `client("scale.read-${last}", { id: 1 })` : `client.scale["read-${last}"]({ params: { id: 1 } })`};\nexport { contract, operation };`;
  return `${imports}\n${success}\n${contract}\n${use}\n`;
};

const artifacts = path.join(repositoryRoot, ".artifacts", "performance");
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(path.join(artifacts, "types-"));
const context = prepareConsumer(directory);
const measurements: {
  compiler: string;
  version: string;
  adapter: string;
  operations: number;
  utilities: boolean;
  consumer: Consumer;
  exitCode: number;
  errors: readonly string[];
  wallMilliseconds: number;
  diagnostics: CompilerDiagnostics;
}[] = [];
try {
  for (const compiler of compilers.filter((entry) =>
    selectedCompilers.includes(entry.name)
  )) {
    for (const adapter of adapters) {
      for (const count of counts) {
        for (const consumer of consumers) {
          const source = path.join(directory, "consumer.ts");
          writeFileSync(source, fixture(adapter, count, consumer));
          const config = path.join(directory, "tsconfig.json");
          writeFileSync(
            config,
            JSON.stringify({
              compilerOptions: {
                target: "ES2022",
                lib: ["ES2022", "DOM", "DOM.Iterable"],
                module: "ESNext",
                moduleResolution: "Bundler",
                strict: true,
                exactOptionalPropertyTypes: true,
                noUncheckedIndexedAccess: true,
                skipLibCheck: true,
                noEmit: true,
                types: [],
              },
              files: [source],
            })
          );
          const started = performance.now();
          const compilation = spawnSync(
            process.execPath,
            [
              path.join(
                repositoryRoot,
                "node_modules",
                compiler.package,
                "bin",
                "tsc"
              ),
              "--project",
              config,
              "--extendedDiagnostics",
              "--pretty",
              "false",
            ],
            {
              cwd: repositoryRoot,
              encoding: "utf-8",
              maxBuffer: 8 * 1024 * 1024,
            }
          );
          if (compilation.error !== undefined) {
            throw compilation.error;
          }
          if (compilation.status === null) {
            throw new Error(
              `The compiler terminated with ${compilation.signal}`
            );
          }
          const output = compilation.stdout;
          measurements.push({
            compiler: compiler.name,
            version: packageVersion(compiler.package),
            adapter,
            operations: count,
            utilities: consumer !== "contract",
            consumer,
            exitCode: compilation.status,
            errors: output
              .split("\n")
              .filter((line) => line.includes("error TS")),
            wallMilliseconds: performance.now() - started,
            diagnostics: parseDiagnostics(output),
          });
        }
      }
    }
  }
  writeReport({
    context,
    workload: {
      counts,
      consumers,
      declarationSource: "built public package exports",
      compilation:
        "fresh compiler process, one literal contract, raw or scoped-configured final leaf consumed",
      skipLibCheck: true,
      samples: 1,
    },
    measurements,
  });
  const failures = measurements.filter((entry) => entry.exitCode !== 0);
  if (failures.length > 0) {
    process.exitCode = 1;
    for (const failure of failures) {
      console.error(
        `${failure.compiler} ${failure.adapter} ${failure.operations} ${failure.consumer}: compilation failed\n${failure.errors.slice(0, 3).join("\n")}`
      );
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
