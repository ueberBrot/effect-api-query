import { replaceEqualDeep } from "@tanstack/query-core";
import { schemaStructuralSharing } from "@ueberbrot/effect-api-query";
import { Equivalence, Schema } from "effect";

export class Reading extends Schema.Class<
  Reading,
  { readonly brand: unique symbol }
>("Reading")({
  id: Schema.Int,
  observedAt: Schema.DateFromString,
  values: Schema.ReadonlyMap(Schema.String, Schema.Int),
  labels: Schema.ReadonlySet(Schema.String),
  note: Schema.OptionFromNullOr(Schema.String),
  attachment: Schema.Unknown.pipe(
    Schema.overrideToEquivalence(() => Equivalence.strictEqual())
  ),
}) {}

export const Snapshot = Schema.Struct({
  revision: Schema.Int,
  readings: Schema.Array(Reading),
});

const isSnapshot = Schema.is(Snapshot);
const equivalentReading = Schema.toEquivalence(Reading);
export const shareSnapshotRecipe = (
  previous: unknown,
  incoming: unknown
): unknown => {
  if (!isSnapshot(previous) || !isSnapshot(incoming)) return incoming;
  const readings = incoming.readings.map((reading, index) => {
    const old = previous.readings[index];
    return old !== undefined && equivalentReading(old, reading) ? old : reading;
  });
  return replaceEqualDeep(previous, { ...incoming, readings });
};

export const shareSnapshot = schemaStructuralSharing(Reading, {
  equivalence: Schema.toEquivalence(Reading),
});

export const shareMetadataSnapshot = shareSnapshot;
