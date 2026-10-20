import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/query-core";
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Effect, Schema } from "effect";
import { Multipart } from "effect/http";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

const User = Schema.Struct({ id: Schema.Int, name: Schema.String });
const UserPage = Schema.Struct({
  users: Schema.Array(User),
  nextCursor: Schema.NullOr(Schema.Int),
});
const locale = Schema.String.pipe(
  Schema.withConstructorDefault(Effect.succeed("en"))
);
const group = RpcGroup.make(
  Rpc.make("users.get", { payload: { id: Schema.Int, locale }, success: User }),
  Rpc.make("users.list", { success: Schema.Array(User) }),
  Rpc.make("users.create", { payload: { name: Schema.String }, success: User }),
  Rpc.make("users.page", {
    payload: { cursor: Schema.Int, pageSize: Schema.Int },
    success: UserPage,
  }),
  Rpc.make("diagnostics.stream", { success: Schema.String, stream: true })
);
const upload = HttpApiEndpoint.post("upload", "/users/:id/files", {
  params: { id: Schema.Int },
  payload: Schema.Struct({ file: Multipart.SingleFileSchema }).pipe(
    HttpApiSchema.asMultipart()
  ),
  success: Schema.Struct({ name: Schema.String }),
});
const api = HttpApi.make("docs-users").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id", {
      params: { id: Schema.Int },
      query: { locale },
      success: User,
    }),
    HttpApiEndpoint.post("create", "/users", {
      payload: Schema.Struct({ name: Schema.String }),
      success: User,
    }),
    HttpApiEndpoint.put("update", "/users/:id", {
      params: { id: Schema.Int },
      headers: { "if-match": Schema.String },
      payload: Schema.Struct({ name: Schema.String }),
      success: User,
      error: Schema.Literal("precondition-failed").pipe(
        HttpApiSchema.status(412)
      ),
    }),
    HttpApiEndpoint.get("page", "/users/page", {
      query: { cursor: Schema.Int, pageSize: Schema.Int },
      success: UserPage,
    }),
    upload
  ),
  HttpApiGroup.make("events").add(
    HttpApiEndpoint.get("watch", "/events", {
      query: { channel: Schema.String },
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    })
  )
);

declare const rpcClient: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
declare const httpClient: HttpApiClient.ForApi<typeof api>;
const rpc = createRpcQueryUtils(group, {
  client: rpcClient,
  keyPrefix: ["docs-users"],
});
const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ["docs-users"],
});
const queryClient = new QueryClient();

async function queryUsers() {
  const userOptions = rpc.users.get.queryOptions({
    input: { id: 1 },
    staleTime: 30_000,
  });
  const user = await queryClient.query(userOptions);

  const httpUserOptions = http.users.get.queryOptions({
    input: { params: { id: 1 }, query: { locale: "en" } },
    staleTime: 30_000,
  });
  const httpUser = await queryClient.query(httpUserOptions);

  const nameOptions = rpc.users.get.queryOptions({
    input: { id: 1 },
    select: (user) => user.name,
  });
  const selectedName = await queryClient.query(nameOptions);
  const cachedUser = queryClient.getQueryData(nameOptions.queryKey);

  rpc.users.list.queryOptions();
  selectedName satisfies string;
  cachedUser satisfies typeof User.Type | undefined;
  new QueryObserver(queryClient, nameOptions).getCurrentResult().data satisfies
    | string
    | undefined;
  return { user, httpUser };
}

async function createUsers() {
  const createUser = new MutationObserver(
    queryClient,
    rpc.users.create.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: rpc.users.key() }),
    })
  );
  const created = await createUser.mutate({ name: "Ada" });

  const createHttpUser = new MutationObserver(
    queryClient,
    http.users.create.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: http.users.key() }),
    })
  );
  const createdHttpUser = await createHttpUser.mutate({
    payload: { name: "Ada" },
  });
  created satisfies typeof User.Type;
  createdHttpUser satisfies typeof User.Type;
}

async function loadPages() {
  const rpcPages = rpc.users.page.infiniteOptions({
    initialPageParam: 0,
    input: (cursor) => ({ cursor, pageSize: 20 }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const pages = await queryClient.infiniteQuery(rpcPages);

  const httpPages = http.users.page.infiniteOptions({
    initialPageParam: 0,
    input: (cursor) => ({ query: { cursor, pageSize: 20 } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const cachedPages = queryClient.getQueryData(httpPages.queryKey);
  cachedPages?.pages satisfies readonly (typeof UserPage.Type)[] | undefined;
  cachedPages?.pageParams satisfies readonly number[] | undefined;
  return pages.pages.flatMap((page) => page.users);
}

function observeStreams() {
  const history = rpc.diagnostics.stream.streamedOptions({
    maxChunks: 100,
    refetchMode: "reset",
  });
  const sseHistory = http.events.watch.streamedOptions({
    input: { query: { channel: "news" } },
    maxChunks: 100,
    sseOptions: { maxEventSize: 1024 * 1024 },
  });

  const latest = rpc.diagnostics.stream.liveOptions();
  const latestSse = http.events.watch.liveOptions({
    input: { query: { channel: "news" } },
    sseOptions: { maxEventSize: 1024 * 1024 },
  });

  queryClient.getQueryData(history.queryKey) satisfies
    | readonly string[]
    | undefined;
  queryClient.getQueryData(sseHistory.queryKey) satisfies
    | readonly string[]
    | undefined;
  queryClient.getQueryData(latest.queryKey) satisfies string | undefined;
  queryClient.getQueryData(latestSse.queryKey) satisfies string | undefined;
}

async function readMetadata() {
  const input = { params: { id: 1 }, query: { locale: "en" } };
  const metadataOptions = http.users.get.metadataOptions({ input });
  const current = await queryClient.query(metadataOptions);
  console.log(current.data.name, current.status);
  const etag = current.headers["etag"];

  if (etag === undefined) throw new Error("The server supplied no ETag");
  await queryClient.cancelQueries({ queryKey: http.users.get.key() });
  const updateUser = new MutationObserver(
    queryClient,
    http.users.update.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: http.users.get.key() }),
    })
  );

  await updateUser.mutate({
    params: input.params,
    headers: { "if-match": etag },
    payload: { name: "Ada" },
  });
  const refreshed = await queryClient.query(metadataOptions);
  current.data satisfies typeof User.Type;
  current.headers satisfies Readonly<Record<string, string>>;
  return refreshed;
}

async function uploadFile() {
  const uploadFile = new MutationObserver(
    queryClient,
    http.users.upload.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: http.users.key() }),
    })
  );

  const payload = new FormData();
  payload.set(
    "file",
    new Blob(["profile notes"], { type: "text/plain" }),
    "notes.txt"
  );
  const uploaded = await uploadFile.mutate({ params: { id: 1 }, payload });
  uploaded satisfies { readonly name: string };
}
