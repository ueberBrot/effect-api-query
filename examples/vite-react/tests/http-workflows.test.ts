import { Reading } from "@effect-api-query/contracts";
import { startExampleRpcServer } from "@effect-api-query/server";
import { MutationObserver } from "@tanstack/query-core";
import { findDeclaredError } from "@ueberbrot/effect-api-query";
import { Deferred, Effect, Exit, Option, Scope } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { startHttpWorkflows } from "../src/workflows/application.ts";
import type { HttpWorkflows } from "../src/workflows/application.ts";
import { recoveredEvents } from "../src/workflows/recovery.ts";
import { shareReadings } from "../src/workflows/sharing.ts";

const withApplication = async (
  run: (application: HttpWorkflows, baseUrl: string) => Promise<void>
) => {
  const scope = await Effect.runPromise(Scope.make());
  let application: HttpWorkflows | undefined;
  try {
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(scope))
    );
    application = await startHttpWorkflows(server.url);
    await run(application, server.url);
  } finally {
    try {
      await application?.dispose();
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  }
};

describe("runnable HTTP workflows", () => {
  it("uses quoted ETags and distinguishes field errors from stale writes", async () => {
    await withApplication(async ({ http, queryClient }) => {
      const initial = await queryClient.query(
        http.documents.read.metadataOptions()
      );
      expect(initial.headers["etag"]).toBe('"document-1"');
      const mutation = new MutationObserver(
        queryClient,
        http.documents.write.mutationOptions()
      );
      await expect(
        mutation.mutate({
          headers: { "if-match": '"document-1"' },
          payload: { title: "blocked" },
        })
      ).rejects.toMatchObject({ _tag: "EffectHttpApiQueryError" });
      expect(
        Option.isSome(
          findDeclaredError(mutation.getCurrentResult().error, "TitleRejected")
        )
      ).toBe(true);
      await mutation.mutate({
        headers: { "if-match": '"document-1"' },
        payload: { title: "Reviewed" },
      });

      await expect(
        mutation.mutate({
          headers: { "if-match": '"document-1"' },
          payload: { title: "Stale" },
        })
      ).rejects.toMatchObject({ _tag: "EffectHttpApiQueryError" });
      expect(
        Option.isSome(
          findDeclaredError(
            mutation.getCurrentResult().error,
            "RevisionConflict"
          )
        )
      ).toBe(true);
    });
  });

  it.each(["sse", "ndjson"] as const)(
    "decodes %s over HTTP into bounded history and latest-value caches",
    async (format) => {
      await withApplication(async ({ http, queryClient }) => {
        const history =
          format === "sse"
            ? await queryClient.query(http.feeds.sse.streamedOptions())
            : await queryClient.query(http.feeds.ndjson.streamedOptions());
        expect(history.map((event) => event.sequence)).toStrictEqual([
          5, 6, 7, 8,
        ]);
      });
    }
  );

  it.each([
    {
      scenario: "disconnect",
      sequences: [1, 2, 3, 4, 5, 6, 7, 8],
      refreshes: 0,
    },
    { scenario: "gap", sequences: [1, 2, 3, 5, 6, 7, 8], refreshes: 1 },
    { scenario: "expired", sequences: [1, 2, 3, 6, 7, 8], refreshes: 1 },
  ] as const)(
    "recovers $scenario without caching notification history",
    async ({ scenario, sequences, refreshes }) => {
      await withApplication(async (application) => {
        const received: number[] = [];
        const states: string[] = [];
        let refreshed = 0;
        const consumption = application.consume(
          recoveredEvents(application, scenario, {
            event: (event) => {
              received.push(event.sequence);
            },
            state: (state) => {
              states.push(state);
            },
            refresh: () => {
              refreshed += 1;
            },
          })
        );
        await consumption.done;
        expect(received).toStrictEqual(sequences);
        expect(refreshed).toBe(refreshes);
        expect(states.at(-1)).toBe("completed");
        expect(
          application.queryClient
            .getQueryCache()
            .getAll()
            .map((query) => query.queryKey)
        ).toStrictEqual(
          refreshes === 0 ? [] : [application.http.documents.read.queryKey()]
        );
      });
    }
  );

  it("marks a cached document stale after recovered notifications", async () => {
    await withApplication(async (application) => {
      const { http, queryClient } = application;
      await queryClient.query(http.documents.read.queryOptions());
      const consumption = application.consume(
        recoveredEvents(application, "normal", {
          event: () => {},
          state: () => {},
          refresh: () => {},
        })
      );
      await consumption.done;
      expect(
        queryClient.getQueryState(http.documents.read.queryKey())?.isInvalidated
      ).toBe(true);
    });
  });

  it("receives multipart files and enforces the server-side file limit", async () => {
    await withApplication(async ({ http, queryClient }, baseUrl) => {
      const mutation = new MutationObserver(
        queryClient,
        http.uploads.upload.mutationOptions()
      );
      const payload = new FormData();
      payload.set("title", "Notes");
      payload.set(
        "file",
        new File(["hello"], "notes.txt", { type: "text/plain" })
      );
      await expect(mutation.mutate({ payload })).resolves.toStrictEqual({
        title: "Notes",
        fileName: "notes.txt",
        bytes: 5,
      });
      const oversized = new FormData();
      oversized.set("title", "Oversized");
      oversized.set("file", new File([new Uint8Array(65_537)], "large.txt"));
      const response = await fetch(`${baseUrl}/api/workflows/upload`, {
        method: "POST",
        body: oversized,
      });
      expect(response.status).toBe(413);
    });
  });

  it("reuses equivalent Schema classes and replaces only changed readings", async () => {
    await withApplication(async ({ http, queryClient }) => {
      const options = http.readings.read.queryOptions({
        input: { query: { room: "lab" } },
        structuralSharing: shareReadings,
      });
      await queryClient.query(options);
      const before = queryClient.getQueryData(options.queryKey);
      await queryClient.query(options);
      const equal = queryClient.getQueryData(options.queryKey);
      expect(equal).toBe(before);
      expect(equal?.readings[0]).toBeInstanceOf(Reading);
      const change = new MutationObserver(
        queryClient,
        http.readings.change.mutationOptions()
      );
      await change.mutate({ payload: { room: "lab" } });
      await queryClient.query(options);
      const after = queryClient.getQueryData(options.queryKey);
      expect(after?.readings[0]).not.toBe(before?.readings[0]);
      expect(after?.readings[1]).toBe(before?.readings[1]);
    });
  });

  it("stops and drains an active notification consumer before disposal", async () => {
    await withApplication(async (application) => {
      const received: number[] = [];
      const consumer = application.consume(
        recoveredEvents(application, "normal", {
          event: (event) => {
            received.push(event.sequence);
          },
          state: () => {},
          refresh: () => {},
        })
      );
      const completion = (async () => {
        try {
          await consumer.done;
        } catch {
          return "stopped";
        }
        return "completed";
      })();
      await expect.poll(() => received.length).toBeGreaterThan(0);
      await application.dispose();
      await expect(completion).resolves.toBe("stopped");
      expect(() => application.consume(Effect.void)).toThrow("closed");
    });
  });

  it("drains mutation callbacks before clearing the retired cache", async () => {
    await withApplication(async (application) => {
      const entered = Deferred.makeUnsafe<boolean>();
      const release = Deferred.makeUnsafe<boolean>();
      const mutation = new MutationObserver(
        application.queryClient,
        application.http.documents.write.mutationOptions({
          onSuccess: async (document) => {
            Effect.runSync(Deferred.succeed(entered, true));
            await Effect.runPromise(Deferred.await(release));
            application.queryClient.setQueryData(
              application.http.documents.read.queryKey(),
              document
            );
          },
        })
      );
      const current = await application.queryClient.query(
        application.http.documents.read.metadataOptions()
      );
      const writing = mutation.mutate({
        headers: { "if-match": current.headers["etag"] ?? "" },
        payload: { title: "Settled before disposal" },
      });
      await Effect.runPromise(Deferred.await(entered));
      let closed = false;
      const disposal = (async () => {
        await application.dispose();
        closed = true;
      })();
      try {
        await Promise.resolve();
        expect(closed).toBe(false);
      } finally {
        Effect.runSync(Deferred.succeed(release, true));
        await writing;
        await disposal;
      }
      expect(application.queryClient.getQueryCache().getAll()).toHaveLength(0);
    });
  });
});
