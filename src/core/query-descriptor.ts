import { hashKey } from "@tanstack/query-core";
import type { QueryKey } from "@tanstack/query-core";
import { Schema } from "effect";

import { canonicalize, canonicalizeArray } from "./canonical-key";
import type { InferInput, SupportedQueryView } from "./inference";
import { descriptorInput } from "./prepared-input";
import type { PreparedInput } from "./prepared-input";
import type { JsonValue } from "./types";
import { viewPrefix } from "./view-prefix";

declare const descriptorType: unique symbol;

/** A JSON selection. Contract revisions are application-owned compatibility identifiers. */
export interface QueryDescriptor<Leaf, View extends SupportedQueryView<Leaf>> {
  readonly [descriptorType]?: { readonly leaf: Leaf };
  readonly version: 1;
  readonly contract: string;
  readonly operation: readonly JsonValue[];
  readonly view: View;
  readonly input: JsonValue;
  readonly identity: JsonValue;
}

export class QueryDescriptorError extends Error {
  readonly _tag = "QueryDescriptorError";
  readonly code: "Malformed" | "Incompatible" | "Input" | "Identity";
  constructor(code: QueryDescriptorError["code"]) {
    super(`Query descriptor rejected: ${code}`);
    this.name = "QueryDescriptorError";
    this.code = code;
  }
}

const envelope = Schema.Struct({
  version: Schema.Literal(1),
  contract: Schema.String,
  operation: Schema.Array(Schema.Json),
  view: Schema.String,
  input: Schema.Json,
  identity: Schema.Json,
});

/** Binds one explicit operation/view to each receiving ready-client owner. */
export const createQueryDescriptor = <
  Leaf extends { readonly key: () => QueryKey },
  View extends SupportedQueryView<Leaf>,
  Encoded,
>(
  leaf: Leaf,
  view: View,
  options: {
    readonly contract: string;
    readonly input: Schema.Codec<InferInput<NoInfer<Leaf>>, Encoded>;
  }
) => {
  const operation = canonicalizeArray(leaf.key());
  const { contract } = options;
  const prefix = viewPrefix(leaf, view);
  if (!(`${view}Options` in leaf) || !(`${view}Key` in leaf)) {
    throw new QueryDescriptorError("Incompatible");
  }
  const encode = Schema.encodeUnknownSync(options.input);
  const decode = Schema.decodeUnknownSync(options.input);
  const prepare = (input: InferInput<Leaf>) => {
    try {
      return descriptorInput(leaf.key, input);
    } catch {
      throw new QueryDescriptorError("Input");
    }
  };
  return Object.freeze({
    capture: (input: InferInput<Leaf>): QueryDescriptor<Leaf, View> => {
      try {
        const prepared = prepare(input);
        const encoded = canonicalize(encode(input));
        const restored = prepare(decode(encoded));
        if (hashKey([prepared.identity]) !== hashKey([restored.identity])) {
          throw new QueryDescriptorError("Identity");
        }
        return Object.freeze({
          version: 1,
          contract,
          operation,
          view,
          input: encoded,
          identity: prepared.identity,
        });
      } catch (error) {
        if (error instanceof QueryDescriptorError) {
          throw error;
        }
        throw new QueryDescriptorError("Input");
      }
    },
    // oxlint-disable-next-line anti-slop/no-unknown-parameters
    bind: (value: unknown) => {
      let descriptor;
      try {
        descriptor = Schema.decodeUnknownSync(envelope, {
          onExcessProperty: "error",
        })(canonicalize(value));
      } catch {
        throw new QueryDescriptorError("Malformed");
      }
      if (
        descriptor.contract !== contract ||
        descriptor.view !== view ||
        hashKey(descriptor.operation) !== hashKey(operation)
      ) {
        throw new QueryDescriptorError("Incompatible");
      }
      let input: InferInput<Leaf>;
      try {
        input = decode(descriptor.input);
      } catch {
        throw new QueryDescriptorError("Input");
      }
      const prepared = prepare(input);
      if (hashKey([prepared.identity]) !== hashKey([descriptor.identity])) {
        throw new QueryDescriptorError("Identity");
      }
      return Object.freeze({
        leaf,
        view,
        prefix,
        // SAFETY: registered generated owners distinguish inputless leaves; other tokens retain this leaf's decoded input.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-invalid-void-type
        input: prepared.token as [InferInput<Leaf>] extends [void]
          ? InferInput<Leaf>
          : PreparedInput<InferInput<Leaf>>,
      });
    },
  });
};
