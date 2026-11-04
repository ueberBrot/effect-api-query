import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { NodeRuntime } from "@effect/platform-node";
import { Clock, Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from "effect/http-api";
import { Rpc, RpcGroup, RpcTest } from "effect/rpc";

import {
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  prepareInput,
} from "#effect-api-query";

import { packageVersion } from "./performance/common.mts";

const Payload = Schema.Struct({
  id: Schema.Int,
  locale: Schema.String.pipe(
    Schema.withConstructorDefault(Effect.succeed("en"))
  ),
  rows: Schema.Array(Schema.Struct({ id: Schema.Int, title: Schema.String })),
});
const program = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const measurements: {
    adapter: string;
    stage: string;
    operations: number;
    records: number;
    iterations: number;
    milliseconds: number[];
  }[] = [];
  const measure = (
    adapter: string,
    stage: string,
    operations: number,
    records: number,
    iterations: number,
    operation: () => void
  ) => {
    for (let warmup = 0; warmup < 20; warmup += 1) {
      operation();
    }
    const milliseconds = Array.from({ length: 5 }, () => {
      const started = clock.monotonicTimeNanosUnsafe();
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        operation();
      }
      return Number(clock.monotonicTimeNanosUnsafe() - started) / 1_000_000;
    });
    measurements.push({
      adapter,
      stage,
      operations,
      records,
      iterations,
      milliseconds,
    });
  };
  for (const operationCount of [1, 250, 1000]) {
    const rpcs = Array.from({ length: operationCount }, (_, index) =>
      Rpc.make(`records.read-${index}`, {
        payload: Payload,
        success: Schema.Int,
      })
    );
    const group = RpcGroup.make(...rpcs);
    const rpcClient = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
      Effect.provide(
        group.toLayer(
          Object.fromEntries(
            rpcs.map((rpc) => [
              rpc._tag,
              (value: typeof Payload.Type) => Effect.succeed(value.id),
            ])
          )
        )
      )
    );
    const rpcFactory = () =>
      createRpcQueryUtils(group, {
        client: rpcClient,
        keyPrefix: ["construction"],
      });
    const endpoint = (index: number) =>
      HttpApiEndpoint.post(`read-${index}`, `/read-${index}`, {
        payload: Payload,
        success: Schema.Int,
      });
    const endpoints = [
      endpoint(0),
      ...Array.from({ length: operationCount - 1 }, (_, index) =>
        endpoint(index + 1)
      ),
    ] as const;
    const api = HttpApi.make("construction").add(
      HttpApiGroup.make("records").add(...endpoints)
    );
    const handlers: Record<
      `read-${number}`,
      (request: { payload: typeof Payload.Type }) => Effect.Effect<number>
    > = Object.fromEntries(
      endpoints.map((current) => [
        current.identifier,
        ({ payload }: { payload: typeof Payload.Type }) =>
          Effect.succeed(payload.id),
      ])
    );
    const httpClient = yield* HttpApiTest.groups(api, ["records"]).pipe(
      Effect.provide(
        Layer.mergeAll(
          HttpApiBuilder.group(api, "records", (builder) =>
            builder.handleAll(handlers)
          ),
          HttpServer.layerServices
        )
      )
    );
    const httpFactory = () =>
      createHttpApiQueryUtils(api, {
        client: httpClient,
        keyPrefix: ["construction"],
      });
    measure("rpc", "factory", operationCount, 0, 50, () => {
      rpcFactory();
    });
    measure("http", "factory", operationCount, 0, 50, () => {
      httpFactory();
    });
    const rpcTree = rpcFactory();
    const httpTree = httpFactory();
    const sparse = {
      scoped: {
        records: {
          scoped: {
            "read-0": { query: { policy: { staleTime: 30_000 } } },
          },
        },
      },
    };
    const denseScopes: Readonly<
      Record<
        `read-${number}`,
        { readonly query: { readonly policy: { readonly staleTime: number } } }
      >
    > = Object.fromEntries(
      Array.from({ length: operationCount }, (_, index) => [
        `read-${index}`,
        { query: { policy: { staleTime: index } } },
      ])
    );
    const dense = {
      scoped: {
        records: {
          scoped: denseScopes,
        },
      },
    };
    const broad = { query: { policy: { retry: false } } } as const;
    for (const [adapter, tree] of [
      ["rpc", rpcTree],
      ["http", httpTree],
    ] as const) {
      measure(adapter, "configure-empty", operationCount, 0, 50, () => {
        configureUtils(tree, {});
      });
      measure(adapter, "configure-sparse", operationCount, 0, 50, () => {
        configureUtils(tree, sparse);
      });
      measure(adapter, "configure-dense", operationCount, 0, 50, () => {
        configureUtils(tree, dense);
      });
      measure(adapter, "configure-repeated", operationCount, 0, 50, () => {
        configureUtils(
          configureUtils(configureUtils(tree, sparse), broad),
          sparse
        );
      });
    }
    if (operationCount !== 1) {
      continue;
    }
    const rpc = rpcTree.records["read-0"];
    const http = httpFactory().records["read-0"];
    if (rpc === undefined || http === undefined) {
      throw new TypeError("Missing workload operation");
    }
    for (const records of [1, 100]) {
      const input = {
        id: 1,
        rows: Array.from({ length: records }, (_, id) => ({
          id,
          title: `record-${id}`,
        })),
      };
      const request = { payload: Payload.make(input) };
      const preparedRpc = prepareInput(rpc, input);
      const preparedHttp = prepareInput(http, request);
      const workloads = [
        ["rpc", "query-key", () => rpc.queryKey(input)],
        ["rpc", "query-options", () => rpc.queryOptions({ input })],
        ["http", "query-key", () => http.queryKey(request)],
        ["http", "query-options", () => http.queryOptions({ input: request })],
        [
          "rpc",
          "prepared-query-options",
          () => rpc.queryOptions({ input: preparedRpc }),
        ],
        [
          "http",
          "prepared-query-options",
          () => http.queryOptions({ input: preparedHttp }),
        ],
      ] as const;
      for (const [adapter, stage, operation] of workloads) {
        measure(adapter, stage, 1, records, 500, () => {
          operation();
        });
      }
    }
  }
  const report = JSON.stringify({
    context: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      effect: packageVersion("effect"),
      queryCore: packageVersion("@tanstack/query-core"),
      configureUtilsSha256: createHash("sha256")
        .update(
          readFileSync(
            new URL("../src/core/configure-utils.ts", import.meta.url)
          )
        )
        .digest("hex"),
      workloadSha256: createHash("sha256")
        .update(readFileSync(new URL(import.meta.url)))
        .digest("hex"),
    },
    samples: 5,
    warmupIterations: 20,
    measurements,
  });
  const output = process.env["PERFORMANCE_OUTPUT"];
  if (output !== undefined && output.length > 0) {
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, `${report}\n`);
  }
  console.log(report);
});
NodeRuntime.runMain(program.pipe(Effect.scoped));
