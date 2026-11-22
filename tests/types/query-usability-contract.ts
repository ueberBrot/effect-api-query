import { QueryClient } from "@tanstack/query-core";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  configureUtils,
  consumeEvents,
  createBranchQueryFilter,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  findDeclaredError,
  getExecutionCause,
  isEffectApiQueryError,
  matchDeclaredError,
  retryExecutionError,
  prepareInput,
  skipToken,
} from "@ueberbrot/effect-api-query";
import type {
  EffectHttpApiQueryError,
  EffectRpcQueryError,
  InferInput,
  InferQueryError,
} from "@ueberbrot/effect-api-query";
import { Effect, Option, Schema, Stream } from "effect";
import type { Cause } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";
const group = RpcGroup.make(
  Rpc.make("read", {
    payload: { id: Schema.Int },
    success: Schema.Int,
    error: Schema.TaggedStruct("Missing", { id: Schema.Int }),
  }),
  Rpc.make("ping", { success: Schema.Void }),
  Rpc.make("watch", {
    payload: { id: Schema.Int },
    success: Schema.Int,
    stream: true,
  })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["usability"] });
const queryClient = new QueryClient();
const leaf = configureUtils(rpc.read, {
  query: {
    staleTime: 1000,
    interceptors: [
      async ({ next }) => {
        const data: number = await next();
        return data;
      },
    ],
  },
  mutation: {
    onSuccess: (data, input) => {
      const result: number = data + input.id;
      void result;
    },
    callbacks: "compose",
  },
});
const prepared = prepareInput(leaf, { id: 1 });
const query = useQuery(
  leaf.queryOptions({
    input: prepared,
    initialData: 1,
    select: (value) => String(value),
  })
);
const selected: string = query.data;
const cached: number | undefined = queryClient.getQueryData(
  leaf.queryKey({ input: prepared })
);
const plain: InferInput<typeof rpc.watch> = { id: 1 };
const skipped = leaf.queryOptions({
  input: Math.random() > 0.5 ? prepared : skipToken,
});
useQuery(skipped);
useMutation(
  leaf.mutationOptions({
    onMutate: (input) => ({ previous: input.id }),
    onError: (_error, _input, context) => {
      const previous: number | undefined = context?.previous;
      void previous;
    },
  })
);
// @ts-expect-error A prepared input is not a mutation payload.
leaf.mutationOptions().mutationFn(prepared);
// @ts-expect-error Preparation checks the original input shape.
prepareInput(rpc.read, { id: "wrong" });
rpc.read.infiniteOptions({
  // @ts-expect-error Infinite mappers construct each page from raw input.
  input: () => prepared,
  initialPageParam: 0,
  getNextPageParam: () => undefined,
});
// @ts-expect-error A live stream has no publication batching policy.
rpc.watch.liveOptions({ input: plain, publicationMaxWaitMs: 10 });
rpc.watch.streamedOptions({
  maxChunks: "unbounded",
  input: prepareInput(rpc.watch, plain),
  publicationBatchSize: 10,
  publicationMaxWaitMs: 50,
});
configureUtils(rpc.read, {
  // @ts-expect-error Read leaves have no live view.
  live: {},
});
configureUtils(rpc.read, {
  // @ts-expect-error Policies cannot replace generated identity.
  query: { queryKey: [] },
});
const projectedPolicy = {
  staleTime: 100,
  select: (value: number) => String(value),
};
configureUtils(rpc.read, {
  // @ts-expect-error Variable-supplied projections must remain local to preserve result types.
  query: projectedPolicy,
});
const optimisticPolicy = { retry: false, onMutate: () => ({ previous: 1 }) };
configureUtils(rpc.read, {
  // @ts-expect-error Variable-supplied optimistic context must remain local to the mutation.
  mutation: optimisticPolicy,
});
queryClient.invalidateQueries(createBranchQueryFilter(rpc, "query")());
declare const failure: InferQueryError<typeof rpc.read>;
const found = findDeclaredError(failure, "Missing");
if (Option.isSome(found)) {
  const id: number = found.value.id;
  void id;
}
// @ts-expect-error Only tags in the typed failure union are accepted.
findDeclaredError(failure, "Other");
const api = HttpApi.make("usability").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("read", "/users/:id", {
      params: { id: Schema.Int },
      success: Schema.Int,
      error: Schema.TaggedStruct("Busy", { seconds: Schema.Int }),
    }),
    HttpApiEndpoint.get("watch", "/watch", {
      success: HttpApiSchema.StreamSse({ data: Schema.Int }),
    })
  )
);
declare const httpClient: HttpApiClient.ForApi<typeof api>;
const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ["usability"],
});
const request = prepareInput(http.users.read, { params: { id: 1 } });
const metadata = useQuery(
  configureUtils(http.users.read, {
    metadata: { staleTime: 1000 },
  }).metadataOptions({ input: request, select: (value) => value.data })
);
const data: number | undefined = metadata.data;
const consumed: Effect.Effect<void, "handler"> = consumeEvents(
  Stream.make(1, 2),
  {
    onEvent: (event) =>
      event > 1 ? Effect.fail("handler" as const) : Effect.void,
  }
);
void [selected, cached, data, consumed];

