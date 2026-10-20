import { Function, Predicate, Schema, SchemaAST } from "effect";

export interface SchemaKeyEncoding {
  readonly requiresEncoder: boolean;
  readonly cacheable: boolean;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns
  readonly encode: (input: unknown) => unknown;
}

const safeAsts = new WeakSet();
const encodings = new WeakMap<Schema.Top, SchemaKeyEncoding>();
type SchemaKeyAnalysis = "Safe" | "RequiresEncoder" | "Retry";

const inspectKeyEncoding = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown,
  seen: Set<object>
): SchemaKeyAnalysis => {
  if (
    !Predicate.isObjectOrArray(value) ||
    seen.has(value) ||
    safeAsts.has(value)
  ) {
    return "Safe";
  }
  seen.add(value);

  if (Predicate.hasProperty(value, "_tag") && value._tag === "Middleware") {
    return !Predicate.hasProperty(value, "encode") ||
      value.encode !== Function.identity
      ? "RequiresEncoder"
      : "Safe";
  }

  if (SchemaAST.isAST(value)) {
    const representation = value.annotations?.["representation"];
    if (
      Predicate.hasProperty(representation, "id") &&
      representation.id === "effect/schema/Redacted"
    ) {
      return "RequiresEncoder";
    }
    if (SchemaAST.isSuspend(value)) {
      try {
        const analysis = inspectKeyEncoding(value.thunk(), seen);
        if (analysis !== "Safe") {
          return analysis;
        }
      } catch {
        return "Retry";
      }
    }
  }

  for (const child of Object.values(value)) {
    const analysis = inspectKeyEncoding(child, seen);
    if (analysis !== "Safe") {
      return analysis;
    }
  }
  return "Safe";
};

export const createSchemaKeyEncoding = (
  schema: Schema.Top
): SchemaKeyEncoding => {
  const cached = encodings.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const seen = new Set<object>();
  const analysis = inspectKeyEncoding(schema.ast, seen);
  let defaultEncode: SchemaKeyEncoding["encode"] | undefined;

  const encoding: SchemaKeyEncoding = {
    requiresEncoder: analysis !== "Safe",
    cacheable: analysis !== "Retry",
    encode: (input) => {
      if (defaultEncode === undefined) {
        const encodingSchema =
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
          schema as unknown as Schema.ConstraintEncoder<unknown>;
        defaultEncode = Schema.encodeUnknownSync(encodingSchema);
      }
      return defaultEncode(input);
    },
  };
  if (analysis === "Safe") {
    for (const node of seen) {
      if (SchemaAST.isAST(node)) {
        safeAsts.add(node);
      }
    }
  }
  if (encoding.cacheable) {
    encodings.set(schema, encoding);
  }
  return encoding;
};
