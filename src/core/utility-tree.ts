import { hashKey, skipToken } from "@tanstack/query-core";
import { Effect, Predicate } from "effect";

import { createBranchFilter } from "./branch-filter";
import type { FilterPath } from "./branch-filter";
import { registerMutationBuilder, registerQueryBuilder } from "./configure";
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
} from "./operation";
import {
  prepareQueryInput,
  readPreparedInput,
  registerInputOwner,
} from "./prepared-input";
import type { PreparedInputOwner } from "./prepared-input";
import type { QueryFilter, QueryFilterOptions } from "./query-filter";
import { executeBuffered, resolveRuntime } from "./runtime";
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
import type { KeyPrefixInput } from "./utility-path";

interface PreparedQuery {
  readonly input: unknown;
  readonly key: readonly JsonValue[];
}

const freezeKey = (parts: JsonValue[]) => Object.freeze(parts);

const prepareQuery = (
  owner: PreparedInputOwner,
  input: unknown,
  operationKey: readonly JsonValue[],
  identity: readonly JsonValue[] = []
): PreparedQuery => {
  const reused = readPreparedInput(owner, input);
  if (owner.input._tag === "Inputless") {
    return {
      input: undefined,
      key:
        identity.length === 0
          ? operationKey
          : freezeKey([...operationKey, ...identity]),
    };
  }
  const prepared =
    reused ?? prepareQueryInput(owner.input, input, owner.encoder);
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
    if (!inputless && !hasInput && identity !== undefined) {
      filter.predicate = () => false;
    }
    return filter;
  }
  const inputHash =
    hasInput && !inputless ? hashKey([filter.queryKey[inputIndex]]) : undefined;
  const identityIndex = inputless ? inputIndex : inputIndex + 1;
  const identityHash = identity && hashKey(identity);
  if (inputHash === undefined && identityHash === undefined) {
    return filter;
  }
  const { predicate } = filter;
  filter.predicate = (query) =>
    (inputHash === undefined ||
      hashKey([query.queryKey[inputIndex]]) === inputHash) &&
    (identityHash === undefined ||
      (query.queryKey.length >= identityIndex &&
        hashKey(query.queryKey.slice(identityIndex)) === identityHash)) &&
    (predicate?.(query) ?? true);
  return filter;
};

const createLeafFilter =
  (
    description: UnaryOperation | StreamingOperation,
    operationKey: readonly JsonValue[],
    owner: PreparedInputOwner
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
      queryKey = prepareQuery(owner, input, prefix, identity).key;
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

const createKeyBuilder =
  (
    owner: PreparedInputOwner,
    operationKey: readonly JsonValue[],
    prepareIdentity?: (options: Record<string, unknown>) => readonly JsonValue[]
  ) =>
  (argument?: unknown) => {
    const inputless = owner.input._tag === "Inputless";
    if (
      !Predicate.isObject(argument) &&
      (argument !== undefined || !inputless)
    ) {
      throw new TypeError("Query key options must be an object");
    }
    const { input, ...options } = { ...argument };
    return prepareQuery(
      owner,
      inputless ? undefined : input,
      operationKey,
      prepareIdentity?.(options)
    ).key;
  };

const createQueryBuilders = (
  description: UnaryOperation | StreamingOperation,
  operationKey: readonly JsonValue[],
  owner: PreparedInputOwner,
  prepareOptions: (
    options: Record<string, unknown>,

    requestOptions: unknown,

    input: unknown
  ) => QueryPreparation,

  prepareIdentity?: (options: Record<string, unknown>) => readonly JsonValue[]
) => ({
  key: createKeyBuilder(owner, operationKey, prepareIdentity),

  options: registerQueryBuilder((argument?: Record<string, unknown>) => {
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
    const prepared = prepareQuery(owner, input, operationKey, identity);
    return finalizeQueryOptions(
      options,
      prepared.key,
      makeQuery(prepared.input)
    );
  }),
});

const createInfiniteBuilders = (
  description: UnaryOperation,
  operationKey: readonly JsonValue[],
  owner: PreparedInputOwner,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const infiniteOperationKey = freezeKey([...operationKey, "infinite"]);

  const infiniteKey =
    owner.input._tag === "Inputless"
      ? () => infiniteOperationKey
      : createKeyBuilder(owner, infiniteOperationKey);

  const infiniteOptions = registerQueryBuilder(
    (argument?: Record<string, unknown>) => {
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
        throw new TypeError(
          "Infinite query input must be a page input function"
        );
      }
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
      const pageInput = inputForPage as (pageParam: unknown) => unknown;
      const initialInput = pageInput(initialPageParam);
      const prepared = prepareQuery(owner, initialInput, infiniteOperationKey);

      return finalizeQueryOptions(
        options,
        prepared.key,
        async ({
          pageParam,
          signal,
        }: {
          readonly pageParam?: unknown;
          readonly signal: AbortSignal;
        }) => {
          const pageRequest = pageInput(pageParam);
          const executionInput =
            description.input._tag === "Input"
              ? description.input.pageInput(pageRequest)
              : undefined;
          return executeBuffered(
            description,
            "infinite",
            executionInput,
            runPromiseExit,
            requestOptions,
            signal
          );
        }
      );
    }
  );

  return { infiniteKey, infiniteOptions };
};

