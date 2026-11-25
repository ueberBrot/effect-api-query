// @effect-diagnostics unstableApiUsage:off
import { Buffer } from "node:buffer";

import { exampleRpcGroup } from "@effect-api-query/contracts";
import { Effect, Stream } from "effect";
import type { Scope } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

const maxBufferedRpcOperations = 16;
const maxBufferedRpcResponseBytes = 1024 * 1024;

const { json } = RpcSerialization;
const encoder = new TextEncoder();
const overflowMarker = 0;
const openArray = 0x5b;
const closeArray = 0x5d;

const bufferedRpcSerialization = RpcSerialization.RpcSerialization.of({
  ...json,
  includesFraming: true,
  makeUnsafe() {
    const parser = json.makeUnsafe();
    let remaining = maxBufferedRpcResponseBytes - 1;
    let overflowed = false;
    return {
      decode: parser.decode,
      encode(response): Uint8Array | undefined {
        if (overflowed) {
          return undefined;
        }
        const encoded = JSON.stringify(response);
        if (encoded === undefined) {
          return undefined;
        }
        remaining -= Buffer.byteLength(encoded) + 1;
        if (remaining < 0) {
          overflowed = true;
          return Uint8Array.of(overflowMarker);
        }
        return encoder.encode(`${encoded},`);
      },
    };
  },
});

const exceedsOperationLimit = (body: string): boolean => {
  try {
    return json.makeUnsafe().decode(body).length > maxBufferedRpcOperations;
  } catch {
    return false;
  }
};

const rejected = (reason: string) =>
  HttpServerResponse.text(reason, { status: 413 });

type RpcHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  Scope.Scope | HttpServerRequest.HttpServerRequest
>;

const serveBufferedRpcBatch = Effect.fnUntraced(
  function* (handle: RpcHttpEffect) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* Effect.orDie(request.text);
    if (exceedsOperationLimit(body)) {
      return rejected("Too many RPC operations");
    }

    const response = yield* handle;
    const frames = response.body;
    if (frames._tag !== "Stream" && frames._tag !== "Uint8Array") {
      return response;
    }

    const chunks: Uint8Array[] = [];
    let size = 1;
    let overflowed = false;
    const collect = (chunk: Uint8Array) => {
      if (chunk.at(-1) === overflowMarker) {
        overflowed = true;
        return false;
      }
      if (chunk.byteLength === 0) {
        return true;
      }
      chunks.push(chunk);
      size += chunk.byteLength;
      return true;
    };
    if (frames._tag === "Uint8Array") {
      collect(frames.body);
    } else {
      yield* Stream.runForEachWhile(Stream.orDie(frames.stream), (chunk) =>
        Effect.sync(() => collect(chunk))
      );
    }
    if (overflowed) {
      return rejected("RPC response exceeds the byte limit");
    }

    const bytes = new Uint8Array(Math.max(2, size));
    bytes[0] = openArray;
    let offset = 1;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    bytes[bytes.length - 1] = closeArray;
    return HttpServerResponse.uint8Array(bytes, {
      contentType: json.contentType,
    });
  },
  Effect.scoped,
  Effect.interruptible
);

export const makeBufferedRpcHttpEffect = RpcServer.toHttpEffect(
  exampleRpcGroup,
  { streamBufferSize: 1 }
).pipe(
  Effect.provideService(
    RpcSerialization.RpcSerialization,
    bufferedRpcSerialization
  ),
  Effect.map(serveBufferedRpcBatch)
);
