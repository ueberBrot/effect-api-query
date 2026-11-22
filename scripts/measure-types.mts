import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Schema } from "effect";

import { compilerCommand, currentCompiler } from "./compiler.mts";
import { assertBudget, compilerBudgets } from "./performance/budgets.mts";
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
const httpClients =
  process.env["TYPE_HTTP_CLIENTS"] === undefined
    ? (["buffered"] as const)
    : choices("TYPE_HTTP_CLIENTS", [
        "buffered",
        "sse",
        "sse-overload",
        "sse-overload-typed-error",
      ]);
const compilers = [
  { name: "current", package: "@effect/tsgo" },
  { name: "minimum", package: "typescript-5.9" },
] as const;
const consumers = ["contract", "raw", "configured"] as const;
type Consumer = (typeof consumers)[number];
type HttpClient = (typeof httpClients)[number];
type Workload =
  | { adapter: "rpc" }
  | { adapter: "http"; httpClient: HttpClient };

const workloads = adapters.flatMap<Workload>((adapter) =>
  adapter === "rpc"
    ? [{ adapter }]
    : httpClients.map((httpClient) => ({ adapter, httpClient }))
);

const sseEndpoint = `const events = HttpApiEndpoint.get("events", "/events/:id", {
  params: { id: Schema.Int },
  success: HttpApiSchema.StreamSse({ data: Schema.Int }),
});`;
const sseOverload = (
  error: string
) => `type StandardClient = HttpApiClient.ForApi<typeof contract, ${error}>;
declare const client: StandardClient & {
  readonly scale: {
    readonly events: (request: {
      readonly params: { readonly id: number };
      readonly responseMode: "decoded-only";
      readonly sseOptions: {
        readonly maxEventSize: number;
        readonly dispatchEmptyNamedEvents: boolean;
      };
    }) => Effect.Effect<
      Stream.Stream<number, "stream-error", "stream-service">,
      "acquisition-error",
      "acquisition-service"
    >;
  };
};`;
const standardHttpClient =
  "declare const client: HttpApiClient.ForApi<typeof contract>;";
const httpClientDeclarations = {
  buffered: standardHttpClient,
  sse: standardHttpClient,
  "sse-overload": sseOverload("never"),
  "sse-overload-typed-error": sseOverload('"client-error"'),
} satisfies Record<HttpClient, string>;
const useSse = `export const stream = utils.scale.events.streamedOptions({
  input: { params: { id: 1 } },
  maxChunks: 3,
});`;
const checkOverload = `type Failure = InferQueryError<typeof utils.scale.events, "streamed">;
type Payload<T> = T extends EffectHttpApiQueryError<infer E> ? E : never;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type OverloadErrors = "acquisition-error" | "stream-error";
true satisfies Equal<Extract<Payload<Failure>, OverloadErrors>, OverloadErrors>;
type Runner = CreateHttpApiQueryUtilsOptions<
  typeof contract, readonly ["type-baseline"], typeof client
>["runtime"];
declare const expectedRunner: Runner;
expectedRunner satisfies RuntimeInput<"acquisition-service" | "stream-service">;`;

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

const contractFixture = (workload: Workload, count: number) => {
  if (workload.adapter === "rpc") {
    const operations = Array.from(
      { length: count },
      (_, index) =>
        `Rpc.make("scale.read-${index}", { payload: { id: Schema.Int }, success: Value }),`
    );
    return `const contract = RpcGroup.make(\n${operations.join("\n")}\n);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof contract>>;`;
  }
  const operations = Array.from(
    { length: count },
    (_, index) => `endpoint("read-${index}"),`
  );
  const sse = workload.httpClient !== "buffered";
  if (sse) {
    operations.push("events,");
  }
  return `const endpoint = <const Name extends string>(name: Name) => HttpApiEndpoint.get(name, "/:id", { params: { id: Schema.Int }, success: Value });
${sse ? sseEndpoint : ""}
const contract = HttpApi.make("type-baseline").add(HttpApiGroup.make("scale").add(\n${operations.join("\n")}\n));
${httpClientDeclarations[workload.httpClient]}`;
};

