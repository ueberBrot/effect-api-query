import { performance } from "node:perf_hooks";

import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { createRpcQueryUtils } from "@ueberbrot/effect-api-query";
import { Array as EffectArray, Effect, Order, Schema, Stream } from "effect";
import { Rpc, RpcGroup, RpcTest } from "effect/rpc";

import {
  choices,
  performanceContext,
  positiveIntegers,
  writeReport,
} from "./performance/common.mts";

const group = RpcGroup.make(
  Rpc.make("watch", { success: Schema.Finite, stream: true })
);
const counts = positiveIntegers("STREAM_COUNTS", [1000, 10_000]);
const context = performanceContext();
const [samples = 3] = positiveIntegers("PERFORMANCE_SAMPLES", [3]);
const views = choices("STREAM_VIEWS", [
  "unbounded",
  "bounded-32",
  "batch-32",
  "batch-deadline",
  "live",
]);
const scenarios = [
  { view: "unbounded", maxChunks: "unbounded", publicationBatchSize: 1 },
  { view: "bounded-32", maxChunks: 32, publicationBatchSize: 1 },
  { view: "batch-32", maxChunks: "unbounded", publicationBatchSize: 32 },
  { view: "batch-deadline", maxChunks: "unbounded", publicationBatchSize: 32 },
  { view: "live", maxChunks: "unbounded", publicationBatchSize: 1 },
] as const;
type Scenario = (typeof scenarios)[number];

const measure = Effect.fnUntraced(function* (
  count: number,
  scenario: Scenario
) {
  let emissions = 0;
  let finalized = false;
  const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(
      group.toLayer({
        watch: () =>
          Stream.fromIterable(
            Array.from({ length: count }, (_, index) => index)
          ).pipe(
            Stream.rechunk(1),
            Stream.tap((value) => {
              emissions += 1;
              return scenario.view === "batch-deadline" && value % 128 === 0
                ? Effect.sleep("2 millis")
                : Effect.void;
            }),
            Stream.ensuring(
              Effect.sync(() => {
                finalized = true;
              })
            )
          ),
      })
    )
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  const leaf = createRpcQueryUtils(group, {
    client,
    keyPrefix: ["stream-baseline"],
  }).watch;
  const policy =
    scenario.view === "batch-deadline"
      ? {
          maxChunks: scenario.maxChunks,
          publicationBatchSize: scenario.publicationBatchSize,
          publicationMaxWaitMs: 1,
        }
      : {
          maxChunks: scenario.maxChunks,
          publicationBatchSize: scenario.publicationBatchSize,
        };
  const queryKey =
    scenario.view === "live" ? leaf.liveKey() : leaf.streamedKey(policy);
  const observer = new QueryObserver(queryClient, { queryKey, enabled: false });
  let observerNotifications = 0;
  let cachePublications = 0;
  let publishedElementSlots = 0;
  let firstPublicationMilliseconds: number | undefined;
  const stopObserver = observer.subscribe(() => {
    observerNotifications += 1;
  });
  const started = performance.now();
  const heapBeforeBytes = process.memoryUsage().heapUsed;
  const stopCache = queryClient.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "success" &&
      event.action.manual === true
    ) {
      firstPublicationMilliseconds ??= performance.now() - started;
      cachePublications += 1;
      const data: unknown = event.query.state.data;
      publishedElementSlots += EffectArray.isArray(data) ? data.length : 1;
    }
  });
  try {
    const data = yield* Effect.promise(async () =>
      scenario.view === "live"
        ? await queryClient.query(
            leaf.liveOptions({ rpcOptions: { streamBufferSize: 1 } })
          )
        : await queryClient.query(
            leaf.streamedOptions({
              ...policy,
              rpcOptions: { streamBufferSize: 1 },
            })
          )
    );
    const retainedValues = EffectArray.isArray(data) ? data.length : 1;
    const expected =
      scenario.view === "live"
        ? 1
        : Math.min(
            count,
            scenario.maxChunks === "unbounded" ? count : scenario.maxChunks
          );
    const latest = EffectArray.isArray(data) ? data.at(-1) : data;
    if (
      emissions !== count ||
      retainedValues !== expected ||
      latest !== count - 1 ||
      !finalized
    ) {
      throw new Error(
        "The stream must finish with the requested retention and cleanup"
      );
    }
    return {
      milliseconds: performance.now() - started,
      firstPublicationMilliseconds,
      cachePublications,
      observerNotifications,
      publishedElementSlots,
      emissions,
      retainedValues,
      heapBeforeBytes,
      heapAfterBytes: process.memoryUsage().heapUsed,
      finalized,
    };
  } finally {
    stopObserver();
    stopCache();
    queryClient.clear();
  }
});

const measurements = await Effect.runPromise(
  Effect.gen(function* () {
    const results = [];
    for (const count of counts) {
      for (const scenario of scenarios.filter((entry) =>
        views.includes(entry.view)
      )) {
        yield* measure(count, scenario).pipe(Effect.scoped);
        const runs = [];
        for (let sample = 0; sample < samples; sample += 1) {
          runs.push(yield* measure(count, scenario).pipe(Effect.scoped));
        }
        const sorted = EffectArray.sort(
          runs.map((run) => run.milliseconds),
          Order.Number
        );
        results.push({
          emissions: count,
          ...scenario,
          publicationMaxWaitMs: scenario.view === "batch-deadline" ? 1 : null,
          source:
            scenario.view === "batch-deadline"
              ? "2ms pause every 128 events"
              : "immediate",
          medianMilliseconds: sorted[Math.floor(sorted.length / 2)],
          samples: runs,
        });
      }
    }
    return results;
  })
);
writeReport({
  context,
  workload: {
    counts,
    views,
    samples,
    warmups: 1,
    readyClient:
      "RpcTest.makeClient, in-process decoded messages, streamBufferSize: 1",
    cache:
      "fresh QueryClient, default structural sharing, one disabled QueryObserver",
    heap: "unforced GC, before/after snapshots rather than peak allocation",
  },
  measurements,
});
