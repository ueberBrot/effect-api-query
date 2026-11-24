import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { ExampleAuthorizationError } from "@effect-api-query/contracts";
import { Context, Effect, Option, Schema } from "effect";
import type { Clock } from "effect";
import { Cookies } from "effect/http";

export interface DemoWriter {
  readonly id: string;
  readonly role: "demo-writer";
}

export const VerifiedCaller = Context.Reference<DemoWriter | null>(
  "@effect-api-query/server/VerifiedCaller",
  { defaultValue: () => null }
);

export const requireDemoWriter = Effect.gen(function* () {
  const caller = yield* VerifiedCaller;
  if (caller?.role !== "demo-writer") {
    return yield* new ExampleAuthorizationError({
      reason: "missing-example-authorization",
    });
  }
  return yield* Effect.void;
});

const cookieName = "example-write-session";
const sessionLifetimeSeconds = 3600;
const decodeSession = Schema.decodeUnknownOption(
  Schema.Tuple([
    Schema.String.check(Schema.isUUID(4)),
    Schema.String.check(Schema.isPattern(/^\d{1,15}$/u)),
    Schema.String.check(Schema.isPattern(/^[\w-]{43}$/u)),
  ])
);

const digest = (value: string) => createHash("sha256").update(value).digest();

const writer = (id: string): DemoWriter =>
  Object.freeze({ id, role: "demo-writer" });
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
  const operator = writer(randomUUID());
  const nowSeconds = () => Math.floor(clock.currentTimeMillisUnsafe() / 1000);
  const sign = (session: string) =>
    createHmac("sha256", key).update(session).digest("base64url");
  const verifyBearer = (request: Request) => {
    const header = request.headers.get("authorization");
    return (
      header !== null &&
      tokenHash !== undefined &&
      timingSafeEqual(digest(header), tokenHash)
    );
  };

  const verify = (request: Request): DemoWriter | null => {
    if (verifyBearer(request)) {
      return operator;
    }
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      !sameOrigin(request)
    ) {
      return null;
    }
    // @effect-diagnostics-next-line unstableApiUsage:off
    const cookies = Cookies.parseHeader(request.headers.get("cookie") ?? "");
    const session = decodeSession(cookies[cookieName]?.split("."));
    if (Option.isNone(session)) {
      return null;
    }
    const [id, expires, signature] = session.value;
    if (
      Number(expires) <= nowSeconds() ||
      !timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(sign(`${id}.${expires}`))
      )
    ) {
      return null;
    }
    return writer(id);
  };

  const issueSession = (request: Request): Response => {
    const url = new URL(request.url);
    const secure = url.protocol === "https:";
    const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    const headers = { "cache-control": "no-store" };
    if (
      !(secure || loopback) ||
      !sameOrigin(request) ||
      !verifyBearer(request)
    ) {
      return new Response(null, { headers, status: 401 });
    }
    const session = `${randomUUID()}.${nowSeconds() + sessionLifetimeSeconds}`;
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "set-cookie": `${cookieName}=${session}.${sign(session)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetimeSeconds}${secure ? "; Secure" : ""}`,
      },
    });
  };

  return { verify, issueSession };
};
