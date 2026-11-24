import {
  exampleHttpApi,
  ExampleHttpAuthorization,
  SeedUser,
} from "@effect-api-query/contracts";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { requireDemoWriter } from "./caller.ts";
import { ExampleDomain } from "./domain.ts";

const usersRoutes = HttpApiBuilder.group(
  exampleHttpApi,
  "users",
  Effect.fn(function* (handlers) {
    const { users } = yield* ExampleDomain;
    return handlers.handleAll({
      list: () => users.list(),
      get: ({ params, query }) => users.get({ ...params, ...query }),
      create: ({ payload }) => users.create(new SeedUser(payload)),
      delete: ({ params, query }) => users.delete({ ...params, ...query }),
      page: ({ query }) => users.page(query),
    });
  })
);

const diagnosticRoutes = HttpApiBuilder.group(
  exampleHttpApi,
  "diagnostics",
  Effect.fn(function* (handlers) {
    const { diagnostics } = yield* ExampleDomain;
    return handlers.handleAll({
      fail: () => diagnostics.fail,
      operationStatus: ({ params }) =>
        diagnostics.operationStatus(params.operationId),
      slow: ({ query }) => diagnostics.slow(query),
      status: () => diagnostics.status,
    });
  })
);

export const exampleHttpAuthorization = Layer.succeed(
  ExampleHttpAuthorization,
  ExampleHttpAuthorization.of((effect) =>
    Effect.andThen(requireDemoWriter, effect)
  )
);

export const exampleHttpRoutes = HttpApiBuilder.layer(exampleHttpApi).pipe(
  Layer.provide([usersRoutes, diagnosticRoutes])
);
