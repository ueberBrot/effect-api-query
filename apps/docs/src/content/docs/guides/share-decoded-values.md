---
title: Share Decoded Values
description: Opt in to schema-defined reference reuse through native structural sharing.
---

Use native `structuralSharing` when repeated decoded results contain rich values that the application treats as immutable. The adapter keeps TanStack's default behavior. The opt-in `schemaStructuralSharing` helper reconciles plain containers around Schema-defined decoded atoms. It never compares encoded wire values.

## Define the decoded semantics

This snapshot contains Schema class instances with dates, maps, sets, and Effect Options. The `attachment` field deliberately compares by reference, including custom objects. Import the model and callbacks below into the application's cache module.

```ts
import { schemaStructuralSharing } from "@ueberbrot/effect-api-query";
import { Equivalence, Schema } from "effect";

export class Reading extends Schema.Class<
  Reading,
  { readonly brand: unique symbol }
>("Reading")({
  id: Schema.Int,
  observedAt: Schema.DateFromString,
  values: Schema.ReadonlyMap(Schema.String, Schema.Int),
  labels: Schema.ReadonlySet(Schema.String),
  note: Schema.OptionFromNullOr(Schema.String),
  attachment: Schema.Unknown.pipe(
    Schema.overrideToEquivalence(() => Equivalence.strictEqual())
  ),
}) {}

export const Snapshot = Schema.Struct({
  revision: Schema.Int,
  readings: Schema.Array(Reading),
});
```

`Schema.toEquivalence(Reading)` compares the declared decoded fields. Dates compare by timestamp; these maps and sets compare their primitive contents without considering insertion order. Options compare their cases and values. Keep these values unchanged after caching or comparison: readonly types and frozen outer objects do not make Date, Map, Set, or their contents immutable. Effect equality may cache comparisons.

Use schema-defined fields only. Extra instance state, getters, mutable objects, and arbitrary custom classes need an explicit application equivalence or reference semantics such as `attachment`. `Schema.Unknown` alone does not promise reference equality. Do not use encoded wire values as a general definition of decoded equality.

## Reuse equivalent records

Choose the schema for an **atomic record**, not the surrounding snapshot. Derive its equivalence once and pass it explicitly:

```ts
export const shareSnapshot = schemaStructuralSharing(Reading, {
  equivalence: Schema.toEquivalence(Reading),
});
```

The callback accepts unknown values, so it also works in native QueryClient defaults and for selected observer values. Schema-valid atoms compare only through the supplied equivalence. Invalid atoms and unsupported rich objects pass through unchanged. Plain objects and dense arrays reconcile recursively by property or index; primitive values compare by reference/value identity. Use finite acyclic containers with enumerable string data properties only. Sparse arrays, symbol properties, accessors, and custom container prototypes are unsupported and pass through unchanged. Cyclic traversed containers throw a TypeError.

Schema type-side validation and equivalence must be synchronous and require no services; decoding/encoding services are never used. Validation defects, async checks, missing services and equivalence exceptions propagate synchronously. The helper neither decodes nor freezes data. Never mutate either input after caching.

An equivalent reading keeps its class instance and all nested references. A changed reading uses the incoming instance intact; the helper does not rebuild classes or merge their individual fields. When only `revision` changes, the readings array can retain its reference. Reordering is positional, not an ID-based entity merge. Selected plain containers follow the same rules.

In the module that owns `rpc`, import `configureUtils` from `@ueberbrot/effect-api-query` and opt in at the leaf:

```ts
const read = configureUtils(rpc.read, {
  query: { policy: { structuralSharing: shareSnapshot } },
});
const options = read.queryOptions({ select: (data) => data.readings.length });
```

The same callback works in a buffered HTTP `queryOptions` builder, or as a call-site `structuralSharing` option. Native defaults and more specific overrides retain their usual order. `structuralSharing: false` disables sharing. Selection and generated data/error types remain unchanged. Inspect cached references with `getQueryData` or an observer; in the checked Query version, an imperative fetch returns the fetched value before cache reconciliation.

## Include HTTP metadata

A metadata view caches `{ data, status, headers }`. The same helper traverses that envelope around the decoded atoms:

```ts
export const shareMetadataSnapshot = shareSnapshot;
```

Configure that callback for the metadata view:

```ts
const metadata = configureUtils(http.readings.read, {
  metadata: { policy: { structuralSharing: shareMetadataSnapshot } },
});
```

Fetched metadata envelopes and raw header snapshots remain frozen after the callback runs. Decoded data stays application-owned. Initial, manual, hydrated, and selected values retain their existing ownership rules. Sharing does not replace the paired [hydration codecs](/effect-api-query/guides/hydrate-query-views/).

The [compiled model and callbacks](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-structural-sharing.ts) and [factory usage](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-structural-sharing-use.ts) cover the full recipe.

## Measure the application workload

Rich-value comparison adds validation, equivalence checks, and container traversal. Use it when retained references help consumers; it is not a general speed improvement. Measure both equivalent and changed results, including selection and rendering when those matter. For meaningful private or extra class state, supply an equivalence that compares that state as well as declared fields; Schema-derived equivalence alone cannot see it.

`vp run sharing-baseline` measures native cache writes after installing generated RPC options. It reports five samples of 50 writes for 10 and 1,000 readings, with equal, one-record-changed, and all-records-changed inputs, comparing native sharing, the original hand-written recipe, the helper, and disabled sharing. Inputs are freshly allocated outside each timed sample. The measurement excludes decoding, transport, rendering, and consumer savings, so it cannot establish end-to-end performance.
