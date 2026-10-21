import {
  CommandStatus,
  ExampleAuthorization,
  ExampleHttpAuthorization,
  User,
  UserPage,
  exampleHttpApi,
  exampleRpcGroup,
} from "@effect-api-query/contracts";
import type { CommandPayload } from "@effect-api-query/contracts";
import type { ExampleRpcClient } from "@effect-api-query/contracts/client";
import type { QueryClient } from "@tanstack/query-core";
import { Deferred, Effect, Exit, Layer, Queue, Scope, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import type { RpcClientError } from "effect/rpc";

import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
} from "#effect-api-query";

import type { ViteReactApplication } from "../../examples/vite-react/src/lib/application.ts";
import {
  makeOwnerCache,
  ownerKeyPrefix,
} from "../../examples/vite-react/src/lib/owner-cache.ts";
import {
  makeUsersInvalidator,
  makeUserWrites,
} from "../../examples/vite-react/src/lib/user-writes.ts";

export interface CreateRequest {
  readonly name: string;
  readonly succeed: (user: User) => Promise<void>;
  readonly fail: () => Promise<void>;
}
export interface DeleteRequest {
  readonly id: number;
  readonly succeed: () => Promise<void>;
  readonly fail: () => Promise<void>;
}
export interface ListRequest {
  readonly signal: Deferred.Deferred<readonly User[]>;
  readonly succeed: (users: readonly User[]) => Promise<void>;
}

export interface ControlledUserWrites {
  readonly application: ViteReactApplication;
  readonly nextCreate: () => Promise<CreateRequest>;
  readonly nextDelete: () => Promise<DeleteRequest>;
  readonly nextList: () => Promise<ListRequest>;
  readonly holdLists: () => void;
  readonly seed: (users: readonly User[]) => void;
  readonly retire: () => void;
}

