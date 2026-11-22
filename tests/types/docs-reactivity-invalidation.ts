import { bindReactivityInvalidation } from "@ueberbrot/effect-api-query";

import type { directoryEffects } from "../../examples/shared/query-effects";

const bindDirectoryUser = (
  rpc: ReturnType<typeof directoryEffects>["rpc"],
  id: number
) =>
  bindReactivityInvalidation([
    {
      keys: [`users:${id}`],
      filter: rpc.users.read.queryFilter({ view: "query", input: { id } }),
    },
  ]);
