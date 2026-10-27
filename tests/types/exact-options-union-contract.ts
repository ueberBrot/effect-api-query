import {
  configureUtils,
  createRpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

const group = RpcGroup.make(
  Rpc.make("read", { payload: { id: Schema.Int }, success: Schema.Int })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, {
  client,
  keyPrefix: ["exact-options"],
});
type Input = { readonly id: number };
declare const options:
  | { readonly input: Input; readonly retry: false }
  | {
      readonly input: Input;
      readonly retry: false;
      readonly queryKey: readonly ["replacement"];
    };
// @ts-expect-error Every options union member must preserve generated identity.
rpc.read.queryOptions(options);

declare const infinite:
  | {
      readonly input: (page: number) => Input;
      readonly initialPageParam: number;
      readonly getNextPageParam: () => number;
    }
  | {
      readonly input: (page: number) => Input;
      readonly initialPageParam: number;
      readonly getNextPageParam: () => number;
      readonly queryFn: () => Promise<number>;
    };
// @ts-expect-error Generated functions remain excluded in every union member.
rpc.read.infiniteOptions(infinite);

declare const validOptions:
  | { readonly input: Input; readonly staleTime: number }
  | { readonly input: Input; readonly retry: false };
rpc.read.queryOptions(validOptions);

declare const policy:
  | { readonly staleTime: number }
  | {
      readonly staleTime: number;
      readonly select: (value: number) => string;
    };
// @ts-expect-error Every policy union member must keep observer selection local.
configureUtils(rpc.read, { query: { policy } });

declare const validPolicy:
  | { readonly staleTime: number }
  | { readonly retry: false };
configureUtils(rpc.read, { query: { policy: validPolicy } });

const configured = configureUtils(rpc.read, {
  mutation: { policy: { retry: false } },
});
const replacementFn = { retry: false, mutationFn: async () => 1 };
const replacementKey = { retry: false, mutationKey: ["replacement"] };
// @ts-expect-error Stored options cannot replace the generated mutation function.
rpc.read.mutationOptions(replacementFn);
// @ts-expect-error Stored options cannot replace the generated mutation key.
rpc.read.mutationOptions(replacementKey);
// @ts-expect-error Configured builders preserve the generated mutation function.
configured.mutationOptions(replacementFn);
// @ts-expect-error Configured builders preserve the generated mutation key.
configured.mutationOptions(replacementKey);

declare const mutationFnUnion:
  | { readonly retry: false }
  | { readonly retry: false; readonly mutationFn: () => Promise<number> };
declare const mutationKeyUnion:
  | { readonly retry: false }
  | { readonly retry: false; readonly mutationKey: readonly ["replacement"] };
// @ts-expect-error Every union member must preserve the generated mutation function.
rpc.read.mutationOptions(mutationFnUnion);
// @ts-expect-error Every union member must preserve the generated mutation key.
configured.mutationOptions(mutationKeyUnion);

declare const validMutationUnion:
  | { readonly retry: false }
  | { readonly gcTime: number };
rpc.read.mutationOptions(validMutationUnion);
configured.mutationOptions(validMutationUnion);
configured.mutationOptions({
  onMutate: (variables) => ({ previous: variables.id }),
  onSuccess: (_data, _variables, result) => {
    result.previous satisfies number;
  },
  onError: (_error, _variables, result) => {
    result?.previous satisfies number | undefined;
  },
});
