/** Query Core's exact runtime sentinel for disabling queries that require input. */
export { skipToken } from "@tanstack/query-core";

/** Creates the public RPC utility tree. @api public */
export { createRpcQueryUtils } from "./rpc/create-utils";
/** Creates the public HTTP utility tree. @api public */
export { createHttpApiQueryUtils } from "./http/create-utils";
export { fetchStreamSnapshot } from "./core/stream-snapshot";
export type { StreamSnapshotOptions } from "./core/stream-snapshot";
export { viewPrefix } from "./core/view-prefix";
export { createQueryFilter } from "./core/query-filter";
export type {
  QueryFilterEncoder,
  QueryFilterOptions,
} from "./core/query-filter";
export type {
  MutationPolicy,
  MutationPolicyOptions,
  QueryPolicy,
} from "./core/policy";
export type { MutationInterceptor, QueryInterceptor } from "./core/interceptor";
export {
  createHydrationRegistry,
  hydrationCallbacks,
  HydrationCodecError,
  infiniteQueryCodec,
  queryViewCodec,
} from "./core/hydration";
export type { HydrationCodec, HydrationRegistry } from "./core/hydration";
export { recoverStream } from "./core/stream-recovery";
export type {
  RecoverStreamOptions,
  StreamConnectionState,
} from "./core/stream-recovery";
export type {
  InferInput,
  InferMutationData,
  InferMutationError,
  InferQueryData,
  InferQueryError,
} from "./core/inference";
export {
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryEmptyStreamError,
  EffectHttpApiQueryError,
  EffectHttpApiQueryKeyError,
  isEffectHttpApiQueryError,
} from "./http/errors";
export type {
  EffectHttpApiQueryConfigErrorCode,
  EffectHttpApiQueryKeyErrorCode,
} from "./http/errors";
export type {
  CreateHttpApiQueryUtilsOptions,
  HttpApiKeyEncoder,
  HttpApiQueryUtils,
} from "./http/types";
/** Errors raised by the public runtime API and guards for execution errors. @api public */
export {
  EffectRpcQueryConfigError,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
  EffectRpcQueryKeyError,
  isEffectRpcQueryError,
} from "./rpc/errors";
/** Stable error metadata exposed to downstream consumers. @api public */
export type {
  EffectRpcQueryConfigErrorCode,
  EffectRpcQueryKeyErrorCode,
} from "./rpc/errors";
export type { JsonValue, QueryData, RunPromiseExit } from "./core/types";
/** Types for annotating generated utilities and custom adapters. @api public */
export type {
  CreateRpcQueryUtilsOptions,
  KeyEncoder,
  RpcQueryUtils,
  StreamingRpcOptions,
  UnaryRpcOptions,
} from "./rpc/types";

/** The type of Query Core's exact skip sentinel. @api public */
export type { SkipToken } from "@tanstack/query-core";

export { configureUtils } from "./core/configure-utils";
export type {
  ConfiguredUtils,
  UtilsConfiguration,
} from "./core/configure-utils";
export { createBranchQueryFilter } from "./core/branch-filter";
export { findDeclaredError } from "./core/declared-error";
export { prepareInput } from "./core/prepared-input";
export type { PreparedInput } from "./core/prepared-input";
export { consumeEvents } from "./core/consume-events";
export type { ConsumeEventsOptions } from "./core/consume-events";
