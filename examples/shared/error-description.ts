import { Cause } from 'effect'
import { isEffectHttpApiQueryError, isEffectRpcQueryError } from 'effect-api-query'

// oxlint-disable-next-line anti-slop/no-unknown-parameters
export const describeEffectError = (error: unknown) => {
  if (isEffectRpcQueryError(error) || isEffectHttpApiQueryError(error)) {
    const operation = isEffectRpcQueryError(error)
      ? error.rpcTag
      : `${error.groupId}.${error.endpoint}`
    return {
      summary: `${error.name} from ${operation} (${error.operation})`,
      details: Cause.pretty(error.cause),
    }
  }
  return error instanceof Error ? { summary: `${error.name}: ${error.message}` } : undefined
}
