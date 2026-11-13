import { Reading } from "@effect-api-query/contracts";
import { schemaStructuralSharing } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";

export const shareReadings = schemaStructuralSharing(Reading, {
  equivalence: Schema.toEquivalence(Reading),
});
