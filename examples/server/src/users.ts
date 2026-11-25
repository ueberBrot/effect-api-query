import { randomUUID } from "node:crypto";

import {
  directoryLimits,
  SeedUser,
  User,
  UserLocale,
  UserPage,
} from "@effect-api-query/contracts";
import { Effect, Ref, Schema } from "effect";

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
] as const satisfies readonly Pick<SeedUser, "name" | "locale">[];

interface ServerState {
  readonly nextUserId: number;
  readonly users: readonly User[];
}

type UserInput = Pick<SeedUser, "name" | "locale">;

const UserFields = Schema.Struct(SeedUser.fields);
const isUserInput = Schema.is(UserFields);
const isSeedInput = Schema.is(Schema.Array(UserFields));
const isUserLocale = Schema.is(UserLocale);

const initialState = (): ServerState => ({
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
        return yield* Effect.fail("directory-capacity-exceeded" as const);
      }
      if (!isSeedInput(users)) {
        return yield* Effect.fail("invalid-user-input" as const);
      }
      const seeded = Object.freeze(
        users.map((user, index) => makeUser(index + 1, user))
      );
      yield* Ref.set(state, {
        nextUserId: seeded.length + 1,
        users: seeded,
      });
      return seeded;
    }),
    create: Effect.fn("ExampleUsers.create")(function* (payload: UserInput) {
      if (!isUserInput(payload)) {
        return yield* Effect.fail("invalid-user-input" as const);
      }
      const created = yield* Ref.modify(state, (current) => {
        if (current.users.length >= directoryLimits.users) {
          return [undefined, current] as const;
        }
        const user = makeUser(current.nextUserId, payload);
        return [
          user,
          {
            ...current,
            nextUserId: current.nextUserId + 1,
            users: [...current.users, user],
          },
        ] as const;
      });
      if (created === undefined) {
        return yield* Effect.fail("directory-capacity-exceeded" as const);
      }
      return created;
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
        return yield* Effect.fail("invalid-user-input" as const);
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
          current.users.slice(0, directoryLimits.firstPageSize)
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
