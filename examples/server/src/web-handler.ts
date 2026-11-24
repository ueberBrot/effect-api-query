import { exampleRpcGroup } from "@effect-api-query/contracts";
import { NodeFileSystem } from "@effect/platform-node";
import { Clock, Context, Effect, Layer, Path, Scope } from "effect";
import type { HttpServerRequest } from "effect/http";
import {
  HttpEffect,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
} from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import type { DemoWriter } from "./caller.ts";
import { makeCallerVerifier, VerifiedCaller } from "./caller.ts";
import { ExampleDomain } from "./domain.ts";
import {
  exampleHttpAuthorization,
  exampleHttpRoutes,
} from "./http-handlers.ts";
import { exampleRpcHandlersLayer } from "./rpc-handlers.ts";
import { makeServerLocalRpcClient } from "./server-local-rpc.ts";
import { workflowRoutes } from "./workflow-handlers.ts";

const rpcLayer = Layer.mergeAll(
  exampleRpcHandlersLayer,
  RpcSerialization.layerJson
);
const maxRequestBodyBytes = 1024 * 1024;

const readRequestBody = async (
  request: Request
): Promise<Uint8Array<ArrayBuffer> | Response> => {
  if (request.body === null) {
    return new Uint8Array();
  }
  const reader = request.body.getReader();
  let body = new Uint8Array(0);
  let length = 0;
  const cancelReader = async () => {
    try {
      await reader.cancel();
    } catch {
      // oxlint-disable-next-line eslint/no-useless-return
      return;
    }
  };
  const cancel = () => {
    void cancelReader();
  };
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      request.signal.throwIfAborted();
      // oxlint-disable-next-line eslint/no-await-in-loop
      const chunk = await reader.read();
      request.signal.throwIfAborted();
      if (chunk.done) {
        return length === body.byteLength ? body : body.slice(0, length);
      }
      if (chunk.value.byteLength > maxRequestBodyBytes - length) {
        cancel();
        return new Response(null, { status: 413 });
      }
      const required = length + chunk.value.byteLength;
      if (required > body.byteLength) {
        const capacity = Math.min(
          maxRequestBodyBytes,
          Math.max(required, body.byteLength * 2)
        );
        const expanded = new Uint8Array(capacity);
        expanded.set(body.subarray(0, length));
        body = expanded;
      }
      body.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
  } catch {
    cancel();
    return new Response(null, { status: 400 });
  } finally {
    request.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
};

const withRequestBodyLimit =
  (
    handler: (
      request: Request,
      context: Context.Context<never>
    ) => Response | Promise<Response>
  ) =>
  async (
    request: Request,
    context: Context.Context<never>
  ): Promise<Response> => {
    const body = await readRequestBody(request);
    if (body instanceof Response) {
      return body;
    }
    return await handler(
      new Request(request.url, {
        body: request.body === null ? null : body,
        headers: request.headers,
        method: request.method,
        signal: request.signal,
      }),
      context
    );
  };

const makeRpcWebHandler = Effect.fn("ExampleRpc.makeRpcWebHandler")(
  function* () {
    const scope = yield* Scope.Scope;
    const rpcContext = yield* Layer.buildWithScope(rpcLayer, scope);
    const rpcHttpEffect = yield* RpcServer.toHttpEffect(exampleRpcGroup).pipe(
      Effect.provide(rpcContext),
      Scope.provide(scope)
    );
    const runtimeContext = yield* Effect.context<Scope.Scope>();

    const handler = HttpEffect.toWebHandlerWith<
      Scope.Scope,
      Scope.Scope | HttpServerRequest.HttpServerRequest
    >(runtimeContext)(HttpMiddleware.logger(rpcHttpEffect));
    return withRequestBodyLimit(handler);
  }
);

const provideDomain = Effect.fn("ExampleDomain.provide")(function* <A, E, R>(
  effect: Effect.Effect<A, E, R | ExampleDomain>,
  domainLayer = ExampleDomain.layer
) {
  const scope = yield* Scope.Scope;
  const context = yield* Layer.buildWithScope(domainLayer, scope);
  return yield* Effect.provide(effect, context);
});

