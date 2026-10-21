import { skipToken } from "@tanstack/query-core";
import { Array as EffectArray, Effect, Exit, Predicate } from "effect";
import type { Cause } from "effect";

import { canonicalize, canonicalizeArray } from "./canonical-key";
import { prepareMetadataExecution } from "./metadata-query";
import type {
  BufferedOperation,
  OperationDescription,
  QueryPreparation,
  RuntimeKeyEncoder,
  StreamingOperation,
  TreeErrors,
  UnaryOperation,
  UnaryQueryOperation,
} from "./operation";
import type { JsonValue, RunPromiseExit } from "./types";

const reservedPathSegments = new Set([
  "__proto__",
  "constructor",
  "infiniteKey",
  "infiniteOptions",
  "key",
  "liveKey",
  "liveOptions",
  "metadataKey",
  "metadataOptions",
  "mutationKey",
  "mutationOptions",
  "prototype",
  "queryKey",
  "queryOptions",
  "streamedKey",
  "streamedOptions",
]);

interface PreparedQuery {
  readonly input: unknown;
  readonly key: readonly JsonValue[];
}

interface ValidatedOperationPath {
  readonly operation: OperationDescription;
  readonly segments: readonly [string, ...string[]];
}

const freezeKey = (parts: JsonValue[]) => Object.freeze(parts);

const normalizePrefix = (
  prefix: readonly [JsonValue, ...JsonValue[]],
  errors: TreeErrors
): readonly JsonValue[] => {
  if (!Array.isArray(prefix) || prefix.length === 0) {
    throw errors.invalidPrefix("Shape");
  }

  try {
    return canonicalizeArray(prefix);
  } catch (error) {
    throw errors.invalidPrefix("Value", error);
  }
};

const planPaths = (
  operations: readonly OperationDescription[],
  errors: TreeErrors
) => {
  const branchPaths = new Map<string, readonly string[]>();
  const leafPaths = new Set<string>();
  const plan: ValidatedOperationPath[] = [];

  for (const operation of operations) {
    const segments = operation.path;
    if (
      !EffectArray.isReadonlyArrayNonEmpty(segments) ||
      segments.some(
        (segment) => segment.length === 0 || reservedPathSegments.has(segment)
      )
    ) {
      throw errors.invalidPath(operation.id);
    }
    const pathKey = JSON.stringify(segments);
    if (leafPaths.has(pathKey)) {
      throw errors.pathCollision(operation.id, segments, "duplicates");
    }
    const descendantPath = branchPaths.get(pathKey);
    if (descendantPath !== undefined) {
      throw errors.pathCollision(operation.id, descendantPath, "collides with");
    }
    const parents: string[] = [];
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index);
      const parentKey = JSON.stringify(parent);
      if (leafPaths.has(parentKey)) {
        throw errors.pathCollision(operation.id, parent, "collides with");
      }
      parents.push(parentKey);
    }
    for (const parent of parents) {
      if (!branchPaths.has(parent)) {
        branchPaths.set(parent, segments);
      }
    }
    leafPaths.add(pathKey);
    plan.push({
      operation,
      segments,
    });
  }
  return plan;
};

const execute = async <Operation extends UnaryQueryOperation | "metadata">(
  description: {
    readonly invoke: UnaryOperation["invoke"];
    readonly executionError: (
      operation: Operation,
      cause: Cause.Cause<unknown>
    ) => Error;
  },
  operation: Operation,

  input: unknown,
  runPromiseExit: RunPromiseExit<unknown>,

  requestOptions?: unknown,
  signal?: AbortSignal
) => {
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
  const effect = description.invoke(input, requestOptions);
  const exit = await runPromiseExit(
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
    effect,
    signal === undefined ? undefined : { signal }
  );

  if (Exit.isFailure(exit)) {
    throw description.executionError(operation, exit.cause);
  }

  return operation !== "mutation" && exit.value === undefined
    ? null
    : exit.value;
};

