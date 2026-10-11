import { Function, Predicate, Schema, SchemaAST } from 'effect'

export interface SchemaKeyEncoding {
  readonly requiresEncoder: boolean
  readonly encode: (input: unknown) => unknown
}

const safeAsts = new WeakSet()

const containsUnsafeKeyEncoding = (value: unknown, seen: Set<object>): boolean => {
  if (!Predicate.isObjectOrArray(value) || seen.has(value) || safeAsts.has(value)) {
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

export const createSchemaKeyEncoding = (schema: Schema.Top): SchemaKeyEncoding => {
  let requiresEncoder: boolean | undefined
  let defaultEncode: SchemaKeyEncoding['encode'] | undefined

  return {
    get requiresEncoder() {
      if (requiresEncoder === undefined) {
        const seen = new Set<object>()
        requiresEncoder = containsUnsafeKeyEncoding(schema.ast, seen)
        if (!requiresEncoder) {
          for (const node of seen) {
            if (SchemaAST.isAST(node)) {
              safeAsts.add(node)
            }
          }
        }
      }
      return requiresEncoder
    },
    encode: (input) => {
      if (defaultEncode === undefined) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
        const encodingSchema = schema as unknown as Schema.ConstraintEncoder<unknown>
        defaultEncode = Schema.encodeUnknownSync(encodingSchema)
      }
      return defaultEncode(input)
    },
  }
}
