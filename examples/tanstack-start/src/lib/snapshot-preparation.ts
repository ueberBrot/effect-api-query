import { exampleHttpApi, exampleRpcGroup } from "@effect-api-query/contracts";
import type { DehydratedState } from "@tanstack/react-query";
import {
  createContractHydrationRegistry,
  createHydrationRegistry,
} from "@ueberbrot/effect-api-query";
import { Effect, Schema } from "effect";

import type { TanStackStartApplication } from "./application.ts";

export interface SnapshotPreparation {
  readonly beforeEncode: Effect.Effect<void>;
  readonly beforeDecode: Effect.Effect<void>;
}

export interface SnapshotCodecs {
  readonly encode: (
    queries: DehydratedState["queries"]
  ) => Promise<DehydratedState["queries"]>;
  readonly decode: (
    queries: DehydratedState["queries"]
  ) => Promise<DehydratedState["queries"]>;
}

export const makeSnapshotPreparation = (
  { keyPrefix, runPreparation }: TanStackStartApplication,
  services: SnapshotPreparation
): SnapshotCodecs => {
  const paths = { "users.page": { infinite: { pageParam: Schema.Int } } };
  const registry = createHydrationRegistry([
    createContractHydrationRegistry(exampleRpcGroup, { keyPrefix, paths }),
    createContractHydrationRegistry(exampleHttpApi, { keyPrefix, paths }),
  ]);
  return {
    encode: async (queries) =>
      await runPreparation(
        services.beforeEncode.pipe(
          Effect.andThen(registry.encodeQueries(queries))
        )
      ),
    decode: async (queries) =>
      await runPreparation(
        services.beforeDecode.pipe(
          Effect.andThen(registry.decodeQueries(queries))
        )
      ),
  };
};
