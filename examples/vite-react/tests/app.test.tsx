// @vitest-environment jsdom

import { CommandStatus, User } from "@effect-api-query/contracts";
import { startExampleRpcServer } from "@effect-api-query/server";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Deferred, Effect, Exit, Scope } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { makeControlledUserWrites } from "../../../tests/fixtures/optimistic-users.ts";
import { ViteReactExample } from "../src/app.tsx";
import { CommandsSection } from "../src/components/sections/commands-section.tsx";
import { QueriesSection } from "../src/components/sections/queries-section.tsx";
import { CreateUserForm } from "../src/components/users/create-user-form.tsx";
import { UserList } from "../src/components/users/user-list.tsx";
import { startViteReactApplication } from "../src/lib/application.ts";
import type { ViteReactApplication } from "../src/lib/application.ts";

const OptimisticUsers = ({
  application,
}: {
  readonly application: ViteReactApplication;
}) => {
  const users = useQuery(
    application.rpcQuery.users.list.queryOptions({ staleTime: Infinity })
  );
  return (
    <>
      <CreateUserForm application={application} />
      <UserList
        application={application}
        isSynced={users.dataUpdatedAt !== 0}
        users={users.data}
      />
    </>
  );
};

describe("plain Vite React integration", () => {
  let application: ViteReactApplication | undefined;
  let serverScope: Scope.Closeable | undefined;

  beforeEach(async () => {
    serverScope = await Effect.runPromise(Scope.make());
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(serverScope))
    );
    application = await startViteReactApplication({ rpcUrl: server.rpcUrl });
    render(<ViteReactExample application={application} />);
  });

  afterEach(async () => {
    cleanup();
    await application?.dispose();
    if (serverScope !== undefined) {
      await Effect.runPromise(Scope.close(serverScope, Exit.void));
    }
  });

  it("normalizes void query data", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Run void query" }));
    await expect(
      screen.findByText("Void query result: null")
    ).resolves.toBeDefined();
  });

  it("adds the user details submitted through the form", async () => {
    await expect(screen.findByText("Ada Lovelace")).resolves.toBeDefined();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Katherine Johnson" },
    });
    fireEvent.change(screen.getByLabelText("Locale (optional)"), {
      target: { value: "fr" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));

    await expect(
      screen.findByText("Added Katherine Johnson")
    ).resolves.toBeDefined();
    await expect(screen.findByText("Katherine Johnson")).resolves.toBeDefined();
    expect(screen.getByText("User 13, locale fr")).toBeDefined();
  });

  it("restores the selected user when deletion is unauthorized", async () => {
    await expect(screen.findByText("Edsger Dijkstra")).resolves.toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Edsger Dijkstra" })
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("users.delete");
    expect(screen.getByText("Edsger Dijkstra")).toBeDefined();
  });

  it("adds HTTP user details across both adapter views", async () => {
    await expect(
      screen.findByText("HTTP: Ada Lovelace")
    ).resolves.toBeDefined();
    fireEvent.change(screen.getByLabelText("HTTP name"), {
      target: { value: "Karen Spärck Jones" },
    });
    fireEvent.change(screen.getByLabelText("HTTP locale (optional)"), {
      target: { value: "de" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add HTTP user" }));
    await expect(
      screen.findByText("HTTP added Karen Spärck Jones")
    ).resolves.toBeDefined();
    await expect(
      screen.findByText("HTTP: Karen Spärck Jones")
    ).resolves.toBeDefined();
    await expect(
      screen.findByText("Karen Spärck Jones")
    ).resolves.toBeDefined();
    expect(screen.getByText("User 13, locale de")).toBeDefined();
  });

  it("invalidates the HTTP directory after RPC creation", async () => {
    await expect(
      screen.findByText("HTTP: Ada Lovelace")
    ).resolves.toBeDefined();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Margaret Hamilton" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    await expect(
      screen.findByText("HTTP: Margaret Hamilton")
    ).resolves.toBeDefined();
    await expect(
      screen.findByText("HTTP directory: 13 users")
    ).resolves.toBeDefined();
  });

  it("shows optimistic creation and removal, then restores a failed deletion beside the created user", async () => {
    cleanup();
    const fixture = await Effect.runPromise(makeControlledUserWrites());
    const owned = fixture.application;
    const ada = new User({
      id: 1,
      revision: "user-1",
      name: "Ada",
      locale: "en",
    });
    fixture.seed([ada]);
    owned.queryClient.setQueryData(owned.rpcQuery.users.list.queryKey(), [ada]);
    render(
      <QueryClientProvider client={owned.queryClient}>
        <OptimisticUsers application={owned} />
      </QueryClientProvider>
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: "Delete Ada" }));
      const deletion = await fixture.nextDelete();
      await waitFor(() => {
        expect(screen.queryByText("Ada", { exact: true })).toBeNull();
      });
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Grace" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      const creation = await fixture.nextCreate();
      const pendingGrace = await screen.findByText("Grace", { exact: true });
      expect({
        name: pendingGrace.textContent,
        disabled: screen
          .getByRole("button", { name: "Delete Grace" })
          .hasAttribute("disabled"),
      }).toStrictEqual({ name: "Grace", disabled: true });
      await creation.succeed(
        new User({ id: 2, revision: "user-2", name: "Grace", locale: "en" })
      );
      await expect(screen.findByText("Added Grace")).resolves.toBeDefined();
      await deletion.fail();
      const restoredAda = await screen.findByText("Ada", { exact: true });
      expect({
        restored: restoredAda.textContent,
        created: screen.getByText("Grace", { exact: true }).textContent,
      }).toStrictEqual({ restored: "Ada", created: "Grace" });
      expect(screen.getByRole("alert").textContent).toContain("users.delete");
    } finally {
      cleanup();
      await owned.dispose();
    }
  });
});

