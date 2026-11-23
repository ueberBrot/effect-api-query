import type { QueryClient } from "@tanstack/query-core";
import {
  bindReactivityInvalidation,
  createRpcQueryUtils,
  QueryClientService,
} from "@ueberbrot/effect-api-query";
import type {
  ReactivityInvalidationBinding,
  ReactivityInvalidationOptions,
} from "@ueberbrot/effect-api-query";
import { Effect, Schema } from "effect";
import type { Scope } from "effect";
import { Reactivity } from "effect/reactivity";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

declare module "effect/reactivity/Reactivity" {
  interface Keys {
    readonly groups: number;
    readonly [key: `users:${number}`]: never;
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

type AppKeys = Assert<
  Equal<keyof Reactivity.Keys, "groups" | `users:${number}`>
>;
type BindingKeys = Assert<
  Equal<ReactivityInvalidationBinding["keys"], Reactivity.KeysInput>
>;
type RejectUnknownName = Assert<
  Equal<
    readonly ["unknown"] extends ReactivityInvalidationBinding["keys"]
      ? true
      : false,
    false
  >
>;
type RejectWrongId = Assert<
  Equal<
    {
      readonly groups: readonly ["1"];
    } extends ReactivityInvalidationBinding["keys"]
      ? true
      : false,
    false
  >
>;

const group = RpcGroup.make(
  Rpc.make("users.read", {
    payload: { id: Schema.Int },
    success: Schema.String,
  })
);
declare const client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof group>>;
declare const queryClient: QueryClient;
const users = createRpcQueryUtils(group, { client, keyPrefix: ["tenant"] });
const bindings = [
  {
    keys: ["users:1"],
    filter: users.users.read.queryFilter({ view: "query", input: { id: 1 } }),
  },
  {
    keys: { groups: [1] },
    filter: [users.queryFilter(), users.users.queryFilter()],
    options: { cancelRefetch: false },
  },
] as const satisfies readonly ReactivityInvalidationBinding[];

type OriginalFailure = Assert<
  Equal<
    Parameters<NonNullable<ReactivityInvalidationOptions["onError"]>>[0],
    unknown
  >
>;
const options = {
  invalidateOptions: { throwOnError: true },
  isActive: () => true,
} satisfies ReactivityInvalidationOptions;
const bridge = bindReactivityInvalidation(bindings, options);
type Bridge = Assert<
  Equal<
    typeof bridge,
    Effect.Effect<
      { readonly flush: Effect.Effect<void> },
      never,
      Scope.Scope | Reactivity.Reactivity | QueryClientService
    >
  >
>;

const scoped = Effect.scoped(Effect.flatMap(bridge, ({ flush }) => flush)).pipe(
  Effect.provide(Reactivity.layer),
  Effect.provideService(QueryClientService, queryClient)
);
type Scoped = Assert<Equal<typeof scoped, Effect.Effect<void>>>;
