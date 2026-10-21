import type { QueryFunction } from "@tanstack/query-core";
import type { Cause, Effect } from "effect";

import type { JsonValue, RunPromiseExit } from "./types";

export type RuntimeKeyEncoder = (input: unknown) => JsonValue;
export type UnaryQueryOperation = "query" | "infinite" | "mutation";

export type OperationInput =
  | { readonly _tag: "Inputless" }
  | {
      readonly _tag: "Input";
      readonly requiresEncoder: boolean;
      readonly cacheable: boolean;

      readonly pageInput: (input: unknown) => unknown;
      readonly prepare: (
        input: unknown,
        encoder: RuntimeKeyEncoder | undefined
      ) => { readonly input: unknown; readonly keyValue: unknown };
      readonly invalidKey: (cause: unknown) => Error;
    };

export interface OperationIdentity {
  readonly id: string;
  readonly path: readonly string[];
  readonly unsupportedQueryHash: (
    option: "queryKeyHashFn" | "queryHash"
  ) => Error;

  readonly takeOptions: (options: Record<string, unknown>) => unknown;
}

export interface BufferedOperation extends OperationIdentity {
  readonly invoke: (
    input: unknown,

    options: unknown
  ) => Effect.Effect<unknown, unknown, unknown>;
  readonly executionError: (
    operation: UnaryQueryOperation,
    cause: Cause.Cause<unknown>
  ) => Error;
}

export interface UnaryOperation extends BufferedOperation {
  readonly kind: "Unary";
  readonly input: OperationInput;
  readonly metadata?: {
    readonly invoke: BufferedOperation["invoke"];
    readonly executionError: (
      operation: "metadata",
      cause: Cause.Cause<unknown>
    ) => Error;

    readonly finalizeData: (data: unknown) => unknown;
  };
}

export interface MutationOperation extends BufferedOperation {
  readonly kind: "Mutation";
}

export interface QueryPreparation {
  readonly identity: readonly JsonValue[];

  readonly makeQuery: (input: unknown) => QueryFunction;
}

export interface StreamingOperation extends OperationIdentity {
  readonly kind: "Streaming";
  readonly input: OperationInput;
  readonly prepareStream: (
    options: Record<string, unknown>,
    operation: "live" | "streamed",
    runner: RunPromiseExit<unknown>,

    requestOptions: unknown
  ) => QueryPreparation;
}

export type OperationDescription =
  | UnaryOperation
  | MutationOperation
  | StreamingOperation;

export interface TreeErrors {
  readonly invalidPrefix: (reason: "Shape" | "Value", cause?: unknown) => Error;
  readonly invalidPath: (id: string) => Error;
  readonly pathCollision: (
    id: string,
    path: readonly string[],
    relation: "collides with" | "duplicates"
  ) => Error;
  readonly unknownEncoder: (id: string) => Error;
  readonly missingEncoder: (id: string) => Error;
}
