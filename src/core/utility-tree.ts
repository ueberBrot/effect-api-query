import { hashKey, skipToken } from "@tanstack/query-core";
import { Effect, Exit, Predicate } from "effect";
import type { Cause } from "effect";

import { createBranchFilter } from "./branch-filter";
import type { FilterPath } from "./branch-filter";
import type { QueryView } from "./inference";
import { prepareMetadataExecution } from "./metadata-query";
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
import { clearStreamPolicy, hasStreamPolicy } from "./streamed-query";
import type {
  JsonValue,
  LivePolicyOptions,
  RunPromiseExit,
  RuntimeInput,
  StreamedPolicyOptions,
} from "./types";
import { defineLazyLeafDescriptor } from "./utility-node";
import type { RuntimeUtilityNode, UtilityNode } from "./utility-node";
import {
  normalizeUtilityKeyPrefix,
  validateUtilityPaths,
} from "./utility-path";
import type { KeyPrefixInput, UtilityPath } from "./utility-path";

interface PreparedQuery {
  readonly input: unknown;
  readonly key: readonly JsonValue[];
}

const freezeKey = (parts: JsonValue[]) => Object.freeze(parts);

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

const matchLeafSegments = (
  filter: QueryFilter,
  inputIndex: number,
  inputless: boolean,
  hasInput: boolean,
  identity: readonly JsonValue[] | undefined
): QueryFilter => {
  if (filter.exact === true) {
    return !inputless && !hasInput && identity !== undefined
      ? { ...filter, predicate: () => false }
      : filter;
  }
  const hasCanonicalInput = hasInput && !inputless;
  if (!hasCanonicalInput && identity === undefined) {
    return filter;
  }
  const inputHash = hasCanonicalInput
    ? hashKey([filter.queryKey[inputIndex]])
    : undefined;
  const identityIndex = inputless ? inputIndex : inputIndex + 1;
  const identityHash = identity && hashKey(identity);
  return {
    ...filter,
    predicate: (query) =>
      (inputHash === undefined ||
        hashKey([query.queryKey[inputIndex]]) === inputHash) &&
      (identityHash === undefined ||
        (query.queryKey.length >= identityIndex &&
          hashKey(query.queryKey.slice(identityIndex)) === identityHash)) &&
      (filter.predicate?.(query) ?? true),
  };
};

const createLeafFilter =
  (
    description: UnaryOperation | StreamingOperation,
    operationKey: readonly JsonValue[],
    keyEncoder: RuntimeKeyEncoder | undefined
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
      hasStreamPolicy(options)
        ? description.prepareStream({ ...defaults?.[view], ...options }, view)
            .identity
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
    }
    return matchLeafSegments(
      { ...options, queryKey },
      prefix.length,
      inputless,
      hasInput,
      identity
    );
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
  runPromiseExit: RunPromiseExit<unknown>,
  mutationRunner: RunPromiseExit<unknown>
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
          mutationRunner,
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
  runPromiseExit: RunPromiseExit<unknown>,
  mutationRunner: RunPromiseExit<unknown>
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
    queryFilter: createLeafFilter(description, operationKey, keyEncoder),
    ...createInfiniteBuilders(
      description,
      operationKey,
      keyEncoder,
      runPromiseExit
    ),
    ...createBufferedBuilders(
      description,
      operationKey,
      runPromiseExit,
      mutationRunner
    ),
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
  const createView = (operation: "live" | "streamed") =>
    createQueryBuilders(
      description,
      freezeKey([...operationKey, operation]),
      keyEncoder,
      (options, requestOptions) => {
        const { identity, makeQuery } = description.prepareStream(
          options,
          operation
        );
        return {
          identity,
          makeQuery: (input) =>
            makeQuery(input, runPromiseExit, requestOptions),
        };
      },
      (options) => description.prepareStream(options, operation).identity
    );
  const live = createView("live");
  const streamed = createView("streamed");

  return {
    queryFilter: createLeafFilter(description, operationKey, keyEncoder),
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

export type RunnerWrapper = (
  runner: RunPromiseExit<unknown>
) => RunPromiseExit<unknown>;

const leafRebuilders = new WeakMap<
  UtilityNode,
  (wrapRunner: RunnerWrapper) => RuntimeUtilityNode
>();

export const rebuildLeafForOwner = (
  node: RuntimeUtilityNode,
  wrapRunner: RunnerWrapper
): RuntimeUtilityNode => leafRebuilders.get(node)?.(wrapRunner) ?? { ...node };

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
  path: UtilityPath<OperationDescription>,
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
      builders = createBufferedBuilders(
        operation,
        operationKey,
        leafRunner,
        runPromiseExit
      );
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
        leafRunner,
        runPromiseExit
      );
    }
    return Object.freeze({ key: leafKey, ...builders });
  };
  Object.defineProperty(
    branch.node,
    leafName,
    defineLazyLeafDescriptor(() => {
      const leaf = buildLeaf(runPromiseExit);
      leafRebuilders.set(leaf, (wrapRunner) =>
        buildLeaf(wrapRunner(runPromiseExit))
      );
      if (operation.kind !== "Mutation") {
        registerInputOwner(leaf.key, operation.input, keyEncoder);
      }
      return leaf;
    })
  );
};

const createTree = (
  prefix: readonly JsonValue[],
  paths: readonly UtilityPath<OperationDescription>[],
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
    readonly prefixOptions: KeyPrefixInput;
    readonly keyNamespace: readonly string[];
    readonly keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>;
    readonly runtime: RuntimeInput<unknown> | undefined;
    readonly errors: TreeErrors;
  }
): Record<string, unknown> => {
  const prefix = freezeKey([
    ...normalizeUtilityKeyPrefix(
      options.prefixOptions,
      options.errors.invalidPrefix
    ),
    ...options.keyNamespace,
  ]);
  const paths = validateUtilityPaths(
    operations,
    (operation) => operation.path,
    ({ id }, issue) =>
      issue.kind === "invalid"
        ? options.errors.invalidPath(id)
        : options.errors.pathCollision(
            id,
            issue.segments,
            issue.kind === "duplicate" ? "duplicates" : "collides with"
          )
  );
  validateKeyEncoders(operations, options.keyEncoders, options.errors);
  const runner =
    options.runtime === undefined
      ? // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
        (Effect.runPromiseExit as RunPromiseExit<unknown>)
      : resolveRuntime(options.runtime);
  return createTree(prefix, paths, options.keyEncoders, runner);
};
