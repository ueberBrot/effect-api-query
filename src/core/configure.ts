import { Array as EffectArray } from "effect";

import type {
  MutationLeaf,
  SupportedQueryView,
  ViewBuilder,
} from "./inference";
import { withMutationInterceptor, withQueryInterceptor } from "./interceptor";
import type { MutationInterceptor, QueryInterceptor } from "./interceptor";
import { withMutationPolicy, withQueryPolicy } from "./policy";
import type {
  MutationPolicy,
  MutationPolicyOptions,
  QueryPolicy,
} from "./policy";
import type { ExactBuilderOptions } from "./types";

/** Binds defaults and ordered interceptors, preserving the leaf and every builder overload. */
export const configureQuery = <
  Leaf extends object,
  View extends SupportedQueryView<Leaf>,
  Supplied extends object,
>(
  leaf: Leaf,
  view: View,
  configuration: {
    readonly policy?: ExactBuilderOptions<
      QueryPolicy<NoInfer<Leaf>, NoInfer<View>>,
      Supplied
    >;
    /** First entry is the outermost interceptor. */
    readonly interceptors?: readonly QueryInterceptor<
      NoInfer<Leaf>,
      NoInfer<View>
    >[];
  }
): Leaf => {
  const name = `${view}Options`;
  const configured = { ...leaf };
  for (const interceptor of EffectArray.reverse(
    configuration.interceptors ?? []
  )) {
    Object.assign(configured, {
      [name]: withQueryInterceptor(configured, view, interceptor),
    });
  }
  if (configuration.policy !== undefined) {
    // The policy uses the same leaf/view pair as the preserved builder.
    const { policy } = configuration;
    const builder: ViewBuilder<Leaf, View> = withQueryPolicy<
      Leaf,
      View,
      Supplied
    >(configured, view, policy);
    Object.assign(configured, { [name]: builder });
  }
  return Object.freeze({ ...configured });
};

/** Configures a mutation leaf without losing its query views or optimistic-context inference. */
export const configureMutation = <
  Leaf extends MutationLeaf,
  Supplied extends object,
>(
  leaf: Leaf,
  configuration: MutationPolicyOptions & {
    readonly policy?: ExactBuilderOptions<
      MutationPolicy<NoInfer<Leaf>>,
      Supplied
    >;
    /** First entry is the outermost interceptor. */
    readonly interceptors?: readonly MutationInterceptor<NoInfer<Leaf>>[];
  }
): Leaf => {
  const configured = { ...leaf };
  for (const interceptor of EffectArray.reverse(
    configuration.interceptors ?? []
  )) {
    Object.assign(configured, {
      mutationOptions: withMutationInterceptor(configured, interceptor),
    });
  }
  if (configuration.policy !== undefined) {
    Object.assign(configured, {
      mutationOptions: withMutationPolicy<Leaf, Supplied>(
        configured,
        configuration.policy,
        configuration
      ),
    });
  }
  return Object.freeze({ ...configured });
};
