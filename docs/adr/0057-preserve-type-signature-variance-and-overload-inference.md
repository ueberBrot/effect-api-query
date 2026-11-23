# Preserve type signature variance and overload inference

Status: Accepted.

Three non-obvious TypeScript signatures in `src/core/` encode variance and inference trade-offs that simpler shapes break:

- **`GeneratedQueryFunction` (`src/core/types.ts`)**: Intersects `QueryFunction<Data> & QueryFunction<Data, Key>` so broad native direct calls type-check while framework hooks still infer the narrowed key signature.
- **`adapterOptions` metadata (`src/core/types.ts`)**: Typed contravariantly as `(options: AdapterOptions) => void` so configured builders that accept wider adapter options remain assignable to the original unconfigured builder.
- **`recoverStream` overloads (`src/core/stream-recovery.ts`)**: Keeps separate overloads instead of a unified signature so union-typed `RecoverStreamOptions` annotations do not degrade direct callback type inference.
