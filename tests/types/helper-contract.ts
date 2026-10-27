import type {
  dataTagSymbol,
  InfiniteData,
  QueryClient,
  SkipToken,
} from "@tanstack/query-core";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  skipToken,
  viewPrefix,
} from "@ueberbrot/effect-api-query";
import type {
  EffectHttpApiQueryError,
  EffectRpcQueryError,
  InferInput,
  InferMutationData,
  InferMutationError,
  InferQueryData,
  InferQueryError,
  MutationPolicy,
  QueryPolicy,
  RpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Effect, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;
const group = RpcGroup.make(
  Rpc.make("read", {
    payload: {
      id: Schema.Int,
      locale: Schema.String.pipe(
        Schema.optionalKey,
        Schema.withConstructorDefault(Effect.succeed("en"))
      ),
    },
    success: Schema.UndefinedOr(Schema.Int),
    error: Schema.Literal("missing"),
  }),
  Rpc.make("ping"),
  Rpc.make("watch", {
    payload: { channel: Schema.String },
    success: Schema.UndefinedOr(Schema.Int),
    stream: true,
  }),
  Rpc.make("watchAll", { success: Schema.Int, stream: true })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
declare const queryClient: QueryClient;
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["helpers"] });
const input = { id: 1 } satisfies InferInput<typeof rpc.read>;
type ReadData = Assert<Equal<InferQueryData<typeof rpc.read>, number | null>>;
type ReadMutationData = Assert<
  Equal<InferMutationData<typeof rpc.read>, number | undefined>
>;
type ReadMutationError = Assert<
  Equal<InferMutationError<typeof rpc.read>, InferQueryError<typeof rpc.read>>
>;
type PingInput = Assert<Equal<InferInput<typeof rpc.ping>, void>>;
type PingQueryData = Assert<Equal<InferQueryData<typeof rpc.ping>, null>>;
type PingMutationData = Assert<Equal<InferMutationData<typeof rpc.ping>, void>>;
type WatchInput = Assert<
  Equal<
    InferInput<typeof rpc.watch>,
    {
      readonly channel: string;
    }
  >
>;
type WatchAllInput = Assert<Equal<InferInput<typeof rpc.watchAll>, void>>;
type StreamPolicyDictionary = Assert<
  NonNullable<Parameters<typeof rpc.watchAll.streamedKey>[0]> extends Record<
    string,
    unknown
  >
    ? true
    : false
>;
type WatchData = Assert<
  Equal<
    InferQueryData<typeof rpc.watch, "streamed">,
    readonly (number | undefined)[]
  >
>;
type WatchLiveData = Assert<
  Equal<InferQueryData<typeof rpc.watch, "live">, number | null>
>;
type InfiniteReadData = Assert<
  Equal<
    InferQueryData<typeof rpc.read, "infinite">,
    InfiniteData<number | null, unknown>
  >
>;
type BranchInput = Assert<Equal<InferInput<typeof rpc>, never>>;
const broadGroup = RpcGroup.make(
  Rpc.make("unknownRead", { payload: Schema.Unknown, success: Schema.String }),
  Rpc.make("anyRead", { payload: Schema.Any, success: Schema.String }),
  Rpc.make("optionalRead", {
    payload: Schema.Union([Schema.String, Schema.Void]),
    success: Schema.String,
  }),
  Rpc.make("unknownWatch", {
    payload: Schema.Unknown,
    success: Schema.String,
    stream: true,
  }),
  Rpc.make("anyWatch", {
    payload: Schema.Any,
    success: Schema.String,
    stream: true,
  }),
  Rpc.make("optionalWatch", {
    payload: Schema.Union([Schema.String, Schema.Void]),
    success: Schema.String,
    stream: true,
  })
);
declare const broad: RpcQueryUtils<typeof broadGroup, readonly ["broad"]>;
type UnknownInput = Assert<
  Equal<InferInput<typeof broad.unknownRead>, unknown>
>;
type AnyInput = Assert<Equal<InferInput<typeof broad.anyRead>, any>>;
type OptionalInput = Assert<
  Equal<InferInput<typeof broad.optionalRead>, string | void>
>;
type UnknownStreamInput = Assert<
  Equal<InferInput<typeof broad.unknownWatch>, unknown>
