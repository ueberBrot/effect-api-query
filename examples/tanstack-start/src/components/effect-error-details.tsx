import { Cause } from 'effect'
import { isEffectHttpApiQueryError, isEffectRpcQueryError } from 'effect-api-query'

const alertClassName =
  'mt-4 border border-destructive-900/80 border-l-4 border-l-destructive-600 bg-destructive-950/50 p-3 text-sm whitespace-pre-wrap text-destructive-200'

export const EffectErrorDetails = ({ error }: { readonly error: unknown }) => {
  if (isEffectRpcQueryError(error) || isEffectHttpApiQueryError(error)) {
    const operation = isEffectRpcQueryError(error)
      ? error.rpcTag
      : `${error.groupId}.${error.endpoint}`
    return (
      <p className={alertClassName} role="alert">
        {error.name} from {operation} ({error.operation}){'\n'}
        {Cause.pretty(error.cause)}
      </p>
    )
  }

  return error instanceof Error ? (
    <p className={alertClassName} role="alert">
      {error.name}: {error.message}
    </p>
  ) : null
}
