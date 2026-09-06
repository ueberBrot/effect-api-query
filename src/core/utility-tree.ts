import { skipToken } from '@tanstack/query-core'
import type { QueryKey } from '@tanstack/query-core'
import { Effect, Exit } from 'effect'
import type { Cause } from 'effect'

import type {
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
  const copy: Array<JsonValue> = []
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError('Key values must not contain sparse arrays')
    }
    copy.push(canonicalize(value[index], seen))
  }
  // Shared references are valid JSON; only references on the active path form cycles.
  seen.delete(value)
  return Object.freeze(copy)
}

const canonicalizeObject = (value: object, seen: WeakSet<object>): JsonValue => {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Key values must contain only plain objects')
  }

  const copy: Record<string, JsonValue> = {}
  for (const key of Object.keys(value).sort()) {
    if (key === '__proto__' || key === 'constructor') {
      throw new TypeError('Key objects must not contain __proto__ or constructor properties')
    }
    copy[key] = canonicalize((value as Record<string, unknown>)[key], seen)
  }
  seen.delete(value)
  return Object.freeze(copy)
}

// Copying prevents caller mutation; sorting makes equivalent objects hash identically.
const canonicalize = (value: unknown, seen: WeakSet<object> = new WeakSet()): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return canonicalizeNumber(value)
  }

  if (typeof value !== 'object') {
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

const freezeKey = (parts: ReadonlyArray<JsonValue | string>) => Object.freeze([...parts])

const hashCanonicalKey = (queryKey: QueryKey): string => JSON.stringify(queryKey)

const normalizePrefix = (
  prefix: readonly [JsonValue, ...JsonValue[]],
  errors: TreeErrors,
): readonly JsonValue[] => {
  if (!Array.isArray(prefix) || prefix.length === 0) {
    throw errors.invalidPrefix('Shape')
  }

  try {
    return Object.freeze(prefix.map((part) => canonicalize(part)))
  } catch (cause) {
    throw errors.invalidPrefix('Value', cause)
  }
}

// Validate the entire plan before allocating branches or preparing any request.
const planPaths = (operations: readonly OperationDescription[], errors: TreeErrors) => {
  const branchPaths = new Map<string, readonly string[]>()
  const leafPaths = new Set<string>()
  const plan: Array<ValidatedOperationPath> = []

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
      if (!branchPaths.has(parent)) branchPaths.set(parent, segments)
    }
    leafPaths.add(pathKey)
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
  const effect = description.invoke(input, requestOptions)
  // Await outside the Exit branch so a runner rejection passes through untouched.
  const exit = await runPromiseExit(effect, signal === undefined ? undefined : { signal })

  if (Exit.isFailure(exit)) {
    throw description.executionError(operation, exit.cause)
  }

  // TanStack rejects successful undefined query data; mutations keep it unchanged.
  return operation !== 'mutation' && exit.value === undefined ? null : exit.value
}

const defineKey = (target: Record<string, unknown>, parts: ReadonlyArray<JsonValue | string>) => {
  const key = freezeKey(parts)
  target['key'] = () => key
}

// One preparation produces both the retained execution input and its immutable key.
const prepareQuery = (
  description: OperationDescription,
  input: unknown,
  operationKey: readonly JsonValue[],
  keyEncoder: RuntimeKeyEncoder | undefined,
): PreparedQuery => {
  if (description.input._tag === 'Inputless') {
    return { input: undefined, key: operationKey }
  }
  const prepared = description.input.prepare(input, keyEncoder)
  try {
    return {
      input: prepared.input,
      key: freezeKey([...operationKey, canonicalize(prepared.keyValue)]),
    }
  } catch (cause) {
    throw description.input.invalidKey(cause)
  }
}

const prepareQueryOptions = (
  description: OperationDescription,
  argument: unknown,
  operationKey: readonly JsonValue[],
) => {
  const options = {
    ...(argument === skipToken
      ? { input: skipToken }
      : (argument as Record<string, unknown> | undefined)),
  }
  const input = options['input']
  delete options['input']
  // Query Core prefers an explicit hash over the generated hash function.
  delete options['queryHash']
  const requestOptions = description.takeOptions(options)
  if (description.input._tag !== 'Inputless' && input === skipToken) {
    return {
      _tag: 'Skipped' as const,
      options: {
        ...options,
        queryFn: skipToken,
        queryKey: operationKey,
        queryKeyHashFn: hashCanonicalKey,
      } as Record<string, unknown>,
    }
  }
  return { _tag: 'Executable' as const, input, options, requestOptions }
}

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
    const supplied = prepareQueryOptions(description, argument, infiniteOperationKey)
    if (supplied._tag === 'Skipped') return supplied.options
    const { input, options, requestOptions } = supplied

    const initialPageParam = options['initialPageParam']
    const inputForPage =
      description.input._tag === 'Inputless'
        ? () => undefined
        : (input as (pageParam: unknown) => unknown)
    const initialInput = inputForPage(initialPageParam)
    const prepared = prepareQuery(description, initialInput, infiniteOperationKey, keyEncoder)

    return {
      ...options,
      queryFn: ({
        pageParam,
        signal,
      }: {
        readonly pageParam: unknown
        readonly signal: AbortSignal
      }) => {
        const pageInput = inputForPage(pageParam)
        const executionInput = description.pageInput(pageInput)
        return execute(
          description,
          'infinite',
          executionInput,
          runPromiseExit,
          requestOptions,
          signal,
        )
      },
      queryKey: prepared.key,
      queryKeyHashFn: hashCanonicalKey,
    }
  }

  return { infiniteKey, infiniteOptions }
}