>;
type AnyStreamInput = Assert<Equal<InferInput<typeof broad.anyWatch>, any>>;
type OptionalStreamInput = Assert<
  Equal<InferInput<typeof broad.optionalWatch>, string | void>
>;
configureUtils(broad.unknownRead, {
  query: {
    policy: { retry: false },
  },
}).queryOptions({
  input: { id: 1 },
});
configureUtils(broad.anyRead, {
  query: {
    policy: { retry: false },
  },
}).queryOptions({ input: { id: 1 } });
configureUtils(broad.optionalRead, {
  query: {
    policy: { retry: false },
  },
}).queryOptions({
  input: undefined,
});
configureUtils(broad.unknownWatch, {
  streamed: {
    policy: { retry: false },
  },
}).streamedOptions({
  maxChunks: "unbounded",
  input: { id: 1 },
});
configureUtils(broad.anyWatch, {
  live: {
    policy: { retry: false },
  },
}).liveOptions({ input: { id: 1 } });
configureUtils(broad.optionalWatch, {
  live: {
    policy: { retry: false },
  },
}).liveOptions({
  input: "Ada",
});
type StreamMutationData = Assert<
  Equal<InferMutationData<typeof rpc.watch>, never>
>;
type StreamMutationError = Assert<
  Equal<InferMutationError<typeof rpc.watch>, never>
>;
const prefix = viewPrefix(rpc.read, "query");
type ViewPrefix = Assert<
  Equal<typeof prefix, readonly ["helpers", "rpc", "read", "query"]>
>;
type UntaggedPrefix = Assert<
  Equal<typeof dataTagSymbol extends keyof typeof prefix ? true : false, false>
>;
const prefixCacheData = queryClient.getQueryData(prefix);
type PrefixCacheData = Assert<Equal<typeof prefixCacheData, unknown>>;
queryClient.invalidateQueries({ queryKey: prefix });
viewPrefix(rpc.watch, "streamed") satisfies readonly [
  "helpers",
  "rpc",
  "watch",
  "streamed",
];
// @ts-expect-error RPC leaves have no metadata view
type MissingMetadata = InferQueryData<typeof rpc.read, "metadata">;
// @ts-expect-error Buffered RPC leaves have no live view
type MissingLiveError = InferQueryError<typeof rpc.read, "live">;
// @ts-expect-error Streaming RPC leaves have no ordinary query view
type MissingStreamQuery = InferQueryData<typeof rpc.watch, "query">;
// @ts-expect-error A payload constructor still requires its declared id
const missingInput: InferInput<typeof rpc.read> = {};
const policy = {
  retry: (count, error) => {
    error satisfies EffectRpcQueryError<"missing">;
    return count < 2;
  },
  staleTime: (query) => {
    query.state.data satisfies number | null | undefined;
    return query.state.data === undefined ? 0 : 1000;
  },
  refetchInterval: (query) => (query.state.data === null ? false : 1000),
} satisfies QueryPolicy<typeof rpc.read>;
const read = configureUtils(rpc.read, {
  query: {
    policy: policy,
  },
}).queryOptions;
const selected = read({ input, select: (data) => `${data}` });
useQuery(selected).data satisfies string | undefined;
useSuspenseQuery(selected).data satisfies string;
queryClient.getQueryData(selected.queryKey) satisfies number | null | undefined;
const initialized = read({
  input,
  initialData: 1,
  select: (data) => `${data}`,
});
useQuery(initialized).data satisfies string;
const skipped = read({ input: skipToken });
skipped.queryFn satisfies SkipToken;
declare const conditionalInput: InferInput<typeof rpc.read> | SkipToken;
const conditional = read({ input: conditionalInput });
// @ts-expect-error A conditional function cannot be used as a Suspense query
useSuspenseQuery(conditional);
const infinite = configureUtils(rpc.read, {
  infinite: {
    policy: {
      staleTime: (query) => {
        query.state.data satisfies
          | InfiniteData<number | null, unknown>
          | undefined;
        return 1000;
      },
    },
  },
}).infiniteOptions({
  input: (page: number) => ({ id: page }),
  initialPageParam: 0,
  getNextPageParam: (_last, _all, page) => {
    page satisfies number;
    return page + 1;
  },
  select: (data) => data.pages.length,
});
useInfiniteQuery(infinite).data satisfies number | undefined;
queryClient.getQueryData(infinite.queryKey) satisfies
  | InfiniteData<number | null, number>
  | undefined;
