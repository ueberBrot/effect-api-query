import type { QueryClient } from "@tanstack/query-core";
import type { RpcQueryUtils } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const group = RpcGroup.make(
  Rpc.make("users.read", { success: Schema.Int }),
  Rpc.make("users.nested.read", { success: Schema.Int }),
  Rpc.make("users.watch", { success: Schema.Int, stream: true })
);
export type DashboardRpc = RpcQueryUtils<typeof group, readonly ["dashboard"]>;
export type DashboardClient = QueryClient;