type Equal<L, R> =
  (<T>() => T extends L ? 1 : 2) extends <T>() => T extends R ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

const calling = leaf.call({
  input: prepared,
  signal: AbortSignal.abort(),
  rpcOptions: { headers: { "x-test": "test" } },
});
const rpcEffect = leaf.effect({ input: prepared });
const ping = rpc.ping.call();
const httpCall = http.users.read.call({ input: request });
const httpEffect = http.users.read.effect({ input: request });
true satisfies Assert<Equal<typeof calling, Promise<number>>>;
true satisfies Assert<Equal<typeof ping, Promise<void>>>;
true satisfies Assert<Equal<typeof httpCall, Promise<number>>>;
true satisfies Assert<Equal<Effect.Success<typeof rpcEffect>, number>>;
true satisfies Assert<Equal<Effect.Success<typeof httpEffect>, number>>;
true satisfies Assert<Equal<Effect.Services<typeof httpEffect>, never>>;
true satisfies Assert<
  Equal<Extract<keyof typeof rpc.watch, "call" | "effect">, never>
>;
true satisfies Assert<
  Equal<Extract<keyof typeof http.users.watch, "call" | "effect">, never>
>;
true satisfies Assert<
  Equal<
    Extract<Parameters<typeof rpc.read.call>[0]["input"], typeof skipToken>,
    never
  >
>;
true satisfies Assert<
  Equal<Extract<keyof Parameters<typeof rpc.read.effect>[0], "signal">, never>
>;

type Missing = { readonly _tag: "Missing"; readonly id: number };
type Busy = { readonly _tag: "Busy"; readonly seconds: number };
type BothAdapters =
  | EffectRpcQueryError<Missing>
  | EffectHttpApiQueryError<Busy>;
declare const unified: BothAdapters | { readonly _tag: "LocalError" };
declare const unknownError: unknown;
if (isEffectApiQueryError(unknownError)) {
  true satisfies Assert<
    Equal<
      typeof unknownError,
      EffectRpcQueryError<unknown> | EffectHttpApiQueryError<unknown>
    >
  >;
}
const cause = getExecutionCause(unified);
true satisfies Assert<
  Equal<typeof cause, Cause.Cause<Missing | Busy> | undefined>
>;
const match = matchDeclaredError(
  unified,
  {
    Missing: (value) => {
      true satisfies Assert<Equal<typeof value, Missing>>;
      return value.id;
    },
    Busy: (value) => {
      true satisfies Assert<Equal<typeof value, Busy>>;
      return value.seconds > 0;
    },
  },
  (original) => {
    true satisfies Assert<Equal<typeof original, typeof unified>>;
    return "fallback" as const;
  }
);
true satisfies Assert<Equal<typeof match, number | boolean | "fallback">>;

const retry = retryExecutionError<typeof unified>({
  shouldRetry: (value) => value._tag === "Busy" && value.seconds > 0,
});
retry(0, unified);
const nativeRetry = rpc.read.queryOptions({
  input: prepared,
  retry: retryExecutionError({
    shouldRetry: (value) => value._tag === "Missing" && value.id > 0,
  }),
});
void nativeRetry;
