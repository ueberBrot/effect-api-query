import { User } from "@effect-api-query/contracts";
import { dehydrate } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeExampleHost } from "../../server/src/web-handler.ts";
import { featuredUserDescriptor } from "../src/lib/featured-user.ts";
import { startServerApplication } from "../src/lib/server-application.ts";
import { makeSnapshotPreparation } from "../src/lib/snapshot-preparation.ts";
import { createTanStackStartRouter } from "../src/router.tsx";

describe("featured user loader", () => {
  it("rebinds the featured loader selection to a hydrated browser cache without fetching", async () => {
    const scope = Scope.makeUnsafe();
    const host = await Effect.runPromise(
      makeExampleHost().pipe(Scope.provide(scope))
    );
    const server = await startServerApplication({
      host,
      authorization: "allowed",
    });
    const browser = await startServerApplication({
      host,
      authorization: "allowed",
    });
    try {
      const router = await createTanStackStartRouter({
        application: server,
        history: createMemoryHistory({ initialEntries: ["/details"] }),
      });
      await router.load();
      // JSON serialization exercises the loader transfer boundary.
      // oxlint-disable-next-line unicorn/prefer-structured-clone
      const selection: unknown = JSON.parse(
        JSON.stringify(router.state.matches.at(-1)?.loaderData)
      );
      const preparation = {
        beforeEncode: Effect.void,
        beforeDecode: Effect.void,
      };
      const queries = await makeSnapshotPreparation(server, preparation).encode(
        dehydrate(server.queryClient).queries
      );
      vi.stubGlobal(
        "window",
        Object.assign(new EventTarget(), { origin: "http://localhost" })
      );
      const browserRouter = await createTanStackStartRouter({
        application: browser,
        isServer: false,
        scrollRestoration: false,
        history: createMemoryHistory({ initialEntries: ["/details"] }),
      });
      await browserRouter.options.hydrate?.({
        query: {
          initial: queries,
          stream: new ReadableStream({
            start: (controller) => {
              controller.close();
            },
          }),
        },
      });
      const bound = featuredUserDescriptor(browser.rpcQuery).bind(selection);
      const options = bound.leaf.queryOptions({ input: bound.input });
      const hydrated = browser.queryClient.getQueryData(options.queryKey);
      const fetched: string[] = [];
      const unsubscribe = browser.queryClient
        .getQueryCache()
        .subscribe((event) => {
          if (event.type === "updated" && event.action.type === "fetch") {
            fetched.push(event.query.queryHash);
          }
        });
      try {
        const user = await browser.queryClient.query(options);
        expect(user).toBeInstanceOf(User);
        expect(user).toBe(hydrated);
        expect(user.name).toBe("Ada Lovelace");
        expect(fetched).toStrictEqual([]);
        expect(JSON.stringify(selection)).not.toContain("authorization");
      } finally {
        unsubscribe();
      }
    } finally {
      vi.unstubAllGlobals();
      await browser.dispose();
      await server.dispose();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });
});