const fixture = (workload: Workload, count: number, consumer: Consumer) => {
  const { adapter } = workload;
  const sse = workload.adapter === "http" && workload.httpClient !== "buffered";
  const overloaded =
    workload.adapter === "http" &&
    workload.httpClient.startsWith("sse-overload");
  const utilities = consumer !== "contract";
  const configured = consumer === "configured";
  const last = count - 1;
  const factory =
    adapter === "rpc" ? "createRpcQueryUtils" : "createHttpApiQueryUtils";
  const imports = `import { Schema${overloaded ? ", type Effect, type Stream" : ""} } from "effect";\n${
    adapter === "rpc"
      ? 'import { Rpc, RpcGroup, type RpcClient } from "effect/rpc";'
      : `import { HttpApi, HttpApiEndpoint, HttpApiGroup, type HttpApiClient${sse ? ", HttpApiSchema" : ""} } from "effect/http-api";`
  }\n${utilities ? `import { QueryClient } from "@tanstack/query-core";\nimport { ${factory}${configured ? ", configureUtils" : ""}${overloaded ? ", type CreateHttpApiQueryUtilsOptions, type EffectHttpApiQueryError, type InferQueryError, type RunPromiseExit, type RuntimeInput" : ""} } from "${packageName}";` : ""}`;
  const success =
    "const Value = Schema.Struct({ id: Schema.Int, label: Schema.String });";
  const contract = contractFixture(workload, count);
  const configuration = configured
    ? `const utils = configureUtils(raw, { query: { policy: { retry: false } }, scoped: { scale: { scoped: { "read-${last}": { query: { policy: { staleTime: 1000 }, interceptors: [async ({ next }) => { const value = await next(); value.label satisfies string; return value; }] } } } } } });\n`
    : "";
  const runner = overloaded
    ? 'declare const runtime: RunPromiseExit<"acquisition-service" | "stream-service">;\n'
    : "";
  const use = utilities
    ? `${runner}const ${configured ? "raw" : "utils"} = ${factory}(contract, { client, keyPrefix: ["type-baseline"]${overloaded ? ", runtime" : ""} });
${configuration}const options = utils.scale["read-${last}"].queryOptions({ input: ${adapter === "rpc" ? "{ id: 1 }" : "{ params: { id: 1 } }"}, select: value => value.label });
const cached = new QueryClient().getQueryData(options.queryKey);
const id: number | undefined = cached?.id;
export { options, id };
${sse ? useSse : ""}
${overloaded ? checkOverload : ""}`
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
  engine: string;
  engineVersion: string;
  package: string;
  languageVersion: string;
  adapter: Workload["adapter"];
  httpClient?: HttpClient;
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
    for (const workload of workloads) {
      for (const count of counts) {
        for (const consumer of consumers) {
          const source = path.join(directory, "consumer.ts");
          writeFileSync(source, fixture(workload, count, consumer));
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
              ...compilerCommand(repositoryRoot, compiler.name),
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
            package: compiler.package,
            engineVersion:
              compiler.name === "current"
                ? currentCompiler.engineVersion
                : packageVersion(compiler.package),
            engine:
              compiler.name === "current"
                ? currentCompiler.engine
                : "typescript",
            languageVersion:
              compiler.name === "current"
                ? currentCompiler.languageVersion
                : "5.9.3",
            ...workload,
            operations:
              count +
              (workload.adapter === "http" && workload.httpClient !== "buffered"
                ? 1
                : 0),
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
      workloads,
      consumers,
      declarationSource: "built public package exports",
      compilation:
        "fresh compiler process, one literal contract, final buffered leaf and any SSE leaf consumed",
      skipLibCheck: true,
      samples: 1,
    },
    measurements,
  });
  for (const measurement of measurements) {
    const adapter =
      measurement.httpClient === undefined ||
      measurement.httpClient === "buffered"
        ? measurement.adapter
        : measurement.httpClient;
    const key = `${measurement.compiler}/${adapter}/${measurement.operations}/${measurement.consumer}`;
    const budget = compilerBudgets.get(key);
    if (budget !== undefined) {
      assertBudget(key, measurement.diagnostics.instantiations, budget);
    }
  }
  const failures = measurements.filter((entry) => entry.exitCode !== 0);
  if (failures.length > 0) {
    process.exitCode = 1;
    for (const failure of failures) {
      console.error(
        `${failure.compiler} ${failure.httpClient ?? failure.adapter} ${failure.operations} ${failure.consumer}: compilation failed\n${failure.errors.slice(0, 3).join("\n")}`
      );
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
