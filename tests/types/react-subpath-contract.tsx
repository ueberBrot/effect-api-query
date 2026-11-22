import { QueryClient } from "@tanstack/query-core";
import {
  acquireQueryOwner,
  createRpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import type { QueryOwner } from "@ueberbrot/effect-api-query";
import {
  createQueryUtilsContext,
  QueryOwnerProvider,
  useQueryOwner,
} from "@ueberbrot/effect-api-query/react";
import type {
  QueryOwnerProviderProps,
  QueryUtilsContext,
  QueryUtilsProviderProps,
} from "@ueberbrot/effect-api-query/react";
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

const group = RpcGroup.make(
  Rpc.make("ping", {
    success: Schema.String,
  })
);
declare const rpcClient: RpcClient.RpcClient<RpcGroup.Rpcs<typeof group>>;
const utils = createRpcQueryUtils(group, { client: rpcClient });
type AppUtils = typeof utils;

const appContext = createQueryUtilsContext<AppUtils>({
  displayName: "AppQueryUtils",
});
appContext satisfies QueryUtilsContext<AppUtils>;

const unnamedContext = createQueryUtilsContext<AppUtils>();
unnamedContext satisfies QueryUtilsContext<AppUtils>;

const { Provider, useQueryUtils } = appContext;

declare const owner: QueryOwner<AppUtils>;
declare const otherOwner: QueryOwner<{ readonly other: true }>;
declare const client: QueryClient;

const ownerElement = (
  <Provider owner={owner}>
    <div />
  </Provider>
);
void ownerElement;

const ownerWithoutClientElement = (
  <Provider owner={owner} provideQueryClient={false}>
    <div />
  </Provider>
);
void ownerWithoutClientElement;

const utilsOnlyElement = (
  <Provider utils={utils}>
    <div />
  </Provider>
);
void utilsOnlyElement;

const utilsWithClientElement = (
  <Provider client={client} utils={utils}>
    <div />
  </Provider>
);
void utilsWithClientElement;

const queryOwnerProviderElement = (
  <QueryOwnerProvider owner={owner}>
    <div />
  </QueryOwnerProvider>
);
void queryOwnerProviderElement;

const queryOwnerProviderNoClient = (
  <QueryOwnerProvider owner={owner} provideQueryClient={false}>
    <div />
  </QueryOwnerProvider>
);
void queryOwnerProviderNoClient;

const ownerProps: QueryOwnerProviderProps = {
  owner,
  provideQueryClient: true,
};
void ownerProps;

const providerOwnerProps: QueryUtilsProviderProps<AppUtils> = {
  owner,
  provideQueryClient: false,
};
void providerOwnerProps;

const providerUtilsProps: QueryUtilsProviderProps<AppUtils> = {
  utils,
  client,
};
void providerUtilsProps;

function Consumer() {
  const readUtils = useQueryUtils();
  const readOwner = useQueryOwner();
  true satisfies Assert<Equal<typeof readUtils, AppUtils>>;
  true satisfies Assert<Equal<typeof readOwner, QueryOwner<unknown>>>;
  return null;
}
void Consumer;

const acquiredOwner = await acquireQueryOwner(async (setup) =>
  setup.borrow(utils)
);
const acquiredElement = (
  <Provider owner={acquiredOwner}>
    <div />
  </Provider>
);
void acquiredElement;

// @ts-expect-error Provider requires either owner or utils.
const missingBoth = <Provider />;
void missingBoth;

// @ts-expect-error Provider rejects mixing owner and utils.
const mixedOwnerAndUtils = <Provider owner={owner} utils={utils} />;
void mixedOwnerAndUtils;

// @ts-expect-error Provider rejects passing client in owner mode.
const ownerWithClient = <Provider client={client} owner={owner} />;
void ownerWithClient;

const utilsWithProvideQueryClient = (
  // @ts-expect-error Provider rejects provideQueryClient in utils mode.
  <Provider provideQueryClient={false} utils={utils} />
);
void utilsWithProvideQueryClient;

// @ts-expect-error Provider enforces owner resource type matches Utils.
const wrongOwnerType = <Provider owner={otherOwner} />;
void wrongOwnerType;

// @ts-expect-error Provider enforces utils type matches Utils.
const wrongUtilsType = <Provider utils={{ wrong: true }} />;
void wrongUtilsType;