export const makeControlledUserWrites = Effect.fnUntraced(
  function* makeControlledUserWrites(
    queryClient: QueryClient,
    commandHandlers?: {
      readonly start: (input: CommandPayload) => Effect.Effect<CommandStatus>;
      readonly status: (input: {
        readonly operationId: string;
      }) => Effect.Effect<CommandStatus | null>;
    }
  ): Effect.fn.Return<ControlledUserWrites> {
    const scope = yield* Scope.make();
    const run = Effect.runPromiseWith(yield* Effect.context());
    const creates = yield* Queue.unbounded<CreateRequest>();
    const deletes = yield* Queue.unbounded<DeleteRequest>();
    const lists = yield* Queue.unbounded<ListRequest>();
    let holdLists = false;
    let users: readonly User[] = [];
    const create = Effect.fnUntraced(function* create({
      name,
    }: {
      readonly name: string;
    }) {
      const gate = yield* Deferred.make<User>();
      yield* Queue.offer(creates, {
        name,
        succeed: async (user) => {
          users = [
            ...users.filter((existing) => existing.id !== user.id),
            user,
          ];
          await run(Deferred.succeed(gate, user));
        },
        fail: async () => {
          await run(Deferred.interrupt(gate));
        },
      });
      return yield* Deferred.await(gate);
    });
    const remove = Effect.fnUntraced(function* remove({
      id,
    }: {
      readonly id: number;
    }) {
      const gate = yield* Deferred.make<boolean, "user-not-found">();
      yield* Queue.offer(deletes, {
        id,
        succeed: async () => {
          users = users.filter((user) => user.id !== id);
          await run(Deferred.succeed(gate, true));
        },
        fail: async () => {
          await run(Deferred.fail(gate, "user-not-found"));
        },
      });
      yield* Deferred.await(gate);
    });
    const list = Effect.fnUntraced(function* list() {
      if (!holdLists) {
        return users;
      }
      const gate = yield* Deferred.make<readonly User[]>();
      yield* Queue.offer(lists, {
        signal: gate,
        succeed: async (snapshot) => {
          await run(Deferred.succeed(gate, snapshot));
        },
      });
      return yield* Deferred.await(gate);
    });
    const page = ({
      cursor,
      pageSize,
    }: {
      readonly cursor: number;
      readonly pageSize: number;
    }) =>
      Effect.succeed(
        new UserPage({
          users: users.slice(cursor, cursor + pageSize),
          total: users.length,
          nextCursor:
            cursor + pageSize < users.length ? cursor + pageSize : null,
        })
      );
    const get = ({
      id,
      locale,
    }: {
      readonly id: number;
      readonly locale?: string | undefined;
    }) => {
      const user = users.find((candidate) => candidate.id === id);
      return user === undefined
        ? Effect.fail("user-not-found" as const)
        : Effect.succeed(
            new User({ id: user.id, name: user.name, locale: locale ?? "en" })
          );
    };
    const rpcClient: ExampleRpcClient = yield* RpcTest.makeClient(
      exampleRpcGroup,
      {
        flatten: true,
      }
    ).pipe(
      Effect.provide(
        exampleRpcGroup.toLayer({
          "users.create": create,
          "users.delete": remove,
          "users.list": list,
          "users.get": get,
          "users.page": page,
          "testing.reset": () => Effect.void,
          "testing.seed": () => Effect.succeed(users),
          "diagnostics.stream": () => Stream.empty,
          "diagnostics.fail": () => Effect.die("unused diagnostic"),
          "diagnostics.cancel": () => Effect.void,
          "diagnostics.slow": () => Effect.succeed("done"),
          "diagnostics.status": () =>
            Effect.succeed({ started: 0, interrupted: 0 }),
          "diagnostics.operationStatus": () =>
            Effect.succeed({ started: 0, interrupted: 0 }),
          "commands.start":
            commandHandlers?.start ??
            (({ operationId, steps }) =>
              Effect.succeed(
                new CommandStatus({
                  operationId,
                  totalSteps: steps,
                  completedSteps: steps,
                  state: "completed",
                })
              )),
          "commands.status":
            commandHandlers?.status ?? (() => Effect.succeed(null)),
          "commands.cancel": ({ operationId }) =>
            Effect.succeed(
              new CommandStatus({
                operationId,
                totalSteps: 0,
                completedSteps: 0,
                state: "cancelled",
              })
            ),
        })
      ),
      Effect.provideService(
        ExampleAuthorization,
        ExampleAuthorization.of((effect) => effect)
      ),
      Scope.provide(scope)
    );
    const httpHandlers = HttpApiBuilder.group(
      exampleHttpApi,
      "users",
      (group) =>
        group
          .handle("create", ({ payload }) => create(payload))
          .handle("delete", ({ params }) => remove(params))
          .handle("get", ({ params, query }) => get({ ...params, ...query }))
          .handle("list", list)
          .handle("page", ({ query }) => page(query))
    );
    const diagnostics = HttpApiBuilder.group(
      exampleHttpApi,
      "diagnostics",
      (group) =>
        group
          .handle("fail", () => Effect.die("unused diagnostic"))
          .handle("slow", () => Effect.succeed("done"))
          .handle("status", () =>
            Effect.succeed({ started: 0, interrupted: 0 })
          )
          .handle("operationStatus", () =>
            Effect.succeed({ started: 0, interrupted: 0 })
          )
    );
    const httpClient = yield* HttpApiTest.groups(exampleHttpApi, [
      "users",
      "diagnostics",
    ]).pipe(
      Effect.provide(
        Layer.mergeAll(httpHandlers, diagnostics, HttpServer.layerServices)
      ),
      Effect.provideService(
        ExampleHttpAuthorization,
        ExampleHttpAuthorization.of((effect) => effect)
      ),
      Scope.provide(scope)
    );
    const identity = {
      tenantId: "example-team",
      userId: "example-user",
      sessionGeneration: 1,
      permissionGeneration: 1,
    };
    const keyPrefix = ownerKeyPrefix(identity);
    const rpcQuery = createRpcQueryUtils<
      typeof exampleRpcGroup,
      ReturnType<typeof ownerKeyPrefix>,
      RpcClientError.RpcClientError
    >(exampleRpcGroup, {
      client: rpcClient,
      keyPrefix,
    });
    const httpQuery = createHttpApiQueryUtils(exampleHttpApi, {
      client: httpClient,
      keyPrefix,
    });
    const owner = makeOwnerCache({
      identity,
      queryClient,
      directoryKeys: {
        rpc: rpcQuery.users.list.queryKey(),
        http: httpQuery.users.list.queryKey(),
      },
    });
    const { isActive, runMutation, persistDirectory, trackMutationOptions } =
      owner;
    const invalidateUsers = makeUsersInvalidator({
      queryClient,
      rpcQuery,
      httpQuery,
      isActive,
    });
    const userWrites = makeUserWrites({
      queryClient,
      rpcQuery,
      httpQuery,
      isActive,
      invalidateUsers,
      trackMutationOptions,
    });
    const dispose = async () => {
      try {
        await owner.retire();
      } finally {
        await run(Scope.close(scope, Exit.void));
      }
    };
    return {
      application: {
        queryClient,
        rpcQuery,
        httpQuery,
        userWrites,
        identity: owner.identity,
        persistDirectory,
        trackMutationOptions,
        isActive,
        runMutation,
        invalidateUsers,
        dispose,
      },
      nextCreate: async () => await run(Queue.take(creates)),
      nextDelete: async () => await run(Queue.take(deletes)),
      nextList: async () => await run(Queue.take(lists)),
      holdLists: () => {
        holdLists = true;
      },
      seed: (data: readonly User[]) => {
        users = data;
      },
      retire: () => {
        void owner.retire();
      },
    };
  }
);