describe("featured user", () => {
  it("isolates a missing featured record and renders an empty directory", async () => {
    const { application } = await Effect.runPromise(
      makeControlledUserWrites({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
    );
    const list = application.rpcQuery.users.list.queryKey();
    application.queryClient.setQueryData(list, [
      new User({ id: 1, revision: "missing", name: "Missing", locale: "en" }),
    ]);
    render(
      <QueryClientProvider client={application.queryClient}>
        <QueriesSection application={application} />
      </QueryClientProvider>
    );
    try {
      await expect(
        screen.findByText("Featured user unavailable.")
      ).resolves.toBeDefined();
      expect(
        screen.getByRole("heading", { name: "Infinite query" })
      ).toBeDefined();
      application.queryClient.setQueryData(list, []);
      await expect(
        screen.findByText("No featured user.")
      ).resolves.toBeDefined();
      expect(
        screen.getByRole("button", { name: "Invalidate user queries" })
      ).toBeDefined();
    } finally {
      cleanup();
      await application.dispose();
    }
  });
});

const completedCommandStatus = (operationId: string) =>
  new CommandStatus({
    operationId,
    state: "completed",
    completedSteps: 40,
    totalSteps: 40,
  });

describe("cancellable command status", () => {
  it.each(["success", "error"] as const)(
    "reconciles a delayed reservation after a Start mutation settles as %s",
    async (mutationStatus) => {
      const finishStart = Deferred.makeUnsafe<boolean>();
      const deliverReservation = Deferred.makeUnsafe<null>();
      let statusReads = 0;
      const { application } = await Effect.runPromise(
        makeControlledUserWrites(undefined, {
          start: ({ operationId }) =>
            Deferred.await(finishStart).pipe(
              Effect.flatMap(() =>
                mutationStatus === "success"
                  ? Effect.succeed(completedCommandStatus(operationId))
                  : Effect.die(new Error("Start response was lost"))
              )
            ),
          status: ({ operationId }) =>
            Effect.suspend(() => {
              statusReads += 1;
              if (statusReads === 2) {
                return Deferred.await(deliverReservation);
              }
              return Effect.succeed(
                statusReads === 1 ? null : completedCommandStatus(operationId)
              );
            }),
        })
      );
      try {
        render(
          <QueryClientProvider client={application.queryClient}>
            <CommandsSection application={application} />
          </QueryClientProvider>
        );
        const command = within(
          screen.getByRole("region", { name: "Command 1" })
        );
        fireEvent.click(command.getByRole("button", { name: "Start command" }));
        await waitFor(() => {
          expect(statusReads).toBe(2);
        });

        await Effect.runPromise(Deferred.succeed(finishStart, true));
        await waitFor(() => {
          const query = application.queryClient.getQueryCache().find({
            queryKey: application.rpcQuery.commands.status.key(),
            exact: false,
          });
          expect(query?.state.isInvalidated).toBe(true);
        });
        await Effect.runPromise(Deferred.succeed(deliverReservation, null));

        await expect(
          command.findByText(`Start mutation: ${mutationStatus}`)
        ).resolves.toBeDefined();
        await expect(
          command.findByText("Server state: completed")
        ).resolves.toBeDefined();
      } finally {
        await Effect.runPromise(Deferred.succeed(finishStart, true));
        await Effect.runPromise(Deferred.succeed(deliverReservation, null));
        cleanup();
        await application.dispose();
      }
    }
  );
});
