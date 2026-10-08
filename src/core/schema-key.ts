import { Function, Predicate, Schema, SchemaAST } from 'effect'

export interface SchemaKeyEncoding {
  readonly requiresEncoder: boolean
  readonly encode: (input: unknown) => unknown
}

// Runtime Schema metadata erases encoding service types. Conservatively require a
// custom encoder for encoding-side middleware; decoding-only middleware uses identity.
const containsUnsafeKeyEncoding = (value: unknown, seen = new WeakSet()): boolean => {
  if (!Predicate.isObjectOrArray(value) || seen.has(value)) {
    return false
  }
  seen.add(value)

  if (Predicate.hasProperty(value, '_tag') && value._tag === 'Middleware') {
    return !Predicate.hasProperty(value, 'encode') || value.encode !== Function.identity
  }

  if (SchemaAST.isAST(value)) {
    const representation = value.annotations?.['representation']
    if (
      Predicate.hasProperty(representation, 'id') &&
      representation.id === 'effect/schema/Redacted'
    ) {
      return true
    }
    if (SchemaAST.isSuspend(value)) {
      try {
        if (containsUnsafeKeyEncoding(value.thunk(), seen)) {
          return true
        }
      } catch {
        return true
      }
    }
  }

  return Object.values(value).some((child) =>
    Array.isArray(child)
      ? child.some((element) => containsUnsafeKeyEncoding(element, seen))
      : containsUnsafeKeyEncoding(child, seen),
  )
}

/** Keeps unsafe encoding inspection and default synchronous encoding together. */
export const createSchemaKeyEncoding = (schema: Schema.Top): SchemaKeyEncoding => {
  let requiresEncoder: boolean | undefined
  let defaultEncode: SchemaKeyEncoding['encode'] | undefined

  return {
    get requiresEncoder() {
      requiresEncoder ??= containsUnsafeKeyEncoding(schema.ast)
      return requiresEncoder
    },
    encode: (input) => {
      if (defaultEncode === undefined) {
        // SAFETY: Callers require a custom encoder for unsafe Schema encoding;
        // the default path can encode synchronously without remaining services.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
        const encodingSchema = schema as unknown as Schema.ConstraintEncoder<unknown>
        // Parser creation stays inside the caller's key-generation error handling.
        defaultEncode = Schema.encodeUnknownSync(encodingSchema)
      }
      return defaultEncode(input)
    },
  }
}