const createBufferedBuilders = (
  description: UnaryOperation | MutationOperation,
  operationKey: readonly JsonValue[],
  runPromiseExit: RunPromiseExit<unknown>,
  mutationRunner: RunPromiseExit<unknown>,
  owner?: PreparedInputOwner
) => {
  const mutationKey = freezeKey([...operationKey, "mutation"]);

  const prepareDirect = (argument: Record<string, unknown> = {}) => {
    const options = { ...argument };
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
    return executeBuffered(
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

  const mutationOptions = registerMutationBuilder(
    (argument: Record<string, unknown> = {}) => {
      const options = { ...argument };
      const requestOptions = description.takeOptions(options);
      return {
        ...options,

        mutationFn: async (variables: unknown) =>
          executeBuffered(
            description,
            "mutation",
            variables,
            mutationRunner,
            requestOptions
          ),
        mutationKey,
      };
    }
  );
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
  owner: PreparedInputOwner,
  runPromiseExit: RunPromiseExit<unknown>,
  mutationRunner: RunPromiseExit<unknown>
) => {
  const queryOperationKey = freezeKey([...operationKey, "query"]);
  const query = createQueryBuilders(
    description,
    queryOperationKey,
    owner,
    (_options, requestOptions) => ({
      identity: [],
      makeQuery:
        (input) =>
        async ({ signal }) =>
          executeBuffered(
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
          owner,
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
    queryFilter: createLeafFilter(description, operationKey, owner),
    ...createInfiniteBuilders(description, operationKey, owner, runPromiseExit),
    ...createBufferedBuilders(
      description,
      operationKey,
      runPromiseExit,
      mutationRunner,
      owner
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
  owner: PreparedInputOwner,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const createView = (operation: "live" | "streamed") =>
    createQueryBuilders(
      description,
      freezeKey([...operationKey, operation]),
      owner,
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
    queryFilter: createLeafFilter(description, operationKey, owner),
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
  const requiresEncoderById = new Map<string, boolean>();
  for (const operation of operations) {
    if (operation.kind !== "Mutation" && operation.input._tag === "Input") {
      requiresEncoderById.set(operation.id, operation.input.requiresEncoder);
    }
  }
  for (const id of keyEncoders.keys()) {
    if (!requiresEncoderById.has(id)) {
      throw errors.unknownEncoder(id);
    }
  }
  for (const [id, required] of requiresEncoderById) {
    if (required && !Predicate.isFunction(keyEncoders.get(id))) {
      throw errors.missingEncoder(id);
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
  description: OperationDescription,
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const { path: segments } = description;
  const operationKey = freezeKey([...prefix, ...segments]);
  const filterPath: FilterPath = {
    key: operationKey,
    views: operationViews(description),
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
  let inputOwner: PreparedInputOwner | undefined;
  const buildLeaf = (leafRunner: RunPromiseExit<unknown>) => {
    if (description.kind === "Mutation") {
      return Object.freeze({
        key: leafKey,
        ...createBufferedBuilders(
          description,
          operationKey,
          leafRunner,
          runPromiseExit
        ),
      });
    }
    inputOwner ??= {
      input: description.input,
      encoder: keyEncoder,
    };
    const builders =
      description.kind === "Streaming"
        ? createStreamingBuilders(
            description,
            operationKey,
            inputOwner,
            leafRunner
          )
        : createUnaryBuilders(
            description,
            operationKey,
            inputOwner,
            leafRunner,
            runPromiseExit
          );
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
      if (inputOwner !== undefined) {
        registerInputOwner(leafKey, inputOwner);
      }
      return leaf;
    })
  );
};

const createTree = (
  prefix: readonly JsonValue[],
  operations: readonly OperationDescription[],
  keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>,
  runPromiseExit: RunPromiseExit<unknown>
) => {
  const tree = buildBranch(prefix);

  for (const operation of operations) {
    insertLeaf(
      tree,
      prefix,
      operation,
      keyEncoders.get(operation.id),
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
  validateUtilityPaths(operations, ({ id }, issue, segments) =>
    issue === "invalid"
      ? options.errors.invalidPath(id)
      : options.errors.pathCollision(
          id,
          segments,
          issue === "duplicate" ? "duplicates" : "collides with"
        )
  );
  validateKeyEncoders(operations, options.keyEncoders, options.errors);
  const runner =
    options.runtime === undefined
      ? // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
        (Effect.runPromiseExit as RunPromiseExit<unknown>)
      : resolveRuntime(options.runtime);
  return createTree(prefix, operations, options.keyEncoders, runner);
};
