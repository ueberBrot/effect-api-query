import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  ExampleAuthorizationError,
  InvalidOperationInput,
  OperationId,
} from "@effect-api-query/contracts";
import { Context, Effect, Option, Schema } from "effect";
import type { Clock } from "effect";
import { Cookies } from "effect/http";

export interface Caller {
  readonly writerId: string | null;
  readonly operationOwner: string | null;
}

export const anonymousCaller: Caller = { writerId: null, operationOwner: null };

export const VerifiedCaller = Context.Reference<Caller>(
  "@effect-api-query/server/VerifiedCaller",
  { defaultValue: () => anonymousCaller }
);

const missingAuthorization = () =>
  new ExampleAuthorizationError({ reason: "missing-example-authorization" });

export const requireDemoWriter = Effect.gen(function* () {
  const caller = yield* VerifiedCaller;
  if (caller.writerId === null) {
    return yield* missingAuthorization();
  }
  return yield* Effect.void;
});

export const requireOperationOwner = Effect.gen(function* () {
  const caller = yield* VerifiedCaller;
  if (caller.operationOwner === null) {
    return yield* missingAuthorization();
  }
  return caller.operationOwner;
});

const validOperationId = Schema.is(OperationId);

export const requireOperationOwnerFor = Effect.fnUntraced(function* (
  operationId: string
) {
  const owner = yield* requireOperationOwner;
  if (!validOperationId(operationId)) {
    return yield* Effect.fail(InvalidOperationInput.literal);
  }
  return owner;
});

const writeCookie = "example-write-session";
const operationCookie = (request: Request) => {
  const { port, protocol } = new URL(request.url);
  return `example-operation-session-${port || (protocol === "https:" ? "443" : "80")}`;
};
const sessionLifetimeSeconds = 3600;
const decodeSession = Schema.decodeUnknownOption(
  Schema.Tuple([
    Schema.String.check(Schema.isUUID(4)),
    Schema.String.check(Schema.isPattern(/^\d{1,15}$/u)),
    Schema.String.check(Schema.isPattern(/^[\w-]{43}$/u)),
  ])
);

const digest = (value: string) => createHash("sha256").update(value).digest();

const sameOrigin = (request: Request) =>
  request.headers.get("origin") === new URL(request.url).origin;

export const makeCallerVerifier = (
  writeToken: string | undefined,
  clock: Clock.Clock
) => {
  const tokenHash =
    writeToken === undefined || writeToken === ""
      ? undefined
      : digest(`Bearer ${writeToken}`);
  const key = randomBytes(32);
  const operatorId = randomUUID();
  const nowSeconds = () => Math.floor(clock.currentTimeMillisUnsafe() / 1000);
  const sign = (name: string, session: string) =>
    createHmac("sha256", key).update(`${name}:${session}`).digest("base64url");
  const verifyBearer = (request: Request) => {
    const header = request.headers.get("authorization");
    return (
      header !== null &&
      tokenHash !== undefined &&
      timingSafeEqual(digest(header), tokenHash)
    );
  };

  const readSession = (
    cookies: Readonly<Record<string, string>>,
    name: string
  ) => {
    const session = decodeSession(cookies[name]?.split("."));
    if (Option.isNone(session)) {
      return null;
    }
    const [id, expires, signature] = session.value;
    if (
      Number(expires) <= nowSeconds() ||
      !timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(sign(name, `${id}.${expires}`))
      )
    ) {
      return null;
    }
    return id;
  };

  const verify = (request: Request): Caller => {
    if (verifyBearer(request)) {
      return { writerId: operatorId, operationOwner: operatorId };
    }
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      !sameOrigin(request)
    ) {
      return anonymousCaller;
    }
    // @effect-diagnostics-next-line unstableApiUsage:off
    const cookies = Cookies.parseHeader(request.headers.get("cookie") ?? "");
    const writerId = readSession(cookies, writeCookie);
    return {
      writerId,
      operationOwner: readSession(cookies, operationCookie(request)),
    };
  };

  const issueSession = (
    request: Request,
    scope: "write" | "operations"
  ): Response => {
    const name = scope === "write" ? writeCookie : operationCookie(request);
    const url = new URL(request.url);
    const secure = url.protocol === "https:";
    const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    const headers = { "cache-control": "no-store" };
    if (
      !(secure || loopback) ||
      !sameOrigin(request) ||
      (scope === "write" && !verifyBearer(request))
    ) {
      return new Response(null, { headers, status: 401 });
    }
    // @effect-diagnostics-next-line unstableApiUsage:off
    const cookies = Cookies.parseHeader(request.headers.get("cookie") ?? "");
    const id =
      scope === "operations"
        ? (readSession(cookies, name) ?? randomUUID())
        : randomUUID();
    const session = `${id}.${nowSeconds() + sessionLifetimeSeconds}`;
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "set-cookie": `${name}=${session}.${sign(name, session)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetimeSeconds}${secure ? "; Secure" : ""}`,
      },
    });
  };

  return {
    verify,
    issueWriteSession: (request: Request) => issueSession(request, "write"),
    issueOperationSession: (request: Request) =>
      issueSession(request, "operations"),
  };
};