const prepareQuery = (
  description: UnaryOperation | StreamingOperation,

  input: unknown,
  operationKey: readonly JsonValue[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  identity: readonly JsonValue[] = []
): PreparedQuery => {
  if (description.input._tag === "Inputless") {
    return {
      input: undefined,
      key:
        identity.length === 0
          ? operationKey
          : freezeKey([...operationKey, ...identity]),
    };
  }
  const prepared = description.input.prepare(input, keyEncoder);
  try {
    return {
      input: prepared.input,
      key: freezeKey([
        ...operationKey,
        canonicalize(prepared.keyValue),
        ...identity,
      ]),
    };
  } catch (error) {
    throw description.input.invalidKey(error);
  }
};

const prepareQueryOptions = (
  description: OperationDescription,

  argument: unknown
) => {
  if (argument !== undefined && !Predicate.isObject(argument)) {
    throw new TypeError("Query options must be an object");
  }
  const options = { ...argument };
  for (const option of ["queryKeyHashFn", "queryHash"] as const) {
    if (Object.hasOwn(options, option)) {
      throw description.unsupportedQueryHash(option);
    }
  }
  const { input } = options;
  delete options["input"];
  const requestOptions = description.takeOptions(options);
  return { input, options, requestOptions };
};

const finalizeQueryOptions = <QueryFn>(
  options: Record<string, unknown>,
  queryKey: readonly JsonValue[],
  queryFn: QueryFn
) => ({
  ...options,
  queryFn,
  queryKey,
});

const createQueryBuilders = (
  description: UnaryOperation | StreamingOperation,
  operationKey: readonly JsonValue[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  prepareOptions: (
    options: Record<string, unknown>,

    requestOptions: unknown,

    input: unknown
  ) => QueryPreparation,

  prepareIdentity?: (options: Record<string, unknown>) => readonly JsonValue[]
) => ({
  key: (input?: unknown, policy?: Record<string, unknown>) => {
    const options = description.input._tag === "Inputless" ? input : policy;
    const identity =
      prepareIdentity?.(Predicate.isObject(options) ? { ...options } : {}) ??
      [];
    return prepareQuery(description, input, operationKey, keyEncoder, identity)
      .key;
  },

  options: (argument?: unknown) => {
    const { input, options, requestOptions } = prepareQueryOptions(
      description,
      argument
    );
    const { identity, makeQuery } = prepareOptions(
      options,
      requestOptions,
      input
    );
    if (description.input._tag !== "Inputless" && input === skipToken) {
      return finalizeQueryOptions(options, operationKey, skipToken);
    }
    const prepared = prepareQuery(
      description,
      input,
      operationKey,
      keyEncoder,
      identity
    );
    return finalizeQueryOptions(
      options,
      prepared.key,
      makeQuery(prepared.input)
    );
  },
});

const createInfiniteBuilders = (
  description: UnaryOperation,
  operationKey: readonly JsonValue[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const infiniteOperationKey = freezeKey([...operationKey, "infinite"]);

  const infiniteKey = (input?: unknown) =>
    prepareQuery(description, input, infiniteOperationKey, keyEncoder).key;

  const infiniteOptions = (argument: Record<string, unknown>) => {
    const { input, options, requestOptions } = prepareQueryOptions(
      description,
      argument
    );
    if (description.input._tag !== "Inputless" && input === skipToken) {
      return finalizeQueryOptions(options, infiniteOperationKey, skipToken);
    }

    const { initialPageParam } = options;
    const inputForPage =
      // oxlint-disable-next-line unicorn/no-useless-undefined
      description.input._tag === "Inputless" ? () => undefined : input;
    if (!Predicate.isFunction(inputForPage)) {
      throw new TypeError("Infinite query input must be a page input function");
    }
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
    const pageInput = inputForPage as (pageParam: unknown) => unknown;
    const initialInput = pageInput(initialPageParam);
    const prepared = prepareQuery(
      description,
      initialInput,
      infiniteOperationKey,
      keyEncoder
    );

    return finalizeQueryOptions(
      options,
      prepared.key,
      async ({
        pageParam,
        signal,
      }: {
        readonly pageParam: unknown;
        readonly signal: AbortSignal;
      }) => {
        const pageRequest = pageInput(pageParam);
        const executionInput =
          description.input._tag === "Input"
            ? description.input.pageInput(pageRequest)
            : undefined;
        return execute(
          description,
          "infinite",
          executionInput,
          runPromiseExit,
          requestOptions,
          signal
        );
      }
    );
  };

  return { infiniteKey, infiniteOptions };
};

const createMutationBuilders = (
  description: BufferedOperation,
  operationKey: readonly JsonValue[],
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const mutationKey = freezeKey([...operationKey, "mutation"]);

  const mutationOptions = (argument: Record<string, unknown> = {}) => {
    const options = { ...argument };
    const requestOptions = description.takeOptions(options);
    return {
      ...options,

      mutationFn: async (variables: unknown) =>
        execute(
          description,
          "mutation",
          variables,
          runPromiseExit,
          requestOptions
        ),
      mutationKey,
    };
  };
  return { mutationKey: () => mutationKey, mutationOptions };
};

const createUnaryBuilders = (
  description: UnaryOperation,
  operationKey: readonly JsonValue[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const queryOperationKey = freezeKey([...operationKey, "query"]);
  const query = createQueryBuilders(
    description,
    queryOperationKey,
    keyEncoder,
    (_options, requestOptions) => ({
      identity: [],
      makeQuery:
        (input) =>
        async ({ signal }) =>
          execute(
            description,
            "query",
            input,
            runPromiseExit,
            requestOptions,
            signal
          ),
    })
  );
  const { metadata } = description;
  const metadataQuery =
    metadata === undefined
      ? undefined
      : createQueryBuilders(
          description,
          freezeKey([...operationKey, "metadata"]),
          keyEncoder,
          (options, requestOptions, input) => ({
            identity: [],
            makeQuery: prepareMetadataExecution(
              metadata,
              options,
              runPromiseExit,
              requestOptions,
              description.input._tag !== "Inputless" && input === skipToken
            ),
          })
        );

  return {
    ...createInfiniteBuilders(
      description,
      operationKey,
      keyEncoder,
      runPromiseExit
    ),
    ...createMutationBuilders(description, operationKey, runPromiseExit),
    queryKey: query.key,
    queryOptions: query.options,
    ...(metadataQuery === undefined
      ? undefined
      : {
          metadataKey: metadataQuery.key,
          metadataOptions: metadataQuery.options,
        }),
  };
};

const createStreamingBuilders = (
  description: StreamingOperation,
  operationKey: readonly JsonValue[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const createView = (operation: "live" | "streamed") => {
    const prepare = (
      options: Record<string, unknown>,

      requestOptions?: unknown
    ) =>
      description.prepareStream(
        options,
        operation,
        runPromiseExit,
        requestOptions
      );
    return createQueryBuilders(
      description,
      freezeKey([...operationKey, operation]),
      keyEncoder,
      prepare,
      (options) => prepare(options).identity
    );
  };
  const live = createView("live");
  const streamed = createView("streamed");

  return {
    liveKey: live.key,
    liveOptions: live.options,
    streamedKey: streamed.key,
    streamedOptions: streamed.options,
  };
};

const deepFreezeTree = (value: Record<string, unknown>) => {
  for (const child of Object.values(value)) {
    if (Predicate.isObject(child)) {
      deepFreezeTree(child);
    }
  }
  return Object.freeze(value);
};

const validateKeyEncoders = (
  operations: readonly OperationDescription[],
  keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>,
  errors: TreeErrors
) => {
  const supportedIds = new Set(
    operations
      .filter(
        (operation) =>
          operation.kind !== "Mutation" && operation.input._tag !== "Inputless"
      )
      .map((operation) => operation.id)
  );
  for (const id of keyEncoders.keys()) {
    if (!supportedIds.has(id)) {
      throw errors.unknownEncoder(id);
    }
  }
  for (const operation of operations) {
    if (
      operation.kind !== "Mutation" &&
      operation.input._tag === "Input" &&
      operation.input.requiresEncoder &&
      !Predicate.isFunction(keyEncoders.get(operation.id))
    ) {
      throw errors.missingEncoder(operation.id);
    }
  }
};

const insertLeaf = (
  tree: Record<string, unknown>,
  prefix: readonly JsonValue[],
  path: ValidatedOperationPath,
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const { operation, segments } = path;
  let branch = tree;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      throw new TypeError(
        "Validated operation paths must have defined segments"
      );
    }
    const candidate = Object.hasOwn(branch, segment)
      ? branch[segment]
      : undefined;
    let child = Predicate.isObject(candidate) ? candidate : undefined;
    if (child === undefined) {
      const key = freezeKey([...prefix, ...segments.slice(0, index + 1)]);
      child = { key: () => key };
      branch[segment] = child;
    }
    branch = child;
  }

  const leafName = segments.at(-1);
  if (leafName === undefined) {
    throw new TypeError("Validated operation paths must have a leaf");
  }
  const operationKey = freezeKey([...prefix, ...segments]);
  let builders;
  if (operation.kind === "Mutation") {
    builders = createMutationBuilders(operation, operationKey, runPromiseExit);
  } else if (operation.kind === "Streaming") {
    builders = createStreamingBuilders(
      operation,
      operationKey,
      keyEncoder,
      runPromiseExit
    );
  } else {
    builders = createUnaryBuilders(
      operation,
      operationKey,
      keyEncoder,
      runPromiseExit
    );
  }
  branch[leafName] = { key: () => operationKey, ...builders };
};

const createTree = (
  prefix: readonly JsonValue[],
  paths: readonly ValidatedOperationPath[],
  keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const tree = { key: () => prefix };

  for (const path of paths) {
    insertLeaf(
      tree,
      prefix,
      path,
      keyEncoders.get(path.operation.id),
      runPromiseExit
    );
  }
  return deepFreezeTree(tree);
};

export const createUtilityTree = (
  operations: readonly OperationDescription[],
  options: {
    readonly keyPrefix: readonly [JsonValue, ...JsonValue[]];
    readonly keyNamespace: readonly string[];
    readonly keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>;
    readonly runPromiseExit: RunPromiseExit<unknown> | undefined;
    readonly errors: TreeErrors;
  }
): Record<string, unknown> => {
  const prefix = freezeKey([
    ...normalizePrefix(options.keyPrefix, options.errors),
    ...options.keyNamespace,
  ]);
  const paths = planPaths(operations, options.errors);
  validateKeyEncoders(operations, options.keyEncoders, options.errors);
  const runner =
    options.runPromiseExit ??
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
    (Effect.runPromiseExit as RunPromiseExit<unknown>);
  return createTree(prefix, paths, options.keyEncoders, runner);
};
