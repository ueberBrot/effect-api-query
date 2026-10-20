import { QueryClient } from "@tanstack/react-query";
import type { MutationFunctionContext } from "@tanstack/react-query";

import { makeOwnerCache } from "../../examples/vite-react/src/lib/owner-cache.ts";

const queryClient = new QueryClient();
const owner = makeOwnerCache({
  identity: {
    tenantId: "a",
    userId: "b",
    sessionGeneration: 0,
    permissionGeneration: 0,
  },
  queryClient,
  directoryKeys: { rpc: ["rpc"], http: ["http"] },
});
const generated = owner.trackMutationOptions({
  mutationKey: ["create"] as const,
  mutationFn: async (input: { readonly name: string }) => ({ id: 1, ...input }),
  networkMode: "online" as const,
  retry: 3,
});
generated.mutationKey satisfies readonly ["create"];
generated.mutationFn({ name: "Ada" }) satisfies Promise<{
  readonly id: number;
  readonly name: string;
}>;
generated.networkMode satisfies "always";
generated.retry satisfies false;
// @ts-expect-error The tracked function preserves required variables.
generated.mutationFn();
// @ts-expect-error The generated function keeps its original arity.
generated.mutationFn({ name: "Ada" }, {});

const native = owner.trackMutationOptions({
  mutationFn: async (input: number, context: MutationFunctionContext) => ({
    input,
    client: context.client,
  }),
});
native.mutationFn(1, {
  client: queryClient,
  meta: undefined,
}) satisfies Promise<{
  readonly input: number;
  readonly client: QueryClient;
}>;
// @ts-expect-error The native function preserves its required context.
native.mutationFn(1);
// @ts-expect-error Tracking does not invent an absent key.
native.mutationKey;
