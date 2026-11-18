---
title: Share Decoded Values
description: Opt in to schema-defined reference reuse through native structural sharing.
---

Use `schemaStructuralSharing` when repeated responses contain immutable decoded values such as Schema class instances. The helper keeps equivalent values by reference and reuses plain containers around them. Without the helper, TanStack's default sharing applies.

## Define the decoded semantics

This snapshot contains Schema class instances, dates, maps, sets, and Effect Options. The model compares the `attachment` field by reference. Put the model and callbacks in your cache module.

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

`Schema.toEquivalence(Reading)` compares declared decoded fields. Dates compare by timestamp. These maps and sets compare primitive contents regardless of insertion order. Options compare their case and value. Keep cached values unchanged. A frozen outer object does not freeze a Date, Map, Set, or its contents, and Effect can cache comparisons.

If an instance has extra state, getters, or mutable values, define how to compare them or use reference equality. `Schema.Unknown` alone does not give reference equality. Compare decoded values according to how your application uses them.

## Reuse equivalent records

Derive the equivalence once for one reading. Pass it with the reading Schema.

```ts
export const shareSnapshot = schemaStructuralSharing(Reading, {
  equivalence: Schema.toEquivalence(Reading),
});
```

The callback also works in QueryClient defaults and on selected values. It uses the supplied equivalence for Schema-valid atoms and recursively compares plain objects and dense arrays. Unsupported values pass through. Use finite containers with enumerable string data properties. Sparse arrays, symbol properties, accessors, and custom prototypes pass through. Traversing a cycle throws `TypeError`.

Both Schema validation and equivalence must run synchronously without services. Defects, asynchronous checks, missing services, and thrown equivalence errors propagate. The helper compares decoded values and leaves them unfrozen. Keep both inputs unchanged.

An equivalent reading keeps the old instance and its references. A changed reading uses the entire incoming instance. If only `revision` changes, the array can keep its reference. Comparisons follow array positions, so a reorder does not match records by ID.

Import `configureUtils` from `@ueberbrot/effect-api-query` where you create `rpc`. Enable the callback for this leaf.

```ts
const read = configureUtils(rpc.read, {
  query: { policy: { structuralSharing: shareSnapshot } },
});
const options = read.queryOptions({ select: (data) => data.readings.length });
```

Pass the same callback to a buffered HTTP builder or set it on one call. Native defaults still apply unless you override them. Use `structuralSharing: false` to disable sharing. Inspect reconciled references with `getQueryData` or an observer. In the checked Query version, an imperative fetch returns the value before cache reconciliation.

## Include HTTP metadata

A metadata view caches `{ data, status, headers }`. The helper can traverse the envelope and compare its decoded values.

```ts
export const shareMetadataSnapshot = shareSnapshot;
```

Set the callback on the metadata view.

```ts
const metadata = configureUtils(http.readings.read, {
  metadata: { policy: { structuralSharing: shareMetadataSnapshot } },
});
```

Fetched metadata envelopes and raw headers stay frozen after the callback. Decoded data stays application-owned. Manual values, initial values, hydration, and selection keep their existing ownership. For transfer, use paired [hydration codecs](/effect-api-query/guides/hydrate-query-views/).

See the compiled [model and callbacks](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-structural-sharing.ts) and [factory setup](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-structural-sharing-use.ts).

## Measure the application workload

Compare equivalent and changed results using your actual cache and rendering workload. Validation and traversal add work, so measure what retained references save. Include extra or private state in the equivalence if it affects the result.

`vp run sharing-baseline` compares native sharing, the helper, a manual recipe, and disabled sharing on cache writes. See [performance](/effect-api-query/reference/performance/) for the measurement setup. Measure decoding, transport, and rendering separately for end-to-end costs.
