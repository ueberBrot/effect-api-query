import { skipToken } from '@tanstack/query-core'
import type { QueryFunction } from '@tanstack/query-core'
import { Effect, Exit, Predicate } from 'effect'
import type { Cause } from 'effect'

import type {
  BufferedOperation,
  OperationDescription,
  RuntimeKeyEncoder,
  StreamingOperation,
  TreeErrors,
  UnaryOperation,
  UnaryQueryOperation,
} from './operation'
import type { JsonValue, RunPromiseExit } from './types'

const reservedPathSegments = new Set([
  '__proto__',
  'constructor',
  'infiniteKey',
  'infiniteOptions',
  'key',
  'liveKey',
  'liveOptions',
  'mutationKey',
  'mutationOptions',
  'prototype',
  'queryKey',
  'queryOptions',
  'streamedKey',
  'streamedOptions',
])

interface PreparedQuery {
  readonly input: unknown
  readonly key: readonly JsonValue[]
}

interface ValidatedOperationPath {
  readonly operation: OperationDescription
  readonly segments: readonly [string, ...string[]]
}

const canonicalizeNumber = (value: number): number => {
  if (!Number.isFinite(value)) {
    throw new TypeError('Key values must contain only finite numbers')
  }
  return Object.is(value, -0) ? 0 : value
}

const canonicalizeArray = (value: unknown[], seen: WeakSet<object>): JsonValue => {
  const copy: JsonValue[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError('Key values must not contain sparse arrays')
    }
    // canonicalize is initialized before any query tree is constructed.
    // oxlint-disable-next-line eslint/no-use-before-define
    copy.push(canonicalize(value[index], seen))
  }
  // Shared references are valid JSON; only references on the active path form cycles.
  seen.delete(value)
  return Object.freeze(copy)
}

const canonicalizeObject = (value: Record<string, unknown>, seen: WeakSet<object>): JsonValue => {
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Key values must contain only plain objects')
  }

  const copy: Record<string, JsonValue> = {}
  for (const key of Object.keys(value).sort()) {
    if (key === '__proto__' || key === 'constructor') {
      throw new TypeError('Key objects must not contain __proto__ or constructor properties')
    }
    // Every enumerated member must remain JSON-safe, including getter side effects.
    // oxlint-disable-next-line eslint/no-use-before-define
    copy[key] = canonicalize(value[key], seen)
  }
  seen.delete(value)
  return Object.freeze(copy)
}

// Copying prevents caller mutation; sorting makes equivalent objects hash identically.
const canonicalize = (value: unknown, seen = new WeakSet()): JsonValue => {
  if (value === null || Predicate.isString(value) || Predicate.isBoolean(value)) {
    return value
  }

  if (Predicate.isNumber(value)) {
    return canonicalizeNumber(value)
  }

  if (!Predicate.isObjectOrArray(value)) {
    throw new TypeError('Key values must be JSON-safe')
  }

  if (seen.has(value)) {
    throw new TypeError('Key values must not contain cycles')
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return canonicalizeArray(value, seen)
  }

  return canonicalizeObject(value, seen)
}

const freezeKey = (parts: readonly (JsonValue | string)[]) => Object.freeze([...parts])

const normalizePrefix = (
  prefix: readonly [JsonValue, ...JsonValue[]],
  errors: TreeErrors,
): readonly JsonValue[] => {
  if (!Array.isArray(prefix) || prefix.length === 0) {
    throw errors.invalidPrefix('Shape')
  }

  try {
    // SAFETY: prefix is checked to be a nonempty array; canonicalize preserves arrays
    // while validating and freezing every JSON value recursively.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return canonicalize(prefix) as readonly JsonValue[]
  } catch (error) {
    throw errors.invalidPrefix('Value', error)
  }
}

