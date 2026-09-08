import type { Cause } from 'effect'

/** Stable codes for errors raised while configuring an RPC utility tree or its builders. */
export type EffectRpcQueryConfigErrorCode =
  | 'InvalidMaxChunks'
  | 'InvalidKeyPrefix'
  | 'InvalidRpcPath'
  | 'RpcPathCollision'
  | 'MissingKeyEncoder'
  | 'UnknownKeyEncoder'

/** Stable codes for synchronous query-key preparation failures. */
export type EffectRpcQueryKeyErrorCode =
  | 'PayloadConstructionFailed'
  | 'PayloadEncodingFailed'
  | 'KeyEncoderFailed'
  | 'InvalidKeyValue'

/** The TanStack operation that executed an RPC. */
export type RpcOperation = 'infinite' | 'live' | 'mutation' | 'query' | 'streamed'

/** Identifies the failed configuration entry and retains any underlying failure. */
export interface EffectRpcQueryConfigErrorOptions {
  /** The underlying failure, when one exists. */
  readonly cause?: unknown

  /** The existing projected path associated with a collision. */
  readonly path?: string

  /** The RPC or encoder tag associated with the invalid configuration. */
  readonly rpcTag?: string
}

/**
 * Wraps a failed RPC Exit for TanStack while preserving its complete Effect Cause.
 *
 * Runner rejections pass through unchanged; this class wraps failed Exits.
 */
export class EffectRpcQueryError<E> extends Error {
  /** Identifies this error without relying on `instanceof`. */
  readonly _tag = 'EffectRpcQueryError'

  /** The literal tag of the RPC that failed. */
  readonly rpcTag: string

  /** The operation that ran the RPC. */
  readonly operation: RpcOperation

  /** The original Cause returned by the Effect runner. */
  override readonly cause: Cause.Cause<E>

  constructor(rpcTag: string, operation: RpcOperation, cause: Cause.Cause<E>) {
    super(`RPC ${rpcTag} ${operation} failed`, { cause })
    this.name = 'EffectRpcQueryError'
    this.rpcTag = rpcTag
    this.operation = operation
    this.cause = cause
  }
}

/** Reports a live RPC stream that completed before emitting its first value. */
export class EffectRpcQueryEmptyStreamError extends Error {
  /** Identifies this error without relying on `instanceof`. */
  readonly _tag = 'EffectRpcQueryEmptyStreamError'

  /** The streaming RPC that completed empty. */
  readonly rpcTag: string

  constructor(rpcTag: string) {
    super(`RPC ${rpcTag} live stream completed without a value`)
    this.name = 'EffectRpcQueryEmptyStreamError'
    this.rpcTag = rpcTag
  }
}

/** Reports invalid factory or builder configuration synchronously. */
export class EffectRpcQueryConfigError extends Error {
  /** Identifies this error without relying on `instanceof`. */
  readonly _tag = 'EffectRpcQueryConfigError'

  /** A stable, machine-readable description of the failure. */
  readonly code: EffectRpcQueryConfigErrorCode

  /** The underlying failure, when one exists. */
  override readonly cause?: unknown

  /** The existing projected path associated with a collision. */
  readonly path: string | undefined

  /** The RPC or encoder tag associated with the invalid configuration. */
  readonly rpcTag: string | undefined

  constructor(
    code: EffectRpcQueryConfigErrorCode,
    message: string,
    options: EffectRpcQueryConfigErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'EffectRpcQueryConfigError'
    this.code = code
    this.cause = options.cause
    this.path = options.path
    this.rpcTag = options.rpcTag
  }
}

/** Reports synchronous payload construction, encoding, or canonicalization failures. */
export class EffectRpcQueryKeyError extends Error {
  /** Identifies this error without relying on `instanceof`. */
  readonly _tag = 'EffectRpcQueryKeyError'

  /** A stable, machine-readable description of the failure. */
  readonly code: EffectRpcQueryKeyErrorCode

  /** The RPC whose query key could not be prepared. */
  readonly rpcTag: string

  /** The underlying failure, when one exists. */
  override readonly cause?: unknown

  constructor(code: EffectRpcQueryKeyErrorCode, rpcTag: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'EffectRpcQueryKeyError'
    this.code = code
    this.rpcTag = rpcTag
    this.cause = cause
  }
}

/** Returns whether a value is an RPC execution error from this JavaScript realm. */
export const isEffectRpcQueryError = (value: unknown): value is EffectRpcQueryError<unknown> =>
  value instanceof EffectRpcQueryError
