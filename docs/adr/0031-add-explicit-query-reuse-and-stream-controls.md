# Add explicit query reuse and stream controls

Status: Accepted. Extends ADRs 0008, 0009, 0020, 0027, 0028 and 0029.

Generated cache keys and existing defaults remain stable. Branch view filters index the generated leaves and combine native prefix matching with a view predicate. They do not infer operation positions from arbitrary strings in keys.

Prepared inputs explicitly reuse construction, encoding and canonicalization. Each handle belongs to one utility leaf and keeps its normalized execution input alive. The handle and canonical identity are immutable; arbitrary decoded inputs remain application-owned and must not change. No global input-identity memoization is introduced. Handles cannot cross factory owners, become mutation variables, or replace infinite page mappers.

Configuration helpers return a frozen leaf with its existing key functions and builder overloads. Policies remain defaults, local options override them, and ordered interceptors wrap each execution attempt. Mutation callback composition remains explicit. This allows configuration to compose across views without changing existing helper signatures.

Accumulated streams may opt into a publication deadline measured from the first buffered event. The first emission still publishes immediately. Count and deadline both flush ordered batches; only one source pull is outstanding. Cancellation drops pending events and closes the iterator. A deadline does not bound transport cleanup, and replace refetches still publish only on completion. Explicit deadlines contribute to stream identity.

Declared-error lookup matches a single typed failure by tag and preserves the original wrapper. Defects, interruptions and composite Causes do not match. Event consumption remains a native Effect: callbacks are sequential, cleanup precedes the exit callback, and the application owns execution, interruption and recovery.