const live = configureUtils(rpc.watch, {
  live: {
    policy: {
      retry: (_count, error) => error._tag !== "EffectRpcQueryEmptyStreamError",
    },
  },
}).liveOptions({ input: { channel: "one" }, select: (data) => `${data}` });
useQuery(live).data satisfies string | undefined;
configureUtils(rpc.watchAll, {
  streamed: {
    policy: { gcTime: 60000 },
  },
}).streamedOptions({ maxChunks: 2 });
const mutationPolicy = {
  onSuccess: (data, variables, result, context) => {
    data satisfies number | undefined;
    variables satisfies InferInput<typeof rpc.read>;
    result satisfies unknown;
    return context.client.invalidateQueries({ queryKey: rpc.read.key() });
  },
  onError: (error, variables) => {
    error satisfies EffectRpcQueryError<"missing">;
    variables satisfies InferInput<typeof rpc.read>;
  },
} satisfies MutationPolicy<typeof rpc.read>;
const mutate = configureUtils(rpc.read, {
  mutation: {
    policy: mutationPolicy,
  },
}).mutationOptions;
const mutation = mutate({
  onMutate: (variables) => ({ previous: variables.id }),
  onSuccess: (_data, _variables, result) => {
    result.previous satisfies number;
  },
  onError: (_error, _variables, result) => {
    result?.previous satisfies number | undefined;
  },
});
useMutation(mutation).mutate(input);
// @ts-expect-error Mutation variables retain their required fields
useMutation(mutation).mutate({});
const api = HttpApi.make("helpers").add(
  HttpApiGroup.make("items").add(
    HttpApiEndpoint.get("read", "/items/:id", {
      params: { id: Schema.Int },
      success: Schema.Void,
    }),
    HttpApiEndpoint.post("upload", "/upload", {
      payload: Schema.Struct({ name: Schema.String }).pipe(
        HttpApiSchema.asMultipart()
      ),
      success: Schema.Int,
    }),
    HttpApiEndpoint.get("watch", "/watch", {
      success: HttpApiSchema.StreamSse({ data: Schema.Int }),
    })
  )
);
declare const httpClient: HttpApiClient.ForApi<typeof api>;
const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ["helpers"],
});
type HttpInput = Assert<
  Equal<
    Omit<InferInput<typeof http.items.read>, "responseMode" | "sseOptions">,
    {
      readonly params: {
        readonly id: number;
      };
    }
  >
>;
type HttpReadData = Assert<Equal<InferQueryData<typeof http.items.read>, null>>;
type MetadataData = Assert<
  Equal<
    InferQueryData<typeof http.items.read, "metadata">,
    {
      readonly data: null;
      readonly status: number;
      readonly headers: Readonly<Record<string, string>>;
    }
  >
>;
type MetadataDictionary = Assert<
  InferQueryData<typeof http.items.read, "metadata"> extends Record<
    string,
    unknown
  >
    ? true
    : false
>;
type MultipartInput = Assert<
  Equal<
    Omit<InferInput<typeof http.items.upload>, "responseMode" | "sseOptions">,
    {
      readonly payload: FormData;
    }
  >
