import { randomUUID } from "node:crypto";

import { User, UserPage } from "@effect-api-query/contracts";
import type { SeedUser } from "@effect-api-query/contracts";
import { Effect, Ref } from "effect";

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

const initialState = (): ServerState => ({
  nextUserId: initialUsers.length + 1,
  users: initialUsers.map((user, index) => makeUser(index + 1, user)),
});

const makeUser = (
  id: number,
  { locale, name }: Pick<SeedUser, "name" | "locale">
): User =>
  new User({ id, locale: locale ?? "en", name, revision: randomUUID() });

export const makeUsers = Effect.fn("ExampleUsers.make")(function* () {
  const state = yield* Ref.make(initialState());
  return {
    reset: Ref.update(state, initialState),
    seed: Effect.fn("ExampleUsers.seed")(
      ({ users }: { readonly users: readonly SeedUser[] }) =>
        Ref.modify(state, (current) => {
          const seeded = users.map((user, index) => makeUser(index + 1, user));
          return [
            seeded,
            {
              ...current,
              nextUserId: seeded.length + 1,
              users: seeded,
            },
          ] as const;
        })
    ),
    create: Effect.fn("ExampleUsers.create")((payload: SeedUser) =>
      Ref.modify(state, (current) => {
        const user = makeUser(current.nextUserId, payload);
        return [
          user,
          {
            ...current,
            nextUserId: current.nextUserId + 1,
            users: [...current.users, user],
          },
        ] as const;
      })
    ),
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
    get: Effect.fn("ExampleUsers.get")(
      ({ id, locale }: { readonly id: number; readonly locale?: string }) =>
        Ref.get(state).pipe(
          Effect.flatMap((current) => {
            const user = current.users.find((candidate) => candidate.id === id);
            return user === undefined
              ? Effect.fail("user-not-found" as const)
              : Effect.succeed(
                  new User({
                    id: user.id,
                    revision: user.revision,
                    name: user.name,
                    locale: locale ?? "en",
                  })
                );
          })
        )
    ),
    list: Effect.fn("ExampleUsers.list")(() =>
      Ref.get(state).pipe(Effect.map((current) => current.users))
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
