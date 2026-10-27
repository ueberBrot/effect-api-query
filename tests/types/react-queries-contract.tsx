import { QueryClient } from "@tanstack/query-core";
import { useQueries, useSuspenseQueries } from "@tanstack/react-query";
import {
  configureUtils,
  createRpcQueryUtils,
  skipToken,
  type InferQueryError,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const User = Schema.Struct({ name: Schema.String });
type User = typeof User.Type;
const group = RpcGroup.make(
  Rpc.make("read", {
    payload: { id: Schema.Int },
    success: User,
    error: Schema.Literal("missing"),
  }),
  Rpc.make("watch", {
    payload: { id: Schema.Int },
    success: User,
    error: Schema.Literal("disconnected"),
    stream: true,
  }),
  Rpc.make("status", { success: Schema.String }),
  Rpc.make("ticks", { success: Schema.Int, stream: true })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const raw = createRpcQueryUtils(group, {
  client,
  keyPrefix: ["parallel-queries"],
});
const rpc = configureUtils(raw, {
  streamed: { policy: { maxChunks: 20 } },
  query: { policy: { retry: false } },
});
type ReadError = InferQueryError<typeof rpc.read>;
type StreamError = InferQueryError<typeof rpc.watch, "streamed">;

const queries = useQueries({
  queries: [
    rpc.read.queryOptions({ input: { id: 1 }, select: (user) => user.name }),
    rpc.watch.streamedOptions({
      input: { id: 1 },
      select: (users) => users.length,
    }),
    rpc.status.queryOptions(),
  ],
});
true satisfies Assert<Equal<(typeof queries)[0]["data"], string | undefined>>;
true satisfies Assert<Equal<(typeof queries)[0]["error"], ReadError | null>>;
true satisfies Assert<Equal<(typeof queries)[1]["data"], number | undefined>>;
true satisfies Assert<Equal<(typeof queries)[1]["error"], StreamError | null>>;
true satisfies Assert<Equal<(typeof queries)[2]["data"], string | undefined>>;

const suspense = useSuspenseQueries({
  queries: [
    rpc.read.queryOptions({ input: { id: 1 }, select: (user) => user.name }),
    rpc.watch.streamedOptions({
      input: { id: 1 },
      select: (users) => users.length,
    }),
  ],
});
true satisfies Assert<Equal<(typeof suspense)[0]["data"], string>>;
true satisfies Assert<Equal<(typeof suspense)[0]["error"], ReadError | null>>;
true satisfies Assert<Equal<(typeof suspense)[1]["data"], number>>;
true satisfies Assert<Equal<(typeof suspense)[1]["error"], StreamError | null>>;

const queryClient = new QueryClient();
const cachedUser = queryClient.getQueryData(rpc.read.queryKey({ id: 1 }));
const cachedHistory = queryClient.getQueryData(
  rpc.watch.streamedKey({ id: 1 })
);
const historyKey = rpc.watch.streamedKey({ id: 1 });
const inputlessHistoryKey = rpc.ticks.streamedKey();
true satisfies Assert<Equal<(typeof historyKey)["length"], 6>>;
true satisfies Assert<Equal<(typeof inputlessHistoryKey)["length"], 5>>;
true satisfies Assert<Equal<typeof cachedUser, User | undefined>>;
true satisfies Assert<Equal<typeof cachedHistory, readonly User[] | undefined>>;

declare const id: number | undefined;
const directOptions =
  id === undefined
    ? rpc.watch.liveOptions({ input: { id: 1 } })
    : rpc.watch.streamedOptions({ input: { id: 1 } });
const directResult = directOptions.queryFn({
  client: queryClient,
  queryKey: directOptions.queryKey,
  signal: new AbortController().signal,
  meta: undefined,
});
true satisfies Assert<
  Equal<Awaited<typeof directResult>, User | readonly User[]>
>;
const conditional = useQueries({
  queries: [
    rpc.read.queryOptions({
      input: id === undefined ? skipToken : { id },
      select: (user) => user.name,
    }),
  ],
});
true satisfies Assert<
  Equal<(typeof conditional)[0]["data"], string | undefined>
>;
true satisfies Assert<
  Equal<(typeof conditional)[0]["error"], ReadError | null>
>;

const seeded = useQueries({
  queries: [
    rpc.read.queryOptions({ input: { id: 1 }, initialData: { name: "Ada" } }),
    raw.watch.streamedOptions({ input: { id: 1 }, maxChunks: 10 }),
  ],
});
true satisfies Assert<Equal<(typeof seeded)[0]["data"], User>>;
true satisfies Assert<
  Equal<(typeof seeded)[1]["data"], readonly User[] | undefined>
>;
true satisfies Assert<Equal<(typeof seeded)[1]["error"], StreamError | null>>;
