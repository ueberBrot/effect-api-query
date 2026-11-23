import { hashKey, skipToken } from "@tanstack/query-core";
import { Array as EffectArray, Effect, Exit, Predicate } from "effect";
import type { Cause } from "effect";

import { createBranchFilter } from "./branch-filter";
import type { FilterPath } from "./branch-filter";
import { canonicalizeArray } from "./canonical-key";
import type { UtilityNode } from "./configure-utils";
import type { QueryView } from "./inference";
import { prepareMetadataExecution } from "./metadata-query";
import { isInvalidUtilitySegment } from "./operation";
import type {
  BufferedOperation,
  MutationOperation,
  OperationDescription,
  QueryPreparation,
  RuntimeKeyEncoder,
  StreamingOperation,
  TreeErrors,
  UnaryOperation,
  UnaryQueryOperation,
} from "./operation";
import {
  prepareQueryInput,
  readPreparedInput,
  registerInputOwner,
} from "./prepared-input";
import type { QueryFilter, QueryFilterOptions } from "./query-filter";
import { resolveRuntime } from "./runtime";
import { clearStreamPolicy } from "./streamed-query";
import type {
  JsonValue,
  LivePolicyOptions,
  OptionalKeyPrefix,
  RunPromiseExit,
  RuntimeInput,
  StreamedPolicyOptions,
} from "./types";

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
  hasKeyPrefix: boolean,
  prefix: OptionalKeyPrefix | undefined,
  errors: TreeErrors
): readonly JsonValue[] => {
  if (!hasKeyPrefix) {
    return [];
  }
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
      segments.some(isInvalidUtilitySegment)
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

  return operation !== "call" &&
    operation !== "mutation" &&
    exit.value === undefined
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
  const reused = readPreparedInput(description.input, input);
  if (description.input._tag === "Inputless") {
    return {
      input: undefined,
      key:
        identity.length === 0
          ? operationKey
          : freezeKey([...operationKey, ...identity]),
    };
  }
  const prepared =
    reused ?? prepareQueryInput(description.input, input, keyEncoder);
  return {
    input: prepared.input,
    key: freezeKey([...operationKey, prepared.keyValue, ...identity]),
  };
};

type LeafFilterOptions = QueryFilterOptions &
  LivePolicyOptions &
  Partial<StreamedPolicyOptions> & {
    readonly view?: QueryView;
    readonly input?: unknown;
    readonly sseOptions?: unknown;
  };

const streamPolicyKeys = [
  "coalesceMs",
  "maxChunks",
  "refetchMode",
  "publicationBatchSize",
  "publicationMaxWaitMs",
  "sseOptions",
] as const;