const createUnaryLeaf = (
  description: UnaryOperation,
  keyParts: ReadonlyArray<JsonValue | string>,
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>,
) => {
  const operationKey = freezeKey(keyParts)
  const queryOperationKey = freezeKey([...operationKey, 'query'])
  const mutationKey = freezeKey([...operationKey, 'mutation'])

  const queryKey = (input?: unknown) =>
    prepareQuery(description, input, queryOperationKey, keyEncoder).key

  const queryOptions = (argument?: unknown) => {
    const supplied = prepareQueryOptions(description, argument, queryOperationKey)
    if (supplied._tag === 'Skipped') return supplied.options
    const { input, options, requestOptions } = supplied

    const prepared = prepareQuery(description, input, queryOperationKey, keyEncoder)

    return {
      // Owned fields follow user options so callers cannot replace keys or runners.
      ...options,
      queryFn: ({ signal }: { readonly signal: AbortSignal }) =>
        execute(description, 'query', prepared.input, runPromiseExit, requestOptions, signal),
      queryKey: prepared.key,
      queryKeyHashFn: hashCanonicalKey,
    }
  }

  const mutationOptions = (argument: Record<string, unknown> = {}) => {
    const options = { ...argument }
    const requestOptions = description.takeOptions(options)
    return {
      ...options,
      mutationFn: (variables: unknown) =>
        execute(description, 'mutation', variables, runPromiseExit, requestOptions),
      mutationKey,
    }
  }

  return Object.freeze({
    ...createInfiniteBuilders(description, operationKey, keyEncoder, runPromiseExit),
    key: () => operationKey,
    mutationKey: () => mutationKey,
    mutationOptions,
    queryKey,
    queryOptions,
  })
}

const createStreamingLeaf = (
  description: StreamingOperation,
  keyParts: ReadonlyArray<JsonValue | string>,
  keyEncoder: RuntimeKeyEncoder | undefined,
  runPromiseExit: RunPromiseExit<unknown>,
) => {
  const operationKey = freezeKey(keyParts)
  const liveOperationKey = freezeKey([...operationKey, 'live'])
  const streamedOperationKey = freezeKey([...operationKey, 'streamed'])
  const liveKey = (input?: unknown) =>
    prepareQuery(description, input, liveOperationKey, keyEncoder).key
  const streamedKey = (input?: unknown) =>
    prepareQuery(description, input, streamedOperationKey, keyEncoder).key

  const buildOptions = (argument: unknown, operation: 'live' | 'streamed') => {
    const operationKey = operation === 'live' ? liveOperationKey : streamedOperationKey
    const supplied = prepareQueryOptions(description, argument, operationKey)
    const { options } = supplied
    const makeQuery = description.prepareStream(
      options,
      operation,
      runPromiseExit,
      supplied._tag === 'Executable' ? supplied.requestOptions : undefined,
    )
    if (supplied._tag === 'Skipped') return options
    const prepared = prepareQuery(description, supplied.input, operationKey, keyEncoder)
    const queryFn = makeQuery(prepared.input)

    return {
      ...options,
      queryFn,
      queryKey: prepared.key,
      queryKeyHashFn: hashCanonicalKey,
    }
  }

  return Object.freeze({
    key: () => operationKey,
    liveKey,
    liveOptions: (argument?: unknown) => buildOptions(argument, 'live'),
    streamedKey,
    streamedOptions: (argument?: unknown) => buildOptions(argument, 'streamed'),
  })
}

const deepFreezeTree = (value: Record<string, unknown>) => {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) {
      deepFreezeTree(child as Record<string, unknown>)
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
      .filter((operation) => operation.input._tag !== 'Inputless')
      .map((operation) => operation.id),
  )
  for (const id of keyEncoders.keys()) {
    if (!supportedIds.has(id)) throw errors.unknownEncoder(id)
  }
  for (const operation of operations) {
    if (
      operation.input._tag === 'Input' &&
      operation.input.requiresEncoder &&
      typeof keyEncoders.get(operation.id) !== 'function'
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
    const segment = segments[index] as string
    let child = Object.hasOwn(branch, segment)
      ? (branch[segment] as Record<string, unknown>)
      : undefined
    if (child === undefined) {
      child = {}
      defineKey(child, [...prefix, ...segments.slice(0, index + 1)])
      branch[segment] = child
    }
    branch = child
  }

  const leafName = segments.at(-1) as string
  branch[leafName] =
    operation.kind === 'Streaming'
      ? createStreamingLeaf(operation, [...prefix, ...segments], keyEncoder, runPromiseExit)
      : createUnaryLeaf(operation, [...prefix, ...segments], keyEncoder, runPromiseExit)
}

const createTree = (
  prefix: readonly JsonValue[],
  paths: ReadonlyArray<ValidatedOperationPath>,
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
  const runner = options.runPromiseExit ?? (Effect.runPromiseExit as RunPromiseExit<unknown>)
  return createTree(prefix, paths, options.keyEncoders, runner)
}
