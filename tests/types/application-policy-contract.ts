import { User } from "@effect-api-query/contracts";
import type { exampleRpcGroup } from "@effect-api-query/contracts";
import { QueryClient } from "@tanstack/query-core";
import type { RpcClient, RpcGroup } from "effect/rpc";

import {
  applicationQueries,
  applicationPolicy,
} from "../../examples/shared/application-policy";

declare const client: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof exampleRpcGroup>
>;
const application = applicationQueries(
  client,
  new QueryClient(),
  (name, requestedName) => {
    name satisfies string;
    requestedName satisfies string;
  }
);
applicationPolicy.query.policy.retry satisfies false;
application
  .selectedUser(1)
  .select?.(new User({ id: 1, locale: "en", name: "Ada" })) satisfies
  | string
  | undefined;
application.pages.initialPageParam satisfies number;
// @ts-expect-error Selected user input retains its numeric ID contract.
application.selectedUser("1");
