// @vitest-environment jsdom

import { User } from "@effect-api-query/contracts";
import { startExampleRpcServer } from "@effect-api-query/server";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Effect, Exit, Scope } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { makeControlledUserWrites } from "../../../tests/fixtures/optimistic-users.ts";
import { ViteReactExample } from "../src/app.tsx";
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
      <UserList application={application} users={users.data} />
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

  it("normalizes void query data and preserves void mutation data", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Run void query" }));
    await expect(
      screen.findByText("Void query result: null")
    ).resolves.toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reset directory" }));
    await expect(
      screen.findByText("Reset result: undefined")
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

  it("deletes the user selected from the rendered list", async () => {
    await expect(screen.findByText("Edsger Dijkstra")).resolves.toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Edsger Dijkstra" })
    );

    await waitFor(() => {
      expect(screen.queryByText("Edsger Dijkstra")).toBeNull();
    });
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

  it("invalidates the HTTP directory after RPC replacement", async () => {
    await expect(
      screen.findByText("HTTP: Ada Lovelace")
    ).resolves.toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Replace with eight pioneers" })
    );
    await expect(
      screen.findByText("HTTP: Margaret Hamilton")
    ).resolves.toBeDefined();
    await expect(
      screen.findByText("HTTP directory: 8 users")
    ).resolves.toBeDefined();
  });

  it("shows optimistic creation and removal, then restores a failed deletion beside the created user", async () => {
    cleanup();
    const fixture = await Effect.runPromise(
      makeControlledUserWrites(new QueryClient())
    );
    const owned = fixture.application;
    const ada = new User({ id: 1, name: "Ada", locale: "en" });
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
      await creation.succeed(new User({ id: 2, name: "Grace", locale: "en" }));
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
