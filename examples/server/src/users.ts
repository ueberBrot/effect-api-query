import { randomUUID } from "node:crypto";

import {
  DirectoryCapacityExceeded,
  directoryLimits,
  DirectoryWriteQuotaExceeded,
  InvalidUserInput,
  User,
  UserLocale,
  UserPage,
  UserWriteInput,
} from "@effect-api-query/contracts";
import { Clock, Effect, Ref, Result, Schema } from "effect";

export const directoryWriteQuota = { creates: 128, windowMs: 60_000 } as const;

const initialUsers = [
  { locale: "en", name: "Ada Lovelace" },
  { locale: "nl", name: "Edsger Dijkstra" },
  { locale: "en", name: "Alan Turing" },
  { locale: "en", name: "Barbara Liskov" },
  { locale: "en", name: "Donald Knuth" },
  { locale: "en", name: "Radia Perlman" },
  { locale: "de", name: "Hedy Lamarr" },
  { locale: "en", name: "John Backus" },
  { locale: "en", name: "Mary Jackson" },
  { locale: "en", name: "Dennis Ritchie" },
  { locale: "en", name: "Annie Easley" },
  { locale: "en", name: "James Gosling" },
] as const satisfies readonly UserInput[];

interface ServerState {
  readonly createWindow: {
    readonly accepted: number;
    readonly expiresAt: number;
  };
  readonly nextUserId: number;
  readonly users: readonly User[];
}

type UserInput = typeof UserWriteInput.Type;
type CreateLimitError =
  | typeof DirectoryCapacityExceeded.Type
  | typeof DirectoryWriteQuotaExceeded.Type;

const isUserInput = Schema.is(UserWriteInput);
const isSeedInput = Schema.is(Schema.Array(UserWriteInput));
const isUserLocale = Schema.is(UserLocale);

const initialState = (): ServerState => ({
  createWindow: { accepted: 0, expiresAt: 0 },
  nextUserId: initialUsers.length + 1,
  users: initialUsers.map((user, index) => makeUser(index + 1, user)),
});

const makeUser = (id: number, { locale, name }: UserInput): User =>
  new User({ id, locale: locale ?? "en", name, revision: randomUUID() });

export const makeUsers = Effect.fn("ExampleUsers.make")(function* () {
  const state = yield* Ref.make(initialState());
  return {
    reset: Ref.update(state, initialState),
    seed: Effect.fn("ExampleUsers.seed")(function* ({
      users,
    }: {
      readonly users: readonly UserInput[];
    }) {
      if (users.length > directoryLimits.users) {
        return yield* Effect.fail(DirectoryCapacityExceeded.literal);
      }
      if (!isSeedInput(users)) {
        return yield* Effect.fail(InvalidUserInput.literal);
      }
      const seeded = Object.freeze(
        users.map((user, index) => makeUser(index + 1, user))
      );
      yield* Ref.update(state, (current) => ({
        ...current,
        nextUserId: seeded.length + 1,
        users: seeded,
      }));
      return seeded;
    }),
    create: Effect.fn("ExampleUsers.create")(function* (payload: UserInput) {
      if (!isUserInput(payload)) {
        return yield* Effect.fail(InvalidUserInput.literal);
      }
      const now = yield* Clock.currentTimeMillis;
      return yield* Ref.modify<
        ServerState,
        Result.Result<User, CreateLimitError>
      >(state, (current) => {
        if (current.users.length >= directoryLimits.users) {
          return [
            Result.fail(DirectoryCapacityExceeded.literal),
            current,
          ] as const;
        }
        const window =
          now < current.createWindow.expiresAt
            ? current.createWindow
            : { accepted: 0, expiresAt: now + directoryWriteQuota.windowMs };
        if (window.accepted >= directoryWriteQuota.creates) {
          return [
            Result.fail(DirectoryWriteQuotaExceeded.literal),
            current,
          ] as const;
        }
        const user = makeUser(current.nextUserId, payload);
        return [
          Result.succeed(user),
          {
            createWindow: { ...window, accepted: window.accepted + 1 },
            nextUserId: current.nextUserId + 1,
            users: [...current.users, user],
          },
        ] as const;
      }).pipe(Effect.flatMap(Effect.fromResult));
    }),
    delete: Effect.fn("ExampleUsers.delete")(
      ({ id, revision }: Pick<User, "id" | "revision">) =>
        Ref.modify(state, (current) => {
          const exists = current.users.some(
            (user) => user.id === id && user.revision === revision
          );
          return [
            exists,
            exists
              ? {
                  ...current,
                  users: current.users.filter((user) => user.id !== id),
                }
              : current,
          ] as const;
        }).pipe(
          Effect.flatMap((exists) =>
            exists ? Effect.void : Effect.fail("user-not-found" as const)
          )
        )
    ),
    get: Effect.fn("ExampleUsers.get")(function* ({
      id,
      locale,
    }: {
      readonly id: number;
      readonly locale?: string;
    }) {
      if (locale !== undefined && !isUserLocale(locale)) {
        return yield* Effect.fail(InvalidUserInput.literal);
      }
      const current = yield* Ref.get(state);
      const user = current.users.find((candidate) => candidate.id === id);
      if (user === undefined) {
        return yield* Effect.fail("user-not-found" as const);
      }
      return new User({
        id: user.id,
        name: user.name,
        revision: user.revision,
        locale: locale ?? "en",
      });
    }),
    list: Effect.fn("ExampleUsers.list")(() =>
      Ref.get(state).pipe(
        Effect.map((current) =>
          current.users.slice(0, directoryLimits.previewSize)
        )
      )
    ),
    page: Effect.fn("ExampleUsers.page")(
      ({
        cursor,
        pageSize,
      }: {
        readonly cursor: number;
        readonly pageSize: number;
      }) =>
        Ref.get(state).pipe(
          Effect.map((current) => {
            const nextCursor = cursor + pageSize;
            return new UserPage({
              nextCursor: nextCursor < current.users.length ? nextCursor : null,
              total: current.users.length,
              users: current.users.slice(cursor, nextCursor),
            });
          })
        )
    ),
  };
});