export const makeExampleRpcWebHandler = Effect.fn(
  "ExampleRpc.makeExampleRpcWebHandler"
)(function* () {
  const rpc = yield* provideDomain(makeRpcWebHandler());
  return async (request: Request) => await rpc(request, Context.empty());
});

const makeHostWebHandler = Effect.fn("ExampleServer.makeHostWebHandler")(
  function* (writeToken: string | undefined) {
    const callers = makeCallerVerifier(writeToken, yield* Clock.Clock);
    const rpc = yield* makeRpcWebHandler();
    const httpEffect = (yield* HttpRouter.toHttpEffect(
      Layer.mergeAll(exampleHttpRoutes, workflowRoutes).pipe(
        Layer.provide(
          Layer.mergeAll(
            HttpServer.layerServices,
            NodeFileSystem.layer,
            exampleHttpAuthorization
          )
        )
      )
    )).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, Path.layer)));
    const runtimeContext = yield* Effect.context<Scope.Scope>();
    const http = withRequestBodyLimit(
      HttpEffect.toWebHandlerWith<
        Scope.Scope,
        Scope.Scope | HttpServerRequest.HttpServerRequest
      >(runtimeContext)(HttpMiddleware.logger(httpEffect))
    );

    const handle = async (
      request: Request,
      caller: DemoWriter | null
    ): Promise<Response> => {
      const path = new URL(request.url).pathname;
      const context = Context.make(VerifiedCaller, caller);
      if ((path === "/rpc" || path === "/rpc/") && request.method === "POST") {
        return await rpc(request, context);
      }
      if (path.startsWith("/api/")) {
        return await http(request, context);
      }
      return new Response(null, { status: 404 });
    };

    const issueSession = withRequestBodyLimit(callers.issueSession);
    return {
      verify: callers.verify,
      handle,
      handleRequest: async (request: Request) =>
        new URL(request.url).pathname === "/api/demo-access" &&
        request.method === "POST"
          ? await issueSession(request, Context.empty())
          : await handle(request, callers.verify(request)),
    };
  }
);

export const makeExampleHost = Effect.fn("ExampleServer.makeExampleHost")(
  function* (writeToken?: string) {
    const scope = yield* Scope.Scope;
    const domainContext = yield* Layer.buildWithScope(
      ExampleDomain.layer,
      scope
    );
    const handlersContext = yield* Layer.buildWithScope(
      exampleRpcHandlersLayer,
      scope
    ).pipe(Effect.provide(domainContext));
    const { verify, handle, handleRequest } = yield* makeHostWebHandler(
      writeToken
    ).pipe(Effect.provide(domainContext));
    const forRequest = (request?: Request) => {
      const caller = request === undefined ? null : verify(request);
      const makeRpcClient = Effect.fn("ExampleServer.makeRequestRpcClient")(
        function* () {
          const requestScope = yield* Scope.Scope;
          const serverContext = handlersContext.pipe(
            Context.add(VerifiedCaller, caller),
            Context.add(Scope.Scope, requestScope)
          );
          return yield* makeServerLocalRpcClient(exampleRpcGroup).pipe(
            Effect.provideContext(serverContext)
          );
        }
      );
      return {
        makeRpcClient,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
          await handle(new Request(input, init), caller),
      };
    };
    return { handleRequest, forRequest };
  }
);

export type ExampleHost = Effect.Success<ReturnType<typeof makeExampleHost>>;

export const makeExampleWebHandler = Effect.fn(
  "ExampleServer.makeExampleWebHandler"
)(function* (
  domainLayer: Layer.Layer<ExampleDomain> = ExampleDomain.layer,
  writeToken?: string
) {
  const { handleRequest } = yield* provideDomain(
    makeHostWebHandler(writeToken),
    domainLayer
  );
  return handleRequest;
});
