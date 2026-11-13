import { recoverStream } from "@ueberbrot/effect-api-query";
import { Effect, Stream } from "effect";

const opaqueDelivery = recoverStream({
  initialCursor: "start",
  connect: (after: string) =>
    after === "start"
      ? Stream.succeed("id-z").pipe(Stream.concat(Stream.fail("offline")))
      : Stream.make("id-z", "id-a"),
  cursor: (id) => id,
  cursorPolicy: { accept: (previous, next) => previous !== next },
  retryDelay: (_cause, attempt) => (attempt === 1 ? 0 : undefined),
});
const ids = Effect.runPromise(Stream.runCollect(opaqueDelivery));
// Resolves to ["id-z", "id-a"].
