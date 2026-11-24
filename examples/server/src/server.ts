import { createServer } from "node:http";
import { isIPv6 } from "node:net";

import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Option, Schema } from "effect";
import type { Layer } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/http";

import type { ExampleDomain } from "./domain.ts";
import { makeExampleWebHandler, maxRequestBodyBytes } from "./web-handler.ts";

// oxlint-disable-next-line unicorn/throw-new-error
class ExampleRpcServerError extends Schema.TaggedError<
  ExampleRpcServerError,
  { readonly brand: unique symbol }
>()("ExampleRpcServerError", {
  cause: Schema.Defect(),
  message: Schema.String,
}) {}

const isCorsOriginList = Schema.is(
  Schema.Array(
    Schema.String.check(
      Schema.makeFilter((origin: string) => {
        const url = URL.parse(origin);
        return (
          url !== null &&
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.origin === origin
        );
      })
    )
  )
);

const corsHeaders = (
  allowedOrigins: ReadonlySet<string>,
  origin: string | undefined,
  httpApi: boolean,
  responseVary?: string
) => {
  if (allowedOrigins.size === 0) {
    return null;
  }
  let vary = "Origin";
  if (responseVary !== undefined) {
    vary = responseVary === "*" ? responseVary : `${responseVary}, Origin`;
  }
  if (origin === undefined || !allowedOrigins.has(origin)) {
    return { vary };
  }
  return {
    "access-control-allow-headers": `authorization,baggage,content-type,${httpApi ? "if-match," : ""}traceparent,tracestate`,
    "access-control-allow-methods": httpApi
      ? "GET,POST,DELETE,OPTIONS"
      : "POST,OPTIONS",
    "access-control-allow-origin": origin,
    "access-control-expose-headers": "etag",
    vary,
  };
};

export interface RunningExampleRpcServer {
  readonly host: string;
  readonly port: number;
  readonly httpApiUrl: string;
  readonly rpcUrl: string;
  readonly url: string;
}

export interface StartExampleRpcServerOptions {
  readonly allowedOrigins?: readonly string[];
  readonly domainLayer?: Layer.Layer<ExampleDomain>;
  readonly host?: string;
  readonly port?: number;
  readonly writeToken?: string | undefined;
}

export const startExampleRpcServer = Effect.fn(
  "ExampleRpc.startExampleRpcServer"
)((options: StartExampleRpcServerOptions = {}) =>
  Effect.gen(function* () {
    const host = options.host ?? "127.0.0.1";
    const origins = options.allowedOrigins ?? [];
    if (!isCorsOriginList(origins)) {
      return yield* new ExampleRpcServerError({
        cause: undefined,
        message: "Example RPC server requires serialized HTTP(S) CORS origins",
      });
    }
    const allowedOrigins = new Set(origins);
    const webHandler = yield* makeExampleWebHandler(
      options.domainLayer,
      options.writeToken
    );
    const nodeServer = createServer();
    const server = yield* NodeHttpServer.make(() => nodeServer, {
      disablePreemptiveShutdown: true,
      host,
      port: options.port ?? 0,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ExampleRpcServerError({
            cause,
            message: "Example RPC server failed to listen",
          })
      )
    );
    if (server.address._tag === "UnixPathAddress") {
      return yield* new ExampleRpcServerError({
        cause: server.address,
        message: "Example RPC server did not bind a TCP address",
      });
    }

    const api = HttpEffect.fromWebHandler(webHandler).pipe(
      Effect.interruptible
    );
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = HttpServerRequest.toURL(
        request.modify({ url: request.originalUrl })
      );
      if (
        Option.isNone(url) ||
        url.value.username !== "" ||
        url.value.password !== ""
      ) {
        return HttpServerResponse.empty({ status: 400 });
      }
      const path = url.value.pathname;
      const isRpcPath = path === "/rpc" || path === "/rpc/";
      const isHttpPath = path.startsWith("/api/");
      const { origin } = request.headers;

      if (request.method === "GET" && path === "/health") {
        return HttpServerResponse.jsonUnsafe({ status: "ready" });
      }
      if (request.method === "OPTIONS" && (isRpcPath || isHttpPath)) {
        return HttpServerResponse.empty({
          headers: corsHeaders(allowedOrigins, origin, isHttpPath) ?? {},
          status: 204,
        });
      }
      if (!(request.method === "POST" && isRpcPath) && !isHttpPath) {
        return HttpServerResponse.empty({ status: 404 });
      }

      const response =
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        Number(request.headers["content-length"]) > maxRequestBodyBytes
          ? HttpServerResponse.empty({
              headers: { "cache-control": "no-store" },
              status: 413,
            })
          : yield* api;
      const headers = corsHeaders(
        allowedOrigins,
        origin,
        isHttpPath,
        response.headers["vary"]
      );
      return headers === null
        ? response
        : HttpServerResponse.setHeaders(response, headers);
    });
    yield* server.serve(app);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        nodeServer.closeAllConnections();
      })
    );

    const { port } = server.address;
    const urlHost = isIPv6(host) ? `[${host}]` : host;
    const url = `http://${urlHost}:${String(port)}`;
    return {
      host,
      port,
      httpApiUrl: `${url}/api`,
      rpcUrl: `${url}/rpc`,
      url,
    } satisfies RunningExampleRpcServer;
  }).pipe(Effect.uninterruptible)
);
