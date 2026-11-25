// @effect-diagnostics unstableApiUsage:off
import { directoryLimits, exampleHttpApi } from "@effect-api-query/contracts";
import { makeExampleRpcClient } from "@effect-api-query/contracts/client";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { TestClock } from "effect/testing";

import { makeUsers } from "../src/users.ts";
import { startExampleServerFixture } from "./fixtures/example-server.ts";

const longestUser = {
  name: "n".repeat(directoryLimits.nameLength),
  locale: "l".repeat(directoryLimits.localeLength),
};
const invalidUsers = [
  { ...longestUser, name: `${longestUser.name}n` },
  { ...longestUser, locale: `${longestUser.locale}l` },
];
const maxCreatesPerWindow = 128;
const createWindowMs = 60_000;

describe("example directory limits", () => {
  it.effect("validates writes before changing the shared store", () =>
    Effect.gen(function* boundDirectoryInput() {
      const users = yield* makeUsers();
      const before = yield* users.list();
      for (const invalid of invalidUsers) {
        expect(yield* Effect.flip(users.create(invalid))).toBe(
          "invalid-user-input"
        );
        expect(
          yield* Effect.flip(users.seed({ users: [longestUser, invalid] }))
        ).toBe("invalid-user-input");
      }
      expect(
        yield* Effect.flip(
          users.seed({
            users: Array.from(
              { length: directoryLimits.users + 1 },
              () => longestUser
            ),
          })
        )
      ).toBe("directory-capacity-exceeded");
      expect(yield* users.list()).toStrictEqual(before);
      expect(yield* users.create(longestUser)).toMatchObject({
        ...longestUser,
        id: before.length + 1,
      });
    })
  );

  it.effect(
    "keeps the create quota until the window expires after deletions",
    () =>
      Effect.gen(function* expireDirectoryWriteQuota() {
        const users = yield* makeUsers();
        const initial = yield* users.list();
        for (let index = 0; index < maxCreatesPerWindow; index += 1) {
          const { id, revision } = yield* users.create(longestUser);
          yield* users.delete({ id, revision });
        }
        yield* TestClock.adjust(createWindowMs - 1);
        expect(yield* Effect.flip(users.create(longestUser))).toBe(
          "directory-write-quota-exceeded"
        );
        expect(yield* users.list()).toStrictEqual(initial);
        yield* TestClock.adjust(1);
        expect(yield* users.create(longestUser)).toMatchObject({
          ...longestUser,
          id: initial.length + maxCreatesPerWindow + 1,
        });
      })
  );

  it.effect("shares the last write slot across RPC and HTTP", () =>
    Effect.gen(function* shareWriteCapacity() {
      const { server, seed, writeToken } = yield* startExampleServerFixture();
      const rpc = yield* makeExampleRpcClient(server.rpcUrl);
      const http = yield* HttpApiClient.make(exampleHttpApi, {
        baseUrl: server.url,
      }).pipe(Effect.provide(FetchHttpClient.layer));
      const seeded = yield* seed({
        users: Array.from(
          { length: directoryLimits.users - 1 },
          (_, index) => ({
            name: `User ${String(index + 1)}`,
          })
        ),
      });
      const results = yield* Effect.all(
        [
          Effect.result(rpc["users.create"](longestUser)),
          Effect.result(http.users.create({ payload: longestUser })),
        ],
        { concurrency: 2 }
      );
      expect(
        results.map((result) =>
          result._tag === "Success" ? "created" : result.failure
        )
      ).toStrictEqual(
        expect.arrayContaining(["created", "directory-capacity-exceeded"])
      );
      expect({
        rpc: yield* Effect.flip(rpc["users.create"]({ name: "Extra RPC" })),
        http: yield* Effect.flip(
          http.users.create({ payload: { name: "Extra HTTP" } })
        ),
      }).toStrictEqual({
        rpc: "directory-capacity-exceeded",
        http: "directory-capacity-exceeded",
      });

      const expectedPreview = seeded.slice(0, directoryLimits.previewSize);
      expect({
        rpc: yield* rpc["users.list"](),
        http: yield* http.users.list(),
      }).toStrictEqual({ rpc: expectedPreview, http: expectedPreview });
      expect(
        yield* rpc["users.page"]({
          cursor: directoryLimits.users - 2,
          pageSize: 4,
        })
      ).toMatchObject({
        total: directoryLimits.users,
        nextCursor: null,
        users: [
          { id: directoryLimits.users - 1 },
          { id: directoryLimits.users, ...longestUser },
        ],
      });

      const { id, revision } = yield* rpc["users.get"]({ id: 1 });
      yield* http.users.delete({ params: { id }, query: { revision } }).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, {
          headers: { authorization: `Bearer ${writeToken}` },
        })
      );
      expect({
        replacement: yield* rpc["users.create"]({ name: "Replacement" }),
        firstPage: yield* http.users.page({
          query: { cursor: 0, pageSize: directoryLimits.previewSize },
        }),
      }).toMatchObject({
        replacement: { id: directoryLimits.users + 1, locale: "en" },
        firstPage: {
          total: directoryLimits.users,
          nextCursor: directoryLimits.previewSize,
          users: seeded.slice(1, directoryLimits.previewSize + 1),
        },
      });
    })
  );

  it.effect("rejects oversized fields through RPC and HTTP contracts", () =>
    Effect.gen(function* validateContractInputs() {
      const { server } = yield* startExampleServerFixture();
      const rpc = yield* makeExampleRpcClient(server.rpcUrl);
      const http = yield* HttpApiClient.make(exampleHttpApi, {
        baseUrl: server.url,
      }).pipe(Effect.provide(FetchHttpClient.layer));

      for (const invalid of invalidUsers) {
        expect(
          Exit.hasDies(yield* Effect.exit(rpc["users.create"](invalid)))
        ).toBe(true);
        const response = yield* Effect.promise(
          async () =>
            await fetch(`${server.httpApiUrl}/users`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(invalid),
            })
        );
        expect(response.status).toBe(400);
      }
      expect(yield* http.users.list()).toHaveLength(12);
      expect(yield* http.users.create({ payload: longestUser })).toMatchObject(
        longestUser
      );
    })
  );
});
