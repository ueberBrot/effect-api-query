import type { Cause } from 'effect'

/** Safe identity shared by HTTP execution and key errors. */
export interface HttpApiEndpointIdentity {
  readonly apiId: string
  readonly groupId: string
  readonly endpoint: string
  readonly method: string
}

/** TanStack operations supported by buffered HTTP endpoints. */
export type HttpApiOperation = 'query' | 'infinite' | 'mutation'

/** Stable codes for invalid HTTP utility configuration. */
export type EffectHttpApiQueryConfigErrorCode =
  | 'InvalidKeyPrefix'
  | 'InvalidEndpointPath'
  | 'EndpointPathCollision'
  | 'MissingKeyEncoder'
  | 'UnknownKeyEncoder'
  | 'UnsupportedEndpointMetadata'

/** Stable codes for synchronous HTTP key failures. */
export type EffectHttpApiQueryKeyErrorCode =
  | 'RequestEncodingFailed'
  | 'KeyEncoderFailed'
  | 'InvalidKeyValue'

/** Preserves the complete failed Exit Cause with declaration-only metadata. */
export class EffectHttpApiQueryError<E> extends Error implements HttpApiEndpointIdentity {
  readonly _tag = 'EffectHttpApiQueryError'
  readonly apiId: string
  readonly groupId: string
  readonly endpoint: string
  readonly method: string
  readonly operation: HttpApiOperation
  override readonly cause: Cause.Cause<E>

  constructor(
    identity: HttpApiEndpointIdentity,
    operation: HttpApiOperation,
    cause: Cause.Cause<E>,
  ) {
    super(`HTTP ${identity.method} ${identity.groupId}/${identity.endpoint} ${operation} failed`, {
      cause,
    })
    this.name = 'EffectHttpApiQueryError'
    this.apiId = identity.apiId
    this.groupId = identity.groupId
    this.endpoint = identity.endpoint
    this.method = identity.method
    this.operation = operation
    this.cause = cause
  }
}

/** Reports invalid HTTP projection, key configuration, or endpoint metadata. */
export class EffectHttpApiQueryConfigError extends Error {
  readonly _tag = 'EffectHttpApiQueryConfigError'
  readonly code: EffectHttpApiQueryConfigErrorCode
  readonly apiId: string
  readonly groupId: string | undefined
  readonly endpoint: string | undefined
  readonly method: string | undefined
  readonly path: readonly string[] | undefined
  override readonly cause?: unknown

  constructor(
    code: EffectHttpApiQueryConfigErrorCode,
    message: string,
    options: {
      readonly apiId: string
      readonly groupId?: string
      readonly endpoint?: string
      readonly method?: string
      readonly path?: readonly string[]
      readonly cause?: unknown
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'EffectHttpApiQueryConfigError'
    this.code = code
    this.apiId = options.apiId
    this.groupId = options.groupId
    this.endpoint = options.endpoint
    this.method = options.method
    this.path = options.path
    this.cause = options.cause
  }
}

/** Reports synchronous request encoding and key canonicalization failures. */
export class EffectHttpApiQueryKeyError extends Error implements HttpApiEndpointIdentity {
  readonly _tag = 'EffectHttpApiQueryKeyError'
  readonly code: EffectHttpApiQueryKeyErrorCode
  readonly apiId: string
  readonly groupId: string
  readonly endpoint: string
  readonly method: string
  override readonly cause?: unknown

  constructor(
    code: EffectHttpApiQueryKeyErrorCode,
    identity: HttpApiEndpointIdentity,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'EffectHttpApiQueryKeyError'
    this.code = code
    this.apiId = identity.apiId
    this.groupId = identity.groupId
    this.endpoint = identity.endpoint
    this.method = identity.method
    this.cause = cause
  }
}

/** Recognizes HTTP execution errors from this JavaScript realm. */
export const isEffectHttpApiQueryError = (
  value: unknown,
): value is EffectHttpApiQueryError<unknown> => value instanceof EffectHttpApiQueryError
