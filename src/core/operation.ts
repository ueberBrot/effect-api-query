import type { QueryFunction } from '@tanstack/query-core'
import type { Cause, Effect } from 'effect'

import type { JsonValue, RunPromiseExit } from './types'

export type RuntimeKeyEncoder = (input: unknown) => JsonValue
export type UnaryQueryOperation = 'query' | 'infinite' | 'mutation'

export type OperationInput =
  | { readonly _tag: 'Inputless' }
  | {
      readonly _tag: 'Input'
      readonly requiresEncoder: boolean
      readonly prepare: (
        input: unknown,
        encoder: RuntimeKeyEncoder | undefined,
      ) => { readonly input: unknown; readonly keyValue: unknown }
      readonly invalidKey: (cause: unknown) => Error
    }

export interface OperationIdentity {
  readonly id: string
  readonly path: readonly string[]
  readonly input: OperationInput
  /** Removes adapter-owned fields from the fresh options copy. */
  readonly takeOptions: (options: Record<string, unknown>) => unknown
}

export interface UnaryOperation extends OperationIdentity {
  readonly kind: 'Unary'
  /** Prepares page requests without deriving another cache identity. */
  readonly pageInput: (input: unknown) => unknown
  readonly invoke: (input: unknown, options: unknown) => Effect.Effect<unknown, unknown, unknown>
  readonly executionError: (operation: UnaryQueryOperation, cause: Cause.Cause<unknown>) => Error
}

export interface StreamingOperation extends OperationIdentity {
  readonly kind: 'Streaming'
  /** Consumes and validates stream policy, including for skipped requests. */
  readonly prepareStream: (
    options: Record<string, unknown>,
    operation: 'live' | 'streamed',
    runner: RunPromiseExit<unknown>,
    requestOptions: unknown,
  ) => (input: unknown) => QueryFunction
}

export type OperationDescription = UnaryOperation | StreamingOperation

export interface TreeErrors {
  readonly invalidPrefix: (reason: 'Shape' | 'Value', cause?: unknown) => Error
  readonly invalidPath: (id: string) => Error
  readonly pathCollision: (
    id: string,
    path: readonly string[],
    relation: 'collides with' | 'duplicates',
  ) => Error
  readonly unknownEncoder: (id: string) => Error
  readonly missingEncoder: (id: string) => Error
}