// Validate the entire plan before allocating branches or preparing any request.
const planPaths = (operations: readonly OperationDescription[], errors: TreeErrors) => {
  const branchPaths = new Map<string, readonly string[]>()
  const leafPaths = new Set<string>()
  const plan: ValidatedOperationPath[] = []

  for (const operation of operations) {
    const segments = operation.path
    if (
      segments.length === 0 ||
      segments.some((segment) => segment.length === 0 || reservedPathSegments.has(segment))
    ) {
      throw errors.invalidPath(operation.id)
    }
    const pathKey = JSON.stringify(segments)
    if (leafPaths.has(pathKey)) {
      throw errors.pathCollision(operation.id, segments, 'duplicates')
    }
    const descendantPath = branchPaths.get(pathKey)
    if (descendantPath !== undefined) {
      throw errors.pathCollision(operation.id, descendantPath, 'collides with')
    }
    const parents: string[] = []
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index)
      const parentKey = JSON.stringify(parent)
      if (leafPaths.has(parentKey)) {
        throw errors.pathCollision(operation.id, parent, 'collides with')
      }
      parents.push(parentKey)
    }
    for (const parent of parents) {
      if (!branchPaths.has(parent)) {
        branchPaths.set(parent, segments)
      }
    }
    leafPaths.add(pathKey)
    // SAFETY: The empty path was rejected above before recording this plan.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    plan.push({ operation, segments: segments as readonly [string, ...string[]] })
  }
  return plan
}

const execute = async <Operation extends UnaryQueryOperation>(
  description: {
    readonly invoke: UnaryOperation['invoke']
    readonly executionError: (operation: Operation, cause: Cause.Cause<unknown>) => Error
  },
  operation: Operation,
  input: unknown,
  runPromiseExit: RunPromiseExit<unknown>,
  requestOptions?: unknown,
  signal?: AbortSignal,
) => {
  // The transport contract preserves arbitrary caller errors and Context services.
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
  const effect = description.invoke(input, requestOptions)
  // Await outside the Exit branch so a runner rejection passes through untouched.
  // The erased transport channels retain the caller's errors and service requirements.
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
  const exit = await runPromiseExit(effect, signal === undefined ? undefined : { signal })

  if (Exit.isFailure(exit)) {
    throw description.executionError(operation, exit.cause)
  }

  // TanStack rejects successful undefined query data; mutations keep it unchanged.
  return operation !== 'mutation' && exit.value === undefined ? null : exit.value
}

const defineKey = (target: Record<string, unknown>, parts: readonly (JsonValue | string)[]) => {
  const key = freezeKey(parts)
  target['key'] = () => key
}

