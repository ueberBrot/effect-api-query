import { createQueryDescriptor } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";

import type { ExampleRpcQueryUtils } from "./application.ts";

export const featuredUserDescriptor = (rpcQuery: ExampleRpcQueryUtils) =>
  createQueryDescriptor(rpcQuery.users.get, "query", {
    contract: "example-users-v1",
    input: Schema.Struct({
      id: Schema.Int,
      locale: Schema.optionalKey(Schema.String),
    }),
  });
