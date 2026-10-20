# Bind partial filters to explicit input projections

Status: Accepted. Extends [ADR 0008](0008-use-flat-prefix-matchable-key-tuples.md).

Bind a supported leaf view to native query filters with an explicit typed projection for partial canonical payload fields. Running the full input constructor would add defaults and overconstrain the match. Inverting arbitrary custom key encoders is not reliable. The caller therefore selects and encodes the fields to match.

Filters retain ordinary keys and TanStack's heterogeneous bulk-read types. Concrete generated keys remain the source of typed exact cache access.
