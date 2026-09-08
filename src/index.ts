/** Query Core's exact runtime sentinel for disabling queries that require input. */
export { skipToken } from '@tanstack/query-core'

/** Creates the public RPC utility tree. @api public */
export { createRpcQueryUtils } from './rpc/create-utils'
/** Creates the public HTTP utility tree. @api public */
export { createHttpApiQueryUtils } from './http/create-utils'
export {
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryError,
  EffectHttpApiQueryKeyError,
  isEffectHttpApiQueryError,
} from './http/errors'
export type {
  // fallow-ignore-next-line unused-type
  EffectHttpApiQueryConfigErrorCode,
  // fallow-ignore-next-line unused-type
  EffectHttpApiQueryKeyErrorCode,
} from './http/errors'
export type {
  // fallow-ignore-next-line unused-type
  CreateHttpApiQueryUtilsOptions,
  // fallow-ignore-next-line unused-type
  HttpApiKeyEncoder,
  // fallow-ignore-next-line unused-type
  HttpApiQueryUtils,
} from './http/types'
/** Errors raised by the public runtime API and guards for execution errors. @api public */
export {
  EffectRpcQueryConfigError,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
  EffectRpcQueryKeyError,
  isEffectRpcQueryError,
} from './rpc/errors'
/** Stable error metadata exposed to downstream consumers. @api public */
export type {
  // fallow-ignore-next-line unused-type
  EffectRpcQueryConfigErrorCode,
  // fallow-ignore-next-line unused-type
  EffectRpcQueryKeyErrorCode,
} from './rpc/errors'
export type {
  JsonValue,
  // fallow-ignore-next-line unused-type
  QueryData,
  RunPromiseExit,
} from './core/types'
/** Types for annotating generated utilities and custom adapters. @api public */
export type {
  // fallow-ignore-next-line unused-type
  CreateRpcQueryUtilsOptions,
  // fallow-ignore-next-line unused-type
  KeyEncoder,
  // fallow-ignore-next-line unused-type
  RpcQueryUtils,
  StreamingRpcOptions,
  UnaryRpcOptions,
} from './rpc/types'

/** The type of Query Core's exact skip sentinel. @api public */
// fallow-ignore-next-line unused-type
export type { SkipToken } from '@tanstack/query-core'
