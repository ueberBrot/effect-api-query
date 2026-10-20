import {
  CommandStatus,
  DiagnosticStatus,
  User,
  UserPage,
} from "@effect-api-query/contracts";
import type { DehydratedState } from "@tanstack/react-query";
import {
  createHydrationRegistry,
  infiniteQueryCodec,
  queryViewCodec,
} from "@ueberbrot/effect-api-query";
import { Context, Effect, Schema } from "effect";

import type { TanStackStartApplication } from "./application.ts";

export interface SnapshotPreparation {
  readonly beforeEncode: Effect.Effect<void>;
  readonly beforeDecode: Effect.Effect<void>;
}

type SnapshotEncodingService = Pick<SnapshotPreparation, "beforeEncode">;
const SnapshotEncoding = Context.Service<SnapshotEncodingService>(
  "Start/SnapshotEncoding"
);
type SnapshotDecodingService = Pick<SnapshotPreparation, "beforeDecode">;
const SnapshotDecoding = Context.Service<SnapshotDecodingService>(
  "Start/SnapshotDecoding"
);

const prepared = <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  schema.pipe(
    Schema.middlewareEncoding<S, SnapshotEncodingService>((encoding) =>
      SnapshotEncoding.pipe(
        Effect.flatMap(({ beforeEncode }) =>
          beforeEncode.pipe(Effect.andThen(encoding))
        )
      )
    ),
    Schema.middlewareDecoding((decoding) =>
      SnapshotDecoding.pipe(
        Effect.flatMap(({ beforeDecode }) =>
          beforeDecode.pipe(Effect.andThen(decoding))
        )
      )
    )
  );

const Users = prepared(Schema.Array(User));
const SingleUser = prepared(User);
const Page = prepared(UserPage);
const Status = prepared(DiagnosticStatus);
const Command = prepared(Schema.NullOr(CommandStatus));
const Text = prepared(Schema.String);
const History = prepared(Schema.Array(Schema.String));

export interface SnapshotCodecs {
  readonly encode: (
    queries: DehydratedState["queries"]
  ) => Promise<DehydratedState["queries"]>;
  readonly decode: (
    queries: DehydratedState["queries"]
  ) => Promise<DehydratedState["queries"]>;
}

export const makeSnapshotPreparation = (
  { rpcQuery, httpQuery, runPreparation }: TanStackStartApplication,
  services: SnapshotPreparation
): SnapshotCodecs => {
  const registry = createHydrationRegistry([
    queryViewCodec(rpcQuery.users.list, "query", Users),
    queryViewCodec(httpQuery.users.list, "query", Users),
    queryViewCodec(rpcQuery.users.get, "query", SingleUser),
    queryViewCodec(httpQuery.users.get, "query", SingleUser),
    infiniteQueryCodec(rpcQuery.users.page, {
      page: Page,
      pageParam: Schema.Int,
    }),
    infiniteQueryCodec(httpQuery.users.page, {
      page: Page,
      pageParam: Schema.Int,
    }),
    queryViewCodec(rpcQuery.diagnostics.status, "query", Status),
    queryViewCodec(httpQuery.diagnostics.status, "query", Status),
    queryViewCodec(rpcQuery.diagnostics.operationStatus, "query", Status),
    queryViewCodec(httpQuery.diagnostics.operationStatus, "query", Status),
    queryViewCodec(rpcQuery.commands.status, "query", Command),
    queryViewCodec(rpcQuery.diagnostics.slow, "query", Text),
    queryViewCodec(httpQuery.diagnostics.slow, "query", Text),
    queryViewCodec(rpcQuery.diagnostics.stream, "live", Text),
    queryViewCodec(rpcQuery.diagnostics.stream, "streamed", History),
  ]);
  return {
    encode: async (queries: DehydratedState["queries"]) =>
      await runPreparation(
        registry
          .encodeQueries(queries)
          .pipe(Effect.provideService(SnapshotEncoding, services))
      ),
    decode: async (queries: DehydratedState["queries"]) =>
      await runPreparation(
        registry
          .decodeQueries(queries)
          .pipe(Effect.provideService(SnapshotDecoding, services))
      ),
  };
};
