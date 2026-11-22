import { useMutation, useQuery } from "@tanstack/react-query";
import {
  configureUtils,
  defineRpcPolicy,
  createRpcQueryUtils,
  prepareInput,
  skipToken,
  type UtilsConfiguration,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

const group = RpcGroup.make(
  Rpc.make("users.read", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ name: Schema.String }),
    error: Schema.Literal("missing"),
  }),
  Rpc.make("users.watch", {
    payload: { id: Schema.Int },
    success: Schema.String,
    stream: true,
  }),
  Rpc.make("ticks", { success: Schema.Int, stream: true }),
  Rpc.make("toString.child", { success: Schema.Int })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const base = createRpcQueryUtils(group, {
  client,
  keyPrefix: ["configuration"],
});
const savedConfiguration: UtilsConfiguration<typeof base> = {
  query: { retry: false },
};
configureUtils(base, savedConfiguration);
const savedScope: UtilsConfiguration<typeof base> = {
  paths: {
    toString: { query: { staleTime: 1000 } },
  },
};
configureUtils(base, savedScope);
configureUtils(base, {
  paths: {
    // @ts-expect-error A named scope requires a configuration object.
    toString: () => "configuration",
  },
});
const assembled = defineRpcPolicy.withClientError<never>()(
  group,
  {
    query: { retry: false },
    paths: {
      "users.read": {
        query: {
          retry: (_count, error) => {
            error.cause satisfies import("effect").Cause.Cause<"missing">;
            return false;
          },
          interceptors: [
            async ({ context, next }) => {
              context.signal satisfies AbortSignal;
              const data = await next();
              data.name satisfies string;
              return data;
            },
          ],
        },
        mutation: {
          callbacks: "compose",
          onSuccess: (data, input, optimistic) => {
            data.name satisfies string;
            input.id satisfies number;
            optimistic satisfies unknown;
            // @ts-expect-error Shared callbacks do not know a call-site optimistic result.
            optimistic.previous;
          },
          interceptors: [
            async ({ input, next }) => {
              input.id satisfies number;
              return await next();
            },
          ],
        },
      },
    },
  },
  { keyPrefix: ["configuration"] }
);
const rpc = configureUtils(base, assembled);
const result = useQuery(
  rpc.users.read.queryOptions({
    input: prepareInput(rpc.users.read, { id: 1 }),
    select: (data) => data.name,
    initialData: { name: "seed" },
  })
);
result.data satisfies string;
rpc.users.read.queryOptions({ input: skipToken })
  .queryFn satisfies typeof skipToken;
useMutation(
  rpc.users.read.mutationOptions({
    onMutate: (input) => ({ previous: input.id }),
    onSuccess: (data, _input, optimistic) => {
      data.name satisfies string;
      optimistic.previous satisfies number;
    },
  })
);

// @ts-expect-error A leaf only accepts its supported query views.
configureUtils(base.users.read, { live: { retry: false } });
configureUtils(base, {
  paths: {
    // @ts-expect-error Scope names come from the generated utility tree.
    missing: {},
  },
});
// @ts-expect-error View options reject unknown configuration properties.
configureUtils(base.users.read, { query: { retrry: false } });
configureUtils(base.users.read, {
  // @ts-expect-error Generated query functions remain owned by the library.
  query: { queryFn: async () => ({ name: "x" }) },
});
// @ts-expect-error Inputs remain local to the call site.
configureUtils(base.users.read, { query: { input: { id: 1 } } });
configureUtils(base.users.read, {
  // @ts-expect-error Shared defaults cannot determine observer selection.
  query: { select: (data: { name: string }) => data.name },
});
const invalidPolicy = { staleTime: 100, queryHash: "replacement" };
// @ts-expect-error Exact policy checks also apply to assigned objects.
configureUtils(base.users.read, { query: invalidPolicy });

const historyConfiguration = {
  streamed: {
    maxChunks: 20,
    interceptors: [async ({ next }) => await next()],
  },
} satisfies UtilsConfiguration<typeof base>;
const history = configureUtils(base, historyConfiguration);
history.users.watch.streamedOptions({ input: { id: 1 } });
history.users.watch.streamedKey({ input: { id: 1 } });
history.ticks.streamedOptions();
history.ticks.streamedKey();
history.ticks.streamedKey(undefined);
history.users.watch.streamedKey({ input: { id: 1 }, refetchMode: undefined });
history.users.watch.streamedOptions({
  input: { id: 1 },
  maxChunks: "unbounded",
  initialData: ["seed"],
});
const localHistory = configureUtils(base, {
  paths: {
    "users.watch": { streamed: { maxChunks: "unbounded" } },
  },
});
localHistory.users.watch.streamedOptions({ input: { id: 1 } });
// @ts-expect-error An unconfigured sibling still requires its retention choice.
localHistory.ticks.streamedOptions();
// @ts-expect-error Configured defaults preserve the endpoint's input type.
history.users.watch.streamedOptions({ input: { id: "1" } });
// @ts-expect-error Shared query interceptors must preserve every leaf's data type.
configureUtils(base, { query: { interceptors: [async () => 1] } });
configureUtils(base, {
  // @ts-expect-error Shared mutation interceptors must preserve every leaf's data type.
  mutation: { interceptors: [async () => ({ name: "replacement" })] },
});
// @ts-expect-error Native mutation policy callbacks exclude explicit undefined.
configureUtils(base, { mutation: { onSuccess: undefined } });

declare const invalidUnionPolicy:
  | { readonly staleTime: number }
  | { readonly staleTime: number; readonly queryHash: string };
