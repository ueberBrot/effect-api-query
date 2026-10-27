import { useMutation, useQuery } from "@tanstack/react-query";
import {
  configureUtils,
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
  query: { policy: { retry: false } },
};
configureUtils(base, savedConfiguration);
const savedScope: UtilsConfiguration<typeof base> = {
  scoped: { toString: { query: { policy: { staleTime: 1000 } } } },
};
configureUtils(base, savedScope);
// @ts-expect-error A named scope requires a configuration object.
configureUtils(base, { scoped: { toString: () => "configuration" } });
const rpc = configureUtils(base, {
  query: { policy: { retry: false } },
  scoped: {
    users: {
      scoped: {
        read: {
          query: {
            policy: {
              retry: (_count, error) => {
                error.cause satisfies import("effect").Cause.Cause<"missing">;
                return false;
              },
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
            policy: {
              onSuccess: (data, input, optimistic) => {
                data.name satisfies string;
                input.id satisfies number;
                optimistic satisfies unknown;
                // @ts-expect-error Shared callbacks do not know a call-site optimistic result.
                optimistic.previous;
              },
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
  },
});
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
configureUtils(base.users.read, { live: { policy: { retry: false } } });
// @ts-expect-error Scope names come from the generated utility tree.
configureUtils(base, { scoped: { missing: {} } });
// @ts-expect-error View options reject unknown configuration properties.
configureUtils(base.users.read, { query: { retrry: false } });
// @ts-expect-error Generated query functions remain owned by the library.
configureUtils(base.users.read, {
  query: { policy: { queryFn: async () => ({ name: "x" }) } },
});
// @ts-expect-error Inputs remain local to the call site.
configureUtils(base.users.read, { query: { policy: { input: { id: 1 } } } });
// @ts-expect-error Shared defaults cannot determine observer selection.
configureUtils(base.users.read, {
  query: { policy: { select: (data: { name: string }) => data.name } },
});
const invalidPolicy = { staleTime: 100, queryHash: "replacement" };
// @ts-expect-error Exact policy checks also apply to assigned objects.
configureUtils(base.users.read, { query: { policy: invalidPolicy } });

const historyConfiguration = {
  streamed: {
    policy: { maxChunks: 20 },
    interceptors: [async ({ next }) => await next()],
  },
} satisfies UtilsConfiguration<typeof base>;
const history = configureUtils(base, historyConfiguration);
history.users.watch.streamedOptions({ input: { id: 1 } });
history.users.watch.streamedKey({ id: 1 });
history.ticks.streamedOptions();
history.ticks.streamedKey();
history.ticks.streamedKey(undefined);
history.users.watch.streamedKey({ id: 1 }, undefined);
history.users.watch.streamedOptions({
  input: { id: 1 },
  maxChunks: "unbounded",
  initialData: ["seed"],
});
const localHistory = configureUtils(base, {
  scoped: {
    users: {
      scoped: {
        watch: { streamed: { policy: { maxChunks: "unbounded" } } },
      },
    },
  },
});
localHistory.users.watch.streamedOptions({ input: { id: 1 } });
// @ts-expect-error An unconfigured sibling still requires its retention choice.
localHistory.ticks.streamedOptions();
// @ts-expect-error Configured defaults preserve the endpoint's input type.
history.users.watch.streamedOptions({ input: { id: "1" } });
// @ts-expect-error Shared query interceptors must preserve every leaf's data type.
configureUtils(base, { query: { interceptors: [async () => 1] } });
// @ts-expect-error Shared mutation interceptors must preserve every leaf's data type.
configureUtils(base, {
  mutation: { interceptors: [async () => ({ name: "replacement" })] },
});
// @ts-expect-error Native mutation policy callbacks exclude explicit undefined.
configureUtils(base, { mutation: { policy: { onSuccess: undefined } } });

declare const invalidUnionPolicy:
  | { readonly staleTime: number }
  | { readonly staleTime: number; readonly queryHash: string };
// @ts-expect-error A forbidden policy property in any union member is rejected.
configureUtils(base.users.read, { query: { policy: invalidUnionPolicy } });
declare const invalidUnionView:
  | { readonly policy: { readonly staleTime: number } }
  | {
      readonly policy: {
        readonly staleTime: number;
        readonly queryHash: string;
      };
    };
// @ts-expect-error View unions retain exact policy checks.
configureUtils(base.users.read, { query: invalidUnionView });
declare const invalidUnionScope:
  | {
      readonly read: {
        readonly query: { readonly policy: { readonly retry: false } };
      };
    }
  | {
      readonly read: {
        readonly query: { readonly policy: { readonly queryHash: string } };
      };
    };
// @ts-expect-error Scoped unions retain exact policy checks.
configureUtils(base, { scoped: { users: { scoped: invalidUnionScope } } });
declare const validUnionPolicy:
  | { readonly staleTime: number }
  | { readonly retry: false };
configureUtils(base.users.read, { query: { policy: validUnionPolicy } });
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