const createLeafFilter =
  (
    description: UnaryOperation | StreamingOperation,
    operationKey: readonly JsonValue[],
    keyEncoder: RuntimeKeyEncoder | undefined,
    runPromiseExit: RunPromiseExit<unknown>
  ) =>
  (
    argument: LeafFilterOptions = {},
    defaults?: Partial<Record<"live" | "streamed", Record<string, unknown>>>
  ): QueryFilter => {
    const { view, input, ...options } = argument;
    if (view === undefined) {
      return { ...options, queryKey: operationKey };
    }

    const prefix = freezeKey([...operationKey, view]);
    const inputless = description.input._tag === "Inputless";
    const hasInput = Object.hasOwn(argument, "input");
    const identity =
      description.kind === "Streaming" &&
      (view === "live" || view === "streamed") &&
      streamPolicyKeys.some((key) => Object.hasOwn(options, key))
        ? description.prepareStream(
            { ...defaults?.[view], ...options },
            view,
            runPromiseExit,
            undefined
          ).identity
        : undefined;
    let queryKey = prefix;
    if (hasInput || (inputless && identity)) {
      queryKey = prepareQuery(
        description,
        input,
        prefix,
        keyEncoder,
        identity
      ).key;
    }
    if (identity) {
      clearStreamPolicy(options);
      delete options.sseOptions;
    }
    const filter = { ...options, queryKey };
    const hasCanonicalInput = hasInput && !inputless;
    if (options.exact === true || (!hasCanonicalInput && !identity)) {
      return filter;
    }
    const inputIndex = prefix.length;
    const inputHash = hasCanonicalInput
      ? hashKey([queryKey[inputIndex]])
      : undefined;
    const identityIndex = inputless ? inputIndex : inputIndex + 1;
    const identityHash = identity && hashKey(identity);
    filter.predicate = (query) =>
      (inputHash === undefined ||
        hashKey([query.queryKey[inputIndex]]) === inputHash) &&
      (identityHash === undefined ||
        (query.queryKey.length >= identityIndex &&
          hashKey(query.queryKey.slice(identityIndex)) === identityHash)) &&
      (options.predicate?.(query) ?? true);
    return filter;
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
  key: (argument?: unknown) => {
    if (argument !== undefined && !Predicate.isObject(argument)) {
      throw new TypeError("Query key options must be an object");
    }
    if (description.input._tag === "Inputless") {
      const options = argument === undefined ? {} : { ...argument };
      const identity = prepareIdentity?.(options) ?? [];
      return prepareQuery(
        description,
        undefined,
        operationKey,
        keyEncoder,
        identity
      ).key;
    }
    if (argument === undefined) {
      throw new TypeError("Query key options must be an object");
    }
    const options = { ...argument };
    const { input } = options;
    delete options["input"];
    const identity = prepareIdentity?.(options) ?? [];
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

  const infiniteKey = (argument?: unknown) => {
    if (description.input._tag === "Inputless") {
      return prepareQuery(
        description,
        undefined,
        infiniteOperationKey,
        keyEncoder
      ).key;
    }
    if (!Predicate.isObject(argument)) {
      throw new TypeError("Query key options must be an object");
    }
    return prepareQuery(
      description,
      argument["input"],
      infiniteOperationKey,
      keyEncoder
    ).key;
  };

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

const createBufferedBuilders = (
  description: UnaryOperation | MutationOperation,
  operationKey: readonly JsonValue[],
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const mutationKey = freezeKey([...operationKey, "mutation"]);

  const prepareDirect = (argument: Record<string, unknown> = {}) => {
    const options = { ...argument };
    const owner = description.kind === "Unary" ? description.input : undefined;
    const prepared = readPreparedInput(owner, options["input"]);
    return {
      input: prepared === undefined ? options["input"] : prepared.input,
      requestOptions: description.takeOptions(options),
    };
  };

  const call = async (
    argument?: Record<string, unknown> & { readonly signal?: AbortSignal }
  ) => {
    const { input, requestOptions } = prepareDirect(argument);
    return execute(
      description,
      "call",
      input,
      runPromiseExit,
      requestOptions,
      argument?.signal
    );
  };
  const bindDirectEffect =
    <Result>(
      invoke: (...args: Parameters<BufferedOperation["invoke"]>) => Result
    ) =>
    (argument?: Record<string, unknown>) => {
      const { input, requestOptions } = prepareDirect(argument);
      return invoke(input, requestOptions);
    };

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
  return {
    call,
    effect: bindDirectEffect(description.invoke),
    mutationKey: () => mutationKey,
    mutationOptions,
  };
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
    queryFilter: createLeafFilter(
      description,
      operationKey,
      keyEncoder,
      runPromiseExit
    ),
    ...createInfiniteBuilders(
      description,
      operationKey,
      keyEncoder,
      runPromiseExit
    ),
    ...createBufferedBuilders(description, operationKey, runPromiseExit),
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
    queryFilter: createLeafFilter(
      description,
      operationKey,
      keyEncoder,
      runPromiseExit
    ),
    liveKey: live.key,
    liveOptions: live.options,
    streamedKey: streamed.key,
    streamedOptions: streamed.options,
  };
};

const validateKeyEncoders = (
  operations: readonly OperationDescription[],
  keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>,
  errors: TreeErrors
) => {
  const supportedIds = new Set<string>();
  for (const operation of operations) {
    if (operation.kind !== "Mutation" && operation.input._tag !== "Inputless") {
      supportedIds.add(operation.id);
    }
  }
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

export interface LeafRuntimeDescriptor {
  readonly runner: RunPromiseExit<unknown>;
  readonly rebuild: (
    runner: RunPromiseExit<unknown>
  ) => Record<string, unknown>;
}

export interface LazyLeafSlot {
  readonly materialize: () => Record<string, unknown> & UtilityNode;
  readonly ownerToken?: symbol | undefined;
}

const leafDescriptors = new WeakMap<UtilityNode, LeafRuntimeDescriptor>();
const lazyLeafGetters = new WeakMap<() => unknown, LazyLeafSlot>();

export const readLeafDescriptor = (
  node: UtilityNode
): LeafRuntimeDescriptor | undefined => leafDescriptors.get(node);

export const defineLazyLeafDescriptor = (
  materialize: () => Record<string, unknown> & UtilityNode,
  ownerToken?: symbol
): PropertyDescriptor => {
  let cached: (Record<string, unknown> & UtilityNode) | undefined;
  const get = () => {
    cached ??= materialize();
    return cached;
  };
  lazyLeafGetters.set(get, { materialize: get, ownerToken });
  return {
    enumerable: true,
    configurable: false,
    get,
  };
};

export const readLazyLeafSlot = (
  descriptor: PropertyDescriptor | undefined
): LazyLeafSlot | undefined => {
  // oxlint-disable-next-line typescript/unbound-method
  const getter = descriptor?.get;
  return getter === undefined ? undefined : lazyLeafGetters.get(getter);
};

export const buildBranchFrom = (
  source: Record<string, unknown> & UtilityNode,
  replacements: ReadonlyMap<string, PropertyDescriptor>
): Record<string, unknown> & UtilityNode => {
  const next: Record<string, unknown> = {};
  for (const name of Object.keys(source)) {
    const descriptor =
      replacements.get(name) ?? Object.getOwnPropertyDescriptor(source, name);
    if (descriptor !== undefined) {
      Object.defineProperty(next, name, descriptor);
    }
  }
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  return Object.freeze(next) as Record<string, unknown> & UtilityNode;
};

interface BuildBranch {
  readonly node: Record<string, unknown>;
  readonly children: Map<string, BuildBranch>;
  readonly paths: FilterPath[];
}

const buildBranch = (key: readonly JsonValue[]): BuildBranch => {
  const paths: FilterPath[] = [];
  return {
    node: { key: () => key, queryFilter: createBranchFilter(key, paths) },
    children: new Map(),
    paths,
  };
};

const freezeBranch = (branch: BuildBranch) => {
  for (const child of branch.children.values()) {
    freezeBranch(child);
  }
  return Object.freeze(branch.node);
};

const operationViews = (
  operation: OperationDescription
): readonly QueryView[] => {
  if (operation.kind === "Mutation") {
    return [];
  }
  if (operation.kind === "Streaming") {
    return ["live", "streamed"];
  }
  return operation.metadata === undefined
    ? ["query", "infinite"]
    : ["query", "infinite", "metadata"];
};

const insertLeaf = (
  tree: BuildBranch,
  prefix: readonly JsonValue[],
  path: ValidatedOperationPath,
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const { segments } = path;
  const operation =
    path.operation.kind === "Mutation"
      ? path.operation
      : { ...path.operation, input: { ...path.operation.input } };
  const operationKey = freezeKey([...prefix, ...segments]);
  const filterPath: FilterPath = {
    key: operationKey,
    views: operationViews(operation),
  };
  let branch = tree;
  branch.paths.push(filterPath);
  for (const [index, segment] of segments.slice(0, -1).entries()) {
    let child = branch.children.get(segment);
    if (child === undefined) {
      child = buildBranch(
        freezeKey([...prefix, ...segments.slice(0, index + 1)])
      );
      branch.children.set(segment, child);
      branch.node[segment] = child.node;
    }
    branch = child;
    branch.paths.push(filterPath);
  }

  const leafName = segments.at(-1);
  if (leafName === undefined) {
    throw new TypeError("Validated operation paths must have a leaf");
  }
  const leafKey = () => operationKey;
  const buildLeaf = (leafRunner: RunPromiseExit<unknown>) => {
    let builders;
    if (operation.kind === "Mutation") {
      builders = createBufferedBuilders(operation, operationKey, leafRunner);
    } else if (operation.kind === "Streaming") {
      builders = createStreamingBuilders(
        operation,
        operationKey,
        keyEncoder,
        leafRunner
      );
    } else {
      builders = createUnaryBuilders(
        operation,
        operationKey,
        keyEncoder,
        leafRunner
      );
    }
    return Object.freeze({ key: leafKey, ...builders });
  };
  Object.defineProperty(
    branch.node,
    leafName,
    defineLazyLeafDescriptor(() => {
      const leaf = buildLeaf(runPromiseExit);
      leafDescriptors.set(leaf, { runner: runPromiseExit, rebuild: buildLeaf });
      if (operation.kind !== "Mutation") {
        registerInputOwner(leaf.key, operation.input, keyEncoder);
      }
      return leaf;
    })
  );
};

const createTree = (
  prefix: readonly JsonValue[],
  paths: readonly ValidatedOperationPath[],
  keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const tree = buildBranch(prefix);

  for (const path of paths) {
    insertLeaf(
      tree,
      prefix,
      path,
      keyEncoders.get(path.operation.id),
      runPromiseExit
    );
  }
  return freezeBranch(tree);
};

export const createUtilityTree = (
  operations: readonly OperationDescription[],
  options: {
    readonly hasKeyPrefix: boolean;
    readonly keyPrefix: OptionalKeyPrefix | undefined;
    readonly keyNamespace: readonly string[];
    readonly keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>;
    readonly runtime: RuntimeInput<unknown> | undefined;
    readonly errors: TreeErrors;
  }
): Record<string, unknown> => {
  const prefix = freezeKey([
    ...normalizePrefix(options.hasKeyPrefix, options.keyPrefix, options.errors),
    ...options.keyNamespace,
  ]);
  const paths = planPaths(operations, options.errors);
  validateKeyEncoders(operations, options.keyEncoders, options.errors);
  const runner =
    options.runtime === undefined
      ? // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
        (Effect.runPromiseExit as RunPromiseExit<unknown>)
      : resolveRuntime(options.runtime);
  return createTree(prefix, paths, options.keyEncoders, runner);
};
