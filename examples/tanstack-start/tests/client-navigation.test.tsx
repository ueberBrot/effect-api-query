// @vitest-environment jsdom

import { startExampleRpcServer } from "@effect-api-query/server";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Effect, Exit, Scope } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { TanStackStartApplication } from "../src/lib/application.ts";
import { createTanStackStartRouter } from "../src/router.tsx";

describe("TanStack Start client navigation", () => {
  let browserApplication: TanStackStartApplication | undefined;
  let serverScope: Scope.Closeable | undefined;

  beforeEach(async () => {
    window.scrollTo = () => {};
    serverScope = await Effect.runPromise(Scope.make());
  });

  afterEach(async () => {
    cleanup();
    await browserApplication?.dispose();
    if (serverScope !== undefined) {
      await Effect.runPromise(Scope.close(serverScope, Exit.void));
    }
  });

  const renderRoute = async (path: string) => {
    if (serverScope === undefined) {
      throw new Error("Server scope was not initialized");
    }
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(serverScope))
    );
    const router = await createTanStackStartRouter({
      history: createMemoryHistory({ initialEntries: [path] }),
      rpcUrl: server.rpcUrl,
      scrollRestoration: false,
    });
    browserApplication = router.options.context;

    await router.load();
    render(<RouterProvider router={router} />);
    return router;
  };

  it("renders the loader failure and the default 404", async () => {
    const router = await renderRoute("/failure");
    const failure = await screen.findByRole("alert");
    expect(failure.textContent).toContain("DiagnosticFailure");

    await act(async () => {
      router.history.push("/missing");
      await router.load();
    });
    await expect(
      screen.findByRole("heading", { name: "Page not found" })
    ).resolves.toBeDefined();
  });

  it("reloads the home loader while both stream views remain mounted", async () => {
    const router = await renderRoute("/");
    const history = { name: "Accumulated stream history" };
    await screen.findByRole("region", history, { timeout: 5000 });

    await act(async () => {
      await router.invalidate({ sync: true });
    });

    expect(router.state.matches.at(-1)?.status).toBe("success");
    await screen.findByRole("region", history, { timeout: 5000 });
    expect(screen.getByText(/^Current state:/u)).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Route failed" })).toBeNull();
  });
});
