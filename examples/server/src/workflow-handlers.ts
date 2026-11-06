import {
  Document,
  FeedDisconnected,
  Reading,
  ReplayExpired,
  RevisionConflict,
  TitleRejected,
  workflowsApi,
  uploadLimits,
  UploadPayload,
} from "@effect-api-query/contracts";
import { Effect, FileSystem, Layer, Ref, Schema, Stream } from "effect";
import {
  HttpServerResponse,
  HttpServerRespondable,
  Multipart,
} from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

const documentEtag = (revision: number) => `"document-${String(revision)}"`;
const documentResponse = (document: Document) =>
  HttpServerResponse.jsonUnsafe(document, {
    headers: {
      etag: documentEtag(document.revision),
      "cache-control": "no-store",
    },
  });

const documents = HttpApiBuilder.group(
  workflowsApi,
  "documents",
  Effect.fnUntraced(function* (handlers) {
    const state = yield* Ref.make(
      new Document({ title: "Release notes", revision: 1 })
    );
    return handlers.handleAll({
      read: () => Ref.get(state).pipe(Effect.map(documentResponse)),
      write: Effect.fnUntraced(function* ({ headers, payload }) {
        const title = payload.title.trim();
        if (
          title.length === 0 ||
          title.length > 80 ||
          title.toLowerCase().includes("blocked")
        ) {
          return yield* new TitleRejected({
            message: "Use 1–80 characters and omit the word blocked.",
          });
        }
        const result = yield* Ref.modify(
          state,
          (current): readonly [Document | RevisionConflict, Document] => {
            const currentEtag = documentEtag(current.revision);
            if (headers["if-match"] !== currentEtag) {
              return [new RevisionConflict({ currentEtag }), current];
            }
            const next = new Document({
              title,
              revision: current.revision + 1,
            });
            return [next, next];
          }
        );
        return result instanceof RevisionConflict
          ? yield* result
          : documentResponse(result);
      }),
    });
  })
);

const updates = (after: number, scenario: "normal" | "gap", limit = 8) =>
  Stream.fromIterable([1, 2, 3, 4, 5, 6, 7, 8]).pipe(
    Stream.filter(
      (sequence) =>
        sequence > after &&
        sequence <= limit &&
        !(scenario === "gap" && sequence === 4)
    ),
    Stream.rechunk(1),
    Stream.mapEffect((sequence) =>
      Effect.sleep("120 millis").pipe(
        Effect.as({ sequence, message: `Update ${String(sequence)}` })
      )
    )
  );
const feed = (
  after: number,
  scenario: "normal" | "disconnect" | "gap" | "expired"
) => {
  if (scenario === "expired" && after > 0 && after < 5) {
    return Stream.fail(new ReplayExpired());
  }
  const disconnect =
    (scenario === "disconnect" || scenario === "expired") && after < 3;
  const events = updates(
    after,
    scenario === "gap" ? "gap" : "normal",
    disconnect ? 3 : 8
  );
  return disconnect
    ? Stream.concat(events, Stream.fail(new FeedDisconnected()))
    : events;
};

const feeds = HttpApiBuilder.group(workflowsApi, "feeds", (handlers) =>
  handlers.handleAll({
    sse: () => Effect.succeed(updates(0, "normal")),
    ndjson: () => Effect.succeed(updates(0, "normal")),
    events: ({ query }) => Effect.succeed(feed(query.after, query.scenario)),
    snapshot: () => Effect.succeed({ cursor: 5 }),
  })
);

const uploads = HttpApiBuilder.group(workflowsApi, "uploads", (handlers) =>
  handlers.handleRaw(
    "upload",
    Effect.fnUntraced(function* ({ request }) {
      const fs = yield* FileSystem.FileSystem;
      return yield* request.multipart.pipe(
        Effect.provideContext(Multipart.limitsServices(uploadLimits)),
        Effect.flatMap(Schema.decodeUnknownEffect(UploadPayload)),
        Effect.flatMap((payload) =>
          fs.stat(payload.file.path).pipe(
            Effect.map((stat) => ({
              title: payload.title,
              fileName: payload.file.name,
              bytes: Number(stat.size),
            }))
          )
        ),
        Effect.catch((error) =>
          HttpServerRespondable.toResponseOrElse(
            error,
            HttpServerResponse.empty({ status: 500 })
          )
        )
      );
    })
  )
);

const readings = HttpApiBuilder.group(
  workflowsApi,
  "readings",
  Effect.fnUntraced(function* (handlers) {
    const value = yield* Ref.make({ lab: 20, office: 25 });
    return handlers.handleAll({
      read: ({ query }) =>
        Ref.get(value).pipe(
          Effect.map((current) => ({
            readings: [
              new Reading({
                id: 1,
                observedAt: new Date("2026-01-01T00:00:00Z"),
                value: current[query.room],
              }),
              new Reading({
                id: 2,
                observedAt: new Date("2026-01-01T00:00:00Z"),
                value: 30,
              }),
            ],
          }))
        ),
      change: ({ payload }) =>
        Ref.update(value, (current) => ({
          ...current,
          [payload.room]: current[payload.room] + 1,
        })),
    });
  })
);

export const workflowRoutes = HttpApiBuilder.layer(workflowsApi).pipe(
  Layer.provide([documents, feeds, uploads, readings])
);
