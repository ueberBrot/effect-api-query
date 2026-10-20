import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const usersRpc = RpcGroup.make(
  Rpc.make("users.get", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  })
);
