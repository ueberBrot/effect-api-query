import { skipToken } from "@tanstack/query-core";
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

export interface PreparedInputOwner {
  readonly input: OperationInput;
  readonly encoder: RuntimeKeyEncoder | undefined;
}

export interface PreparedValue {
  readonly owner: PreparedInputOwner;
  readonly input: unknown;
  readonly keyValue: JsonValue;
}
const values = new WeakMap<object, PreparedValue>();
const registerPreparedInput = <Input>(
  value: PreparedValue
): PreparedInput<Input> => {
  const token = Object.freeze({
    "~effect-api-query/PreparedInput": Object.freeze({}),
  });
  values.set(token, value);
  return token;
};
const owners = new WeakMap<() => QueryKey, PreparedInputOwner>();

export const prepareQueryInput = (
  owner: Extract<OperationInput, { readonly _tag: "Input" }>,
  input: PreparedValue["input"],
  encoder: RuntimeKeyEncoder | undefined
) => {
  if (input === skipToken) {
    throw new TypeError("skipToken is only supported by query options");
  }
  const prepared = owner.prepare(input, encoder);
  try {
    return { input: prepared.input, keyValue: canonicalize(prepared.keyValue) };
  } catch (error) {
    throw owner.invalidKey(error);
  }
};

export const registerInputOwner = (
  key: () => QueryKey,
  owner: PreparedInputOwner
) => {
  owners.set(key, owner);
};

export const inputKind = (key: () => QueryKey) => owners.get(key)?.input._tag;

export const readPreparedInput = (
  owner: PreparedInputOwner | undefined,
  input: PreparedValue["input"]
) => {
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
  return registerPreparedInput({
    owner,
    ...prepareQueryInput(owner.input, input, owner.encoder),
  });
};

/** Descriptor rebinding creates a fresh token owned only by the receiving leaf. */
export const descriptorInput = <Input>(key: () => QueryKey, input: Input) => {
  if (Predicate.isObject(input) && values.has(input)) {
    throw new TypeError(
      "Descriptors require input values, not prepared tokens"
    );
  }
  const owner = owners.get(key);
  if (owner === undefined) {
    throw new TypeError("Descriptors require a generated query leaf");
  }
  if (owner.input._tag === "Inputless") {
    return { token: undefined, identity: null };
  }
  const prepared = prepareQueryInput(owner.input, input, owner.encoder);
  return {
    token: () => registerPreparedInput<Input>({ owner, ...prepared }),
    identity: prepared.keyValue,
  };
};
