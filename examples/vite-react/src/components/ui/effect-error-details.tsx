import { describeEffectError } from '../../../../shared/error-description.ts'

const alertClassName =
  'border border-l-4 border-destructive-900/80 border-l-destructive-600 bg-destructive-950/50 p-3 text-sm whitespace-pre-wrap text-destructive-200'

export const EffectErrorDetails = ({ error }: { readonly error: unknown }) => {
  const description = describeEffectError(error)
  return description === undefined ? null : (
    <p className={alertClassName} role="alert">
      {description.summary}
      {description.details === undefined ? null : (
        <>
          <br />
          {description.details}
        </>
      )}
    </p>
  )
}