// One preparation produces both the retained execution input and its immutable key.
const prepareQuery = (
  description: UnaryOperation | StreamingOperation,
  input: unknown,
  operationKey: readonly JsonValue[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  identity: readonly JsonValue[] = [],
): PreparedQuery => {
  if (description.input._tag === 'Inputless') {
    return {
      input: undefined,
      key: identity.length === 0 ? operationKey : freezeKey([...operationKey, ...identity]),
    }
  }
  const prepared = description.input.prepare(input, keyEncoder)
  try {
    return {
      input: prepared.input,
      key: freezeKey([...operationKey, canonicalize(prepared.keyValue), ...identity]),
    }
  } catch (error) {
    throw description.input.invalidKey(error)
  }
}

const prepareQueryOptions = (description: OperationDescription, argument: unknown) => {
  const options: Record<string, unknown> =
    argument === skipToken
      ? { input: skipToken }
      : { ...(Predicate.isObject(argument) ? argument : undefined) }
  for (const option of ['queryKeyHashFn', 'queryHash'] as const) {
    if (Object.hasOwn(options, option)) {
      throw description.unsupportedQueryHash(option)
    }
  }
  const { input } = options
  delete options['input']
  const requestOptions = description.takeOptions(options)
  return { input, options, requestOptions }
}

const finalizeQueryOptions = <QueryFn>(
  options: Record<string, unknown>,
  queryKey: readonly JsonValue[],
  queryFn: QueryFn,
) => ({
  ...options,
  queryFn,
  queryKey,
})

const createQueryBuilders = (
  description: UnaryOperation | StreamingOperation,
  operationKey: readonly JsonValue[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  prepareExecution: (
    options: Record<string, unknown>,
    requestOptions: unknown,
  ) => (input: unknown) => QueryFunction,
  prepareIdentity?: (options: Record<string, unknown>) => readonly JsonValue[],
) => ({
  key: (input?: unknown, policy?: Record<string, unknown>) => {
    const options = description.input._tag === 'Inputless' ? input : policy
    const identity = prepareIdentity?.(Predicate.isObject(options) ? { ...options } : {}) ?? []
    return prepareQuery(description, input, operationKey, keyEncoder, identity).key
  },
  options: (argument?: unknown) => {
    const { input, options, requestOptions } = prepareQueryOptions(description, argument)
    const identity = prepareIdentity?.(options) ?? []
    // Stream policy is consumed and validated even when execution will be skipped.
    const makeQuery = prepareExecution(options, requestOptions)
    if (description.input._tag !== 'Inputless' && input === skipToken) {
      return finalizeQueryOptions(options, operationKey, skipToken)
    }
    const prepared = prepareQuery(description, input, operationKey, keyEncoder, identity)
    return finalizeQueryOptions(options, prepared.key, makeQuery(prepared.input))
  },
})

const createInfiniteBuilders = (
  description: UnaryOperation,
  operationKey: readonly JsonValue[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>,
) => {
  const infiniteOperationKey = freezeKey([...operationKey, 'infinite'])

  const infiniteKey = (input?: unknown) =>
    prepareQuery(description, input, infiniteOperationKey, keyEncoder).key

  const infiniteOptions = (argument: Record<string, unknown>) => {
    const { input, options, requestOptions } = prepareQueryOptions(description, argument)
    if (description.input._tag !== 'Inputless' && input === skipToken) {
      return finalizeQueryOptions(options, infiniteOperationKey, skipToken)
    }

    const { initialPageParam } = options
    const inputForPage =
      description.input._tag === 'Inputless'
        ? () => {
            // Inputless operations do not construct a page payload.
          }
        : input
    if (!Predicate.isFunction(inputForPage)) {
      throw new TypeError('Infinite query input must be a page input function')
    }
    // SAFETY: The function guard above validates callability; the adapter validates
    // the returned payload through the operation's declaration before execution.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const pageInput = inputForPage as (pageParam: unknown) => unknown
    const initialInput = pageInput(initialPageParam)
    const prepared = prepareQuery(description, initialInput, infiniteOperationKey, keyEncoder)

    return finalizeQueryOptions(
      options,
      prepared.key,
      async ({
        pageParam,
        signal,
      }: {
        readonly pageParam: unknown
        readonly signal: AbortSignal
      }) => {
        const pageRequest = pageInput(pageParam)
        const executionInput =
          description.input._tag === 'Input' ? description.input.pageInput(pageRequest) : undefined
        return execute(
          description,
          'infinite',
          executionInput,
          runPromiseExit,
          requestOptions,
          signal,
        )
      },
    )
  }

  return { infiniteKey, infiniteOptions }
}

const createMutationBuilders = (
  description: BufferedOperation,
  operationKey: readonly JsonValue[],
  runPromiseExit: RunPromiseExit<unknown>,
) => {
  const mutationKey = freezeKey([...operationKey, 'mutation'])

  const mutationOptions = (argument: Record<string, unknown> = {}) => {
    const options = { ...argument }
    const requestOptions = description.takeOptions(options)
    return {
      ...options,
      mutationFn: async (variables: unknown) =>
        execute(description, 'mutation', variables, runPromiseExit, requestOptions),
      mutationKey,
    }
  }
  return { mutationKey: () => mutationKey, mutationOptions }
}

const createMutationLeaf = (
  description: BufferedOperation,
  keyParts: readonly (JsonValue | string)[],
  runPromiseExit: RunPromiseExit<unknown>,
) => {
  const operationKey = freezeKey(keyParts)
  return Object.freeze({
    key: () => operationKey,
    ...createMutationBuilders(description, operationKey, runPromiseExit),
  })
}

const createUnaryLeaf = (
  description: UnaryOperation,
  keyParts: readonly (JsonValue | string)[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>,
) => {
  const operationKey = freezeKey(keyParts)
  const queryOperationKey = freezeKey([...operationKey, 'query'])
  const query = createQueryBuilders(
    description,
    queryOperationKey,
    keyEncoder,
    (_options, requestOptions) =>
      (input) =>
      async ({ signal }: { readonly signal: AbortSignal }) =>
        execute(description, 'query', input, runPromiseExit, requestOptions, signal),
  )

  return Object.freeze({
    ...createInfiniteBuilders(description, operationKey, keyEncoder, runPromiseExit),
    key: () => operationKey,
    ...createMutationBuilders(description, operationKey, runPromiseExit),
    queryKey: query.key,
    queryOptions: query.options,
  })
}

const createStreamingLeaf = (
  description: StreamingOperation,
  keyParts: readonly (JsonValue | string)[],
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>,
) => {
  const operationKey = freezeKey(keyParts)
  const liveOperationKey = freezeKey([...operationKey, 'live'])
  const streamedOperationKey = freezeKey([...operationKey, 'streamed'])
  const live = createQueryBuilders(
    description,
    liveOperationKey,
    keyEncoder,
    (options, requestOptions) =>
      description.prepareStream(options, 'live', runPromiseExit, requestOptions),
  )
  const streamed = createQueryBuilders(
    description,
    streamedOperationKey,
    keyEncoder,
    (options, requestOptions) =>
      description.prepareStream(options, 'streamed', runPromiseExit, requestOptions),
    description.streamedIdentity,
  )

  return Object.freeze({
    key: () => operationKey,
    liveKey: live.key,
    liveOptions: live.options,
    streamedKey: streamed.key,
    streamedOptions: streamed.options,
  })
}

const deepFreezeTree = (value: Record<string, unknown>) => {
  for (const child of Object.values(value)) {
    if (Predicate.isObject(child)) {
      deepFreezeTree(child)
    }
  }
  return Object.freeze(value)
}

const validateKeyEncoders = (
  operations: readonly OperationDescription[],
  keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>,
  errors: TreeErrors,
) => {
  const supportedIds = new Set(
    operations
      .filter((operation) => operation.kind !== 'Mutation' && operation.input._tag !== 'Inputless')
      .map((operation) => operation.id),
  )
  for (const id of keyEncoders.keys()) {
    if (!supportedIds.has(id)) {
      throw errors.unknownEncoder(id)
    }
  }
  for (const operation of operations) {
    if (
      operation.kind !== 'Mutation' &&
      operation.input._tag === 'Input' &&
      operation.input.requiresEncoder &&
      !Predicate.isFunction(keyEncoders.get(operation.id))
    ) {
      throw errors.missingEncoder(operation.id)
    }
  }
}

const insertLeaf = (
  tree: Record<string, unknown>,
  prefix: readonly JsonValue[],
  path: ValidatedOperationPath,
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>,
) => {
  const { operation, segments } = path
  let branch = tree
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    if (segment === undefined) {
      throw new TypeError('Validated operation paths must have defined segments')
    }
    const candidate = Object.hasOwn(branch, segment) ? branch[segment] : undefined
    let child = Predicate.isObject(candidate) ? candidate : undefined
    if (child === undefined) {
      child = {}
      defineKey(child, [...prefix, ...segments.slice(0, index + 1)])
      branch[segment] = child
    }
    branch = child
  }

  const leafName = segments.at(-1)
  if (leafName === undefined) {
    throw new TypeError('Validated operation paths must have a leaf')
  }
  const keyParts = [...prefix, ...segments]
  if (operation.kind === 'Mutation') {
    branch[leafName] = createMutationLeaf(operation, keyParts, runPromiseExit)
    return
  }
  branch[leafName] =
    operation.kind === 'Streaming'
      ? createStreamingLeaf(operation, keyParts, keyEncoder, runPromiseExit)
      : createUnaryLeaf(operation, keyParts, keyEncoder, runPromiseExit)
}

const createTree = (
  prefix: readonly JsonValue[],
  paths: readonly ValidatedOperationPath[],
  keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>,
  runPromiseExit: RunPromiseExit<unknown>,
) => {
  const tree: Record<string, unknown> = {}
  defineKey(tree, prefix)

  for (const path of paths) {
    insertLeaf(tree, prefix, path, keyEncoders.get(path.operation.id), runPromiseExit)
  }
  return deepFreezeTree(tree)
}

export const createUtilityTree = (
  operations: readonly OperationDescription[],
  options: {
    readonly keyPrefix: readonly [JsonValue, ...JsonValue[]]
    readonly keyNamespace: readonly string[]
    readonly keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>
    readonly runPromiseExit: RunPromiseExit<unknown> | undefined
    readonly errors: TreeErrors
  },
): Record<string, unknown> => {
  const prefix = freezeKey([
    ...normalizePrefix(options.keyPrefix, options.errors),
    ...options.keyNamespace,
  ])
  const paths = planPaths(operations, options.errors)
  validateKeyEncoders(operations, options.keyEncoders, options.errors)
  // SAFETY: Public options require a runner when a client has remaining services;
  // otherwise the captured client is fully provided and the default runner needs none.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const runner = options.runPromiseExit ?? (Effect.runPromiseExit as RunPromiseExit<unknown>)
  return createTree(prefix, paths, options.keyEncoders, runner)
}
