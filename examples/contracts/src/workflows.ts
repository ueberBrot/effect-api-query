import { Schema } from "effect";
import { Multipart } from "effect/http";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";

export class Document extends Schema.Class<
  Document,
  { readonly brand: unique symbol }
>("Document")({
  title: Schema.String,
  revision: Schema.Int,
}) {}

export class RevisionConflict extends Schema.TaggedError<
  RevisionConflict,
  { readonly brand: unique symbol }
>()("RevisionConflict", {
  currentEtag: Schema.String,
}) {}

export class TitleRejected extends Schema.TaggedError<
  TitleRejected,
  { readonly brand: unique symbol }
>()("TitleRejected", {
  message: Schema.String,
}) {}

export class FeedDisconnected extends Schema.TaggedError<
  FeedDisconnected,
  { readonly brand: unique symbol }
>()("FeedDisconnected", {}) {}
export class ReplayExpired extends Schema.TaggedError<
  ReplayExpired,
  { readonly brand: unique symbol }
>()("ReplayExpired", {}) {}

export const FeedEvent = Schema.Struct({
  sequence: Schema.Int,
  message: Schema.String,
});
export const FeedScenario = Schema.Literals([
  "normal",
  "disconnect",
  "gap",
  "expired",
]);

export class Reading extends Schema.Class<
  Reading,
  { readonly brand: unique symbol }
>("Reading")({
  id: Schema.Int,
  observedAt: Schema.DateFromString,
  value: Schema.Int,
}) {}
export const Room = Schema.Literals(["lab", "office"]);
const Readings = Schema.Struct({ readings: Schema.Array(Reading) });

export const uploadLimits = {
  maxFileSize: "64 KiB",
  maxFieldSize: "4 KiB",
  maxParts: 2,
} as const;
export const UploadPayload = Schema.Struct({
  title: Schema.String,
  file: Multipart.SingleFileSchema,
}).pipe(HttpApiSchema.asMultipart(uploadLimits));

export const workflowsApi = HttpApi.make("WorkflowsApi")
  .add(
    HttpApiGroup.make("documents").add(
      HttpApiEndpoint.get("read", "/workflows/document", { success: Document }),
      HttpApiEndpoint.post("write", "/workflows/document", {
        headers: { "if-match": Schema.String },
        payload: Schema.Struct({ title: Schema.String }),
        success: Document,
        error: [
          RevisionConflict.pipe(HttpApiSchema.status(412)),
          TitleRejected.pipe(HttpApiSchema.status(422)),
        ],
      })
    ),
    HttpApiGroup.make("feeds").add(
      HttpApiEndpoint.get("sse", "/workflows/sse", {
        success: HttpApiSchema.StreamSse({ data: FeedEvent }),
      }),
      HttpApiEndpoint.get("ndjson", "/workflows/ndjson", {
        success: HttpApiSchema.StreamNdjson({
          schema: FeedEvent,
          maxElementBytes: "4 KiB",
        }),
      }),
      HttpApiEndpoint.get("events", "/workflows/events", {
        query: { after: Schema.Int, scenario: FeedScenario },
        success: HttpApiSchema.StreamSse({
          data: FeedEvent,
          error: Schema.Union([FeedDisconnected, ReplayExpired]),
        }),
      }),
      HttpApiEndpoint.get("snapshot", "/workflows/snapshot", {
        success: Schema.Struct({ cursor: Schema.Int }),
      })
    ),
    HttpApiGroup.make("uploads").add(
      HttpApiEndpoint.post("upload", "/workflows/upload", {
        payload: UploadPayload,
        success: Schema.Struct({
          title: Schema.String,
          fileName: Schema.String,
          bytes: Schema.Int,
        }),
      })
    ),
    HttpApiGroup.make("readings").add(
      HttpApiEndpoint.get("read", "/workflows/readings", {
        query: { room: Room },
        success: Readings,
      }),
      HttpApiEndpoint.post("change", "/workflows/readings", {
        payload: Schema.Struct({ room: Room }),
        success: HttpApiSchema.NoContent,
      })
    )
  )
  .prefix("/api");