// @ts-expect-error A forbidden policy property in any union member is rejected.
configureUtils(base.users.read, { query: invalidUnionPolicy });
declare const invalidUnionView:
  | { readonly staleTime: number }
  | {
      readonly staleTime: number;
      readonly queryHash: string;
    };
// @ts-expect-error View unions retain exact policy checks.
configureUtils(base.users.read, { query: invalidUnionView });
declare const invalidUnionScope:
  | {
      readonly "users.read": {
        readonly query: { readonly retry: false };
      };
    }
  | {
      readonly "users.read": {
        readonly query: { readonly queryHash: string };
      };
    };
// @ts-expect-error Scoped unions retain exact policy checks.
configureUtils(base, { paths: invalidUnionScope });
declare const validUnionPolicy:
  | { readonly staleTime: number }
  | { readonly retry: false };
configureUtils(base.users.read, { query: validUnionPolicy });
configureUtils(base, {
  query: {
    interceptors: [
      async ({ context, next }) => {
        // @ts-expect-error Ordinary queries do not have an infinite fetch direction.
        context.direction satisfies string;
        return await next();
      },
    ],
  },
  infinite: {
    interceptors: [
      async ({ context, next }) => {
        context.direction satisfies "forward" | "backward";
        return await next();
      },
    ],
  },
});

configureUtils(base.users.read, {
  query: {
    retry: (_count, error) => {
      error.cause satisfies import("effect").Cause.Cause<"missing">;
      // @ts-expect-error This leaf does not declare a numeric failure.
      error.cause satisfies import("effect").Cause.Cause<number>;
      return false;
    },
    interceptors: [
      async ({ next }) => {
        const data = await next();
        data.name satisfies string;
        // @ts-expect-error Query data is the decoded object.
        data satisfies number;
        return data;
      },
    ],
  },
  mutation: {
    onSuccess: (data, variables, optimistic) => {
      data.name satisfies string;
      variables.id satisfies number;
      // @ts-expect-error Variables are leaf-specific.
      variables.id satisfies string;
      // @ts-expect-error Optimistic context stays local.
      optimistic.previous;
    },
    onError: (error) => {
      error.cause satisfies import("effect").Cause.Cause<"missing">;
    },
  },
});
defineRpcPolicy.withClientError<never>()(
  group,
  {
    paths: {
      // @ts-expect-error Unknown scopes fail during assembly.
      unknown: {},
    },
  },
  { keyPrefix: ["configuration"] }
);
// @ts-expect-error A unary leaf has no live view.
configureUtils(base.users.read, { live: { retry: false } });
// @ts-expect-error Assembly rejects invalid native options.
configureUtils(base.users.read, { query: { staleTime: "forever" } });
// @ts-expect-error Inputs remain local.
configureUtils(base.users.read, { query: { input: { id: 1 } } });
configureUtils(base.users.read, {
  // @ts-expect-error Optimistic preparation remains local.
  mutation: { onMutate: () => ({ previous: 1 }) },
});
// @ts-expect-error Exact checks include assigned options.
configureUtils(base.users.read, { query: invalidPolicy });
// @ts-expect-error Exact checks include union members.
configureUtils(base.users.read, { query: invalidUnionPolicy });
const assembledBranch = configureUtils(base.users, {
  paths: {
    watch: { streamed: { maxChunks: 3 } },
  },
});

assembledBranch.watch.streamedOptions({ input: { id: 1 } });
// @ts-expect-error The policy does not change the stream's input contract.
assembledBranch.watch.streamedOptions({ input: { id: "1" } });
// @ts-expect-error Stream leaves do not have buffered query views.
configureUtils(base.users.watch, { query: {} });

const standardPolicy = defineRpcPolicy(group, {
  paths: {
    "users.read": {
      query: {
        retry: (_count, error) => {
          error.cause satisfies import("effect").Cause.Cause<
            "missing" | import("effect/rpc").RpcClientError.RpcClientError
          >;
          return false;
        },
      },
    },
  },
});
standardPolicy.paths["users.read"].query.retry;

const customPolicy = defineRpcPolicy.withClientError<"transport">()(
  group,
  {
    paths: {
      "users.read": {
        query: {
          enabled: (query) => query.queryKey[0].tenant === "test",
          refetchInterval: (query) => {
            query.queryKey[0].tenant satisfies "test";
            return 1000;
          },
          retry: (_count, error) => {
            error.cause satisfies import("effect").Cause.Cause<
              "missing" | "transport"
            >;
            return false;
          },
        },
      },
      "users.watch": { streamed: { maxChunks: 7 } },
    },
  },
  { keyPrefix: [{ tenant: "test" }] }
);
customPolicy.paths["users.watch"].streamed.maxChunks satisfies 7;
declare const customClient: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof group>,
  "transport"
>;
const customBase = createRpcQueryUtils(group, {
  client: customClient,
  keyPrefix: [{ tenant: "test" }],
});
const chained = configureUtils(configureUtils(customBase, customPolicy), {
  paths: {
    "users.watch": { streamed: { publicationBatchSize: 2 } },
    ticks: { streamed: { maxChunks: 2 } },
  },
});
chained.users.watch.streamedKey({ input: { id: 1 } });
chained.ticks.streamedOptions();

declare const unionTag: "dual.left" | "dual.right";
const unionGroup = RpcGroup.make(Rpc.make(unionTag, { success: Schema.Int }));
declare const unionClient: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof unionGroup>
>;
const unionUtils = createRpcQueryUtils(unionGroup, { client: unionClient });
unionUtils.dual.left.queryKey() satisfies readonly [
  "rpc",
  "dual",
  "left",
  "query",
];
unionUtils.dual.right.queryKey() satisfies readonly [
  "rpc",
  "dual",
  "right",
  "query",
];
