import type { QueryKey } from "@tanstack/query-core";

import type { SupportedQueryView } from "./inference";

/** Selects every input and stream policy for one leaf's query view. */
export const viewPrefix = <
  const Key extends QueryKey,
  Leaf extends { readonly key: () => Key },
  View extends SupportedQueryView<Leaf>,
>(
  leaf: Leaf & { readonly key: () => Key },
  view: View
): readonly [...Key, View] => Object.freeze([...leaf.key(), view]);