>;
type HttpStreamInput = Assert<Equal<InferInput<typeof http.items.watch>, void>>;
configureUtils(http.items.read, {
  metadata: {
    policy: {
      staleTime: (query) => (query.state.data?.status === 200 ? 30000 : 0),
      retry: (_count, error) => {
        error satisfies EffectHttpApiQueryError<unknown>;
        return false;
      },
    },
  },
}).metadataOptions({ input: { params: { id: 1 } } });
configureUtils(http.items.upload, {
  mutation: {
    policy: {
      onSuccess: (data, variables) => {
        data satisfies number;
        variables.payload satisfies FormData;
      },
    },
  },
}).mutationOptions();
// @ts-expect-error Multipart leaves have no query policy
configureUtils(http.items.upload, {
  query: {
    policy: {},
  },
});
// @ts-expect-error Stream leaves have no mutation policy
configureUtils(rpc.watch, {
  mutation: {
    policy: {},
  },
});
// @ts-expect-error There is no metadata view on an RPC leaf
configureUtils(rpc.read, {
  metadata: {
    policy: {},
  },
});
declare const unresolvedLeaf: typeof rpc.read | typeof rpc.watch;
// @ts-expect-error The chosen view must exist on every possible leaf
configureUtils(unresolvedLeaf, {
  query: {
    policy: {},
  },
});
// @ts-expect-error A view prefix also requires a view on every possible leaf
viewPrefix(unresolvedLeaf, "live");
// @ts-expect-error A buffered leaf has no live view prefix
viewPrefix(rpc.read, "live");
// @ts-expect-error Branches have no query view prefix
viewPrefix(rpc, "query");
// @ts-expect-error Multipart leaves have no query view prefix
viewPrefix(http.items.upload, "query");
// @ts-expect-error Inputs belong to each builder invocation
configureUtils(rpc.read, {
  query: {
    policy: { input },
  },
}).queryOptions;
// @ts-expect-error A policy cannot replace the generated key
configureUtils(rpc.read, {
  query: {
    policy: { queryKey: ["owned"] },
  },
}).queryOptions;
// @ts-expect-error A policy cannot replace the generated function
configureUtils(rpc.read, {
  query: {
    policy: { queryFn: () => Promise.resolve(1) },
  },
}).queryOptions;
// @ts-expect-error QueryClient owns hashing
configureUtils(rpc.read, {
  query: {
    policy: { queryKeyHashFn: () => "custom" },
  },
}).queryOptions;
// @ts-expect-error Projection inference remains local
configureUtils(rpc.read, {
  query: {
    policy: {
      select: (value: number | null) => `${value}`,
    },
  },
}).queryOptions;
// @ts-expect-error Initial data inference remains local
configureUtils(rpc.read, {
  query: {
    policy: { initialData: 1 },
  },
}).queryOptions;
// @ts-expect-error Placeholder data inference remains local
configureUtils(rpc.read, {
  query: {
    policy: { placeholderData: 1 },
  },
}).queryOptions;
// @ts-expect-error RPC request options remain local
configureUtils(rpc.read, {
  query: {
    policy: {
      rpcOptions: { headers: { authorization: "token" } },
    },
  },
}).queryOptions;
configureUtils(rpc.watch, {
  streamed: {
    policy: { maxChunks: 10 },
  },
}).streamedOptions({ input: { channel: "one" } });
// @ts-expect-error SSE decoding remains local
configureUtils(http.items.watch, {
  live: {
    policy: { sseOptions: {} },
  },
}).liveOptions;
// @ts-expect-error Page setup remains local
configureUtils(rpc.read, {
  infinite: {
    policy: { initialPageParam: 0 },
  },
}).infiniteOptions;
configureUtils(rpc.read, {
  mutation: {
    policy: {
      // @ts-expect-error Shared callbacks cannot assume a call-site optimistic result
      onSuccess: (_data, _variables, result) => result.previous,
    },
  },
}).mutationOptions;
// @ts-expect-error Optimistic context inference remains local
configureUtils(rpc.read, {
  mutation: {
    policy: { onMutate: () => ({ previous: 1 }) },
  },
}).mutationOptions;
// @ts-expect-error A mutation policy cannot replace the generated key
configureUtils(rpc.read, {
  mutation: {
    policy: { mutationKey: ["owned"] },
  },
}).mutationOptions;
// @ts-expect-error Request-local adapter options are supplied to the bound builder
configureUtils(rpc.read, {
  mutation: {
    policy: { rpcOptions: {} },
  },
}).mutationOptions;
// @ts-expect-error A typed callback cannot change the leaf's mutation output
configureUtils(rpc.read, {
  mutation: {
    policy: { onSuccess: (_data: string) => {} },
  },
}).mutationOptions;
// @ts-expect-error A typed callback cannot change the leaf's query error
configureUtils(rpc.read, {
  query: {
    policy: {
      retry: (
        _count,
        _error: {
          different: true;
        }
      ) => false,
    },
  },
}).queryOptions;
const injected = { retry: false, queryHash: "custom" };
configureUtils(rpc.read, {
  query: {
    // @ts-expect-error Exclusions also apply to stored policy objects
    policy: injected,
  },
}).queryOptions;
