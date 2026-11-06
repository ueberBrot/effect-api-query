import { Reading, Readings } from "@effect-api-query/contracts";
import { replaceEqualDeep } from "@tanstack/query-core";
import { Schema } from "effect";

const isReadings = Schema.is(Readings);
const equivalent = Schema.toEquivalence(Reading);

export const shareReadings = (
  previous: unknown,
  incoming: unknown
): unknown => {
  if (!isReadings(previous) || !isReadings(incoming)) {
    return incoming;
  }
  const readings = incoming.readings.map((reading, index) => {
    const old = previous.readings[index];
    return old !== undefined && equivalent(old, reading) ? old : reading;
  });
  return replaceEqualDeep(previous, { ...incoming, readings });
};
