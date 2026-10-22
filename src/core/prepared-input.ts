import type { QueryKey } from "@tanstack/query-core";
import { Predicate } from "effect";

import { canonicalize } from "./canonical-key";
import type { InferInput, SupportedQueryView } from "./inference";
import type { OperationInput, RuntimeKeyEncoder } from "./operation";
import type { JsonValue } from "./types";

/** Opaque, owner-bound preparation. Retained execution input must remain unchanged. */
export interface PreparedInput<Input> {
  readonly "~effect-api-query/PreparedInput": { readonly input?: Input };
}

interface PreparedValue {
  readonly owner: OperationInput;
  readonly input: unknown;
  readonly keyValue: JsonValue;
}
const values = new WeakMap<object, PreparedValue>();
const owners = new WeakMap<
  () => QueryKey,
  {
    readonly input: OperationInput;
    readonly encoder: RuntimeKeyEncoder | undefined;
  }
>();

export const registerInputOwner = (
  key: () => QueryKey,
  input: OperationInput,
  encoder: RuntimeKeyEncoder | undefined
) => {
  owners.set(key, { input, encoder });
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters
export const readPreparedInput = (owner: OperationInput, input: unknown) => {
  const prepared = Predicate.isObject(input) ? values.get(input) : undefined;
  if (prepared !== undefined && prepared.owner !== owner) {
    throw new TypeError("Prepared input belongs to another utility leaf");
  }
  return prepared;
};

/** Constructs and encodes once for repeated keys/options on this utility leaf. */
export const prepareInput = <Leaf extends { readonly key: () => QueryKey }>(
  leaf: Leaf & ([SupportedQueryView<Leaf>] extends [never] ? never : unknown),
  input: InferInput<NoInfer<Leaf>>
): PreparedInput<InferInput<Leaf>> => {
  const owner = owners.get(leaf.key);
  if (owner === undefined || owner.input._tag === "Inputless") {
    throw new TypeError(
      "Prepared inputs require a generated input-bearing query leaf"
    );
  }
  const prepared = owner.input.prepare(input, owner.encoder);
  let keyValue: JsonValue;
  try {
    keyValue = canonicalize(prepared.keyValue);
  } catch (error) {
    throw owner.input.invalidKey(error);
  }
  const token = Object.freeze({
    "~effect-api-query/PreparedInput": Object.freeze({}),
  });
  values.set(token, { owner: owner.input, input: prepared.input, keyValue });
  return token;
};
