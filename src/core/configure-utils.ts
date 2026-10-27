import type {
  MutationObserverOptions,
  MutationFunctionContext,
  QueryFunctionContext,
  QueryKey,
  QueryObserverOptions,
} from "@tanstack/query-core";
import { Array as EffectArray, Order, Predicate } from "effect";

import { configureMutation, configureQuery } from "./configure";
import type {
  RuntimeMutationBuilder,
  RuntimeQueryBuilder,
  RuntimeViewConfiguration,
} from "./configure";
import type { MutationLeaf, QueryView, SupportedQueryView } from "./inference";
import type { MutationInterceptor, QueryInterceptor } from "./interceptor";
import type {
  LocalQueryOption,
  MutationPolicy,
  MutationPolicyOptions,
  QueryPolicy,
} from "./policy";
import { inputKind } from "./prepared-input";
import type {
  OwnedMutationOption,
  StreamedPolicyOptions,
  KeysOfUnion,
  UnaryQueryBuilder,
  UnaryQueryBuilderDescriptor,
} from "./types";

export interface UtilityNode {
  readonly key: () => QueryKey;
}

export interface QueryConfiguration<
  Leaf,
  View extends SupportedQueryView<Leaf>,
> {
  readonly policy?: QueryPolicy<Leaf, View> &
    (View extends "streamed" ? Partial<StreamedPolicyOptions> : unknown);
  readonly interceptors?: readonly QueryInterceptor<Leaf, View>[];
}

export type MutationConfiguration<Leaf> = MutationPolicyOptions & {
  readonly policy?: MutationPolicy<Leaf>;
  readonly interceptors?: readonly MutationInterceptor<Leaf>[];
};

export type SharedQueryInterceptor<View extends QueryView> = <Data>(execution: {
  readonly context: QueryFunctionContext<
    QueryKey,
    View extends "infinite" ? unknown : never
  >;
  readonly next: () => Promise<Data>;
}) => Promise<Data>;

export type SharedMutationInterceptor = <Data>(execution: {
  readonly input: unknown;
  readonly context: MutationFunctionContext | undefined;
  readonly next: () => Promise<Data>;
}) => Promise<Data>;

export interface SharedQueryConfiguration<View extends QueryView> {
  readonly policy?: Omit<
    QueryObserverOptions<unknown, unknown>,
    LocalQueryOption
  > &
    (View extends "streamed" ? Partial<StreamedPolicyOptions> : unknown);
  readonly interceptors?: readonly SharedQueryInterceptor<View>[];
}

export type SharedMutationConfiguration = MutationPolicyOptions & {
  readonly policy?: Omit<
    MutationObserverOptions<unknown, unknown, unknown>,
    OwnedMutationOption | "onMutate"
  >;
  readonly interceptors?: readonly SharedMutationInterceptor[];
};

export type InheritedMethods = {
  readonly [
    Key in
      | "toString"
      | "toLocaleString"
      | "valueOf"
      | "hasOwnProperty"
      | "isPrototypeOf"
      | "propertyIsEnumerable"
  ]: (...args: never[]) => unknown;
};

// Generated branches contain only their key builder and named children.
export type ChildNames<Node> = Exclude<Extract<keyof Node, string>, "key">;

export type Children<Node> = [ChildNames<Node>] extends [never]
  ? never
  : {
      readonly [Key in ChildNames<Node>]?:
        | UtilsConfiguration<Node[Key]>
        | (Key extends keyof InheritedMethods ? InheritedMethods[Key] : never);
    };

export type LeafMembers<Node> = Node extends MutationLeaf
  ? Node
  : [SupportedQueryView<Node>] extends [never]
    ? never
    : Node;

/** Typed defaults and ordered interceptors for a generated tree, branch, or leaf. */
export type UtilsConfiguration<Node> = [LeafMembers<Node>] extends [never]
  ? {
      readonly [View in QueryView]?: SharedQueryConfiguration<View>;
    } & {
      readonly mutation?: SharedMutationConfiguration;
      readonly scoped?: Children<Node>;
    }
  : {
      readonly [View in QueryView]?: View extends SupportedQueryView<Node>
        ? QueryConfiguration<Node, Extract<View, SupportedQueryView<Node>>>
        : never;
    } & {
      readonly mutation?: [Node] extends [MutationLeaf]
        ? MutationConfiguration<Node>
        : never;
      readonly scoped?: never;
    };

export type ExtraProperties<Expected, Actual> = {
  readonly [Key in Exclude<KeysOfUnion<Actual>, keyof Expected>]: never;
};

export type Property<Value, Key extends PropertyKey> = Value extends unknown
  ? Key extends keyof Value
    ? Value[Key]
    : never
  : never;

export type ExactView<Expected, Actual> = ExtraProperties<Expected, Actual> &
  ("policy" extends KeysOfUnion<Actual>
    ? {
        readonly policy?: ExtraProperties<
          NonNullable<Property<Expected, "policy">>,
          NonNullable<Property<Actual, "policy">>
        >;
      }
    : unknown);

export type ExactChildConfiguration<Node, Key, Actual> =
  Key extends keyof InheritedMethods
    ? [Exclude<Actual, InheritedMethods[Key]>] extends [never]
      ? never
      :
          | ExactConfiguration<Node, Exclude<Actual, InheritedMethods[Key]>>
          | Extract<Actual, InheritedMethods[Key]>
    : ExactConfiguration<Node, Actual>;

export type ExactConfiguration<Node, Actual> = [Actual] extends [
  UtilsConfiguration<Node>,
]
  ? ExtraProperties<UtilsConfiguration<Node>, Actual> & {
      readonly [
        Key in KeysOfUnion<Actual> & keyof UtilsConfiguration<Node>
      ]?: Key extends "scoped"
        ? NonNullable<Property<Actual, Key>> extends object
          ? ExtraProperties<
              Children<Node>,
              NonNullable<Property<Actual, Key>>
            > & {
              readonly [
                Child in KeysOfUnion<NonNullable<Property<Actual, Key>>> &
                  keyof Node
              ]?: ExactChildConfiguration<
                Node[Child],
                Child,
                NonNullable<Property<NonNullable<Property<Actual, Key>>, Child>>
              >;
            }
          : unknown
        : ExactView<
            NonNullable<UtilsConfiguration<Node>[Key]>,
            NonNullable<Property<Actual, Key>>
          >;
    }
  : never;

export type StreamPolicy<Configuration> = Configuration extends {
  readonly streamed: { readonly policy: infer Policy };
}
  ? Policy
  : unknown;

export type ScopedConfiguration<
  Configuration,
  Key extends PropertyKey,
> = Configuration extends { readonly scoped: infer Scoped }
  ? Key extends keyof Scoped
    ? Scoped[Key]
    : unknown
  : unknown;

export type RetentionDefault<Configuration, Inherited> =
  StreamPolicy<Configuration> extends { readonly maxChunks: infer MaxChunks }
    ? { readonly maxChunks: MaxChunks }
    : Inherited;

export type WithDefaultRetention<Builder> =
  UnaryQueryBuilderDescriptor<Builder> extends infer Descriptor
    ? Descriptor extends {
        readonly input: infer Input;
        readonly data: infer Data;
        readonly error: infer Error;
        readonly key: infer Key extends QueryKey;
        readonly skippedKey: infer SkippedKey extends QueryKey;
        readonly adapterOptions: (options: infer AdapterOptions) => void;
        readonly inputless: infer Inputless extends boolean;
      }
      ? UnaryQueryBuilder<
          Input,
          Data,
          Error,
          Key,
          SkippedKey,
          Omit<AdapterOptions, "maxChunks"> & {
            readonly maxChunks?: StreamedPolicyOptions["maxChunks"];
          },
          Inputless
        >
      : Builder
    : Builder;

export type WithDefaultKeyRetention<KeyBuilder> = KeyBuilder extends (
  ...args: infer Args
) => infer Key
  ? Args extends readonly [infer Input, infer Policy]
    ? (input: Input, policy?: Partial<Policy>) => Key
    : Args extends readonly [infer Policy]
      ? (policy?: Partial<Policy>) => Key
      : KeyBuilder
  : KeyBuilder;

/** Preserves leaf builders and makes configured stream retention optional at call sites. */
export type ConfiguredUtils<Node, Configuration, Inherited = unknown> = {
  readonly [Key in keyof Node]: Node[Key] extends UtilityNode
    ? Key extends string
      ? ConfiguredUtils<
          Node[Key],
          ScopedConfiguration<Configuration, Key>,
          RetentionDefault<Configuration, Inherited>
        >
      : Node[Key]
    : RetentionDefault<Configuration, Inherited> extends {
          readonly maxChunks: StreamedPolicyOptions["maxChunks"];
        }
      ? Key extends "streamedOptions"
        ? WithDefaultRetention<Node[Key]>
        : Key extends "streamedKey"
          ? WithDefaultKeyRetention<Node[Key]>
          : Node[Key]
      : Node[Key];
};

type RuntimeConfiguration = Partial<
  Record<QueryView | "mutation", RuntimeViewConfiguration>
> & {
  readonly scoped?: Readonly<Record<string, RuntimeConfiguration | undefined>>;
};

type RuntimeNode = Record<string, unknown> & UtilityNode;
type RuntimeBuilder = (...args: unknown[]) => unknown;

interface ConfigurationLayer {
  readonly depth: number;
  readonly options: RuntimeConfiguration;
}

const configuredLeaves = new WeakMap<
  RuntimeNode,
  {
    readonly original: RuntimeNode;
    readonly layers: readonly ConfigurationLayer[];
  }
>();

const views: readonly QueryView[] = [
  "query",
  "infinite",
  "metadata",
  "live",
  "streamed",
];

const snapshotConfiguration = (
  configuration: RuntimeConfiguration
): RuntimeConfiguration => {
  const snapshot: RuntimeConfiguration = {};
  for (const view of [...views, "mutation"] as const) {
    const entry = configuration[view];
    if (entry !== undefined) {
      snapshot[view] = Object.freeze({
        ...entry,
        policy:
          entry.policy === undefined
            ? undefined
            : Object.freeze({ ...entry.policy }),
        interceptors:
          entry.interceptors === undefined
            ? undefined
            : Object.freeze([...entry.interceptors]),
      });
    }
  }
  return Object.freeze(snapshot);
};

const scopeConfigurations = (
  layers: readonly ConfigurationLayer[]
): readonly RuntimeConfiguration[] => {
  const scopes = new Map<number, RuntimeConfiguration>();
  for (const { depth, options } of layers) {
    const scope = scopes.get(depth) ?? {};
    for (const view of [...views, "mutation"] as const) {
      const entry = options[view];
      if (entry === undefined) {
        continue;
      }
      const previous = scope[view];
      scope[view] = {
        policy: { ...previous?.policy, ...entry.policy },
        interceptors: [
          ...(previous?.interceptors ?? []),
          ...(entry.interceptors ?? []),
        ],
        callbacks: entry.callbacks ?? previous?.callbacks,
      };
    }
    scopes.set(depth, scope);
  }
  return [...scopes.values()];
};

const configureLeaf = (
  node: RuntimeNode,
  configurations: readonly RuntimeConfiguration[]
): RuntimeNode => {
  const configured = { ...node };
  for (const view of views) {
    if (!Object.hasOwn(node, `${view}Options`)) {
      continue;
    }
    const inherited = configurations.flatMap((entry) =>
      entry[view] === undefined ? [] : [entry[view]]
    );
    if (inherited.length === 0) {
      continue;
    }
    const policy: Record<string, unknown> = {};
    for (const entry of inherited) {
      Object.assign(policy, entry.policy);
    }
    const name = `${view}Options`;
    const builder = node[name];
    if (!Predicate.isFunction(builder)) {
      throw new TypeError(`${name} must be a function`);
    }
    // SAFETY: Generated query builders return their owned query function and options.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    configured[name] = configureQuery(builder as RuntimeQueryBuilder, view, {
      policy,
      interceptors: inherited.flatMap((entry) => entry.interceptors ?? []),
    });
    if (view === "streamed") {
      const { streamedKey } = node;
      if (!Predicate.isFunction(streamedKey)) {
        throw new TypeError("Streamed queries require a key builder");
      }
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
      const buildKey = streamedKey as RuntimeBuilder;
      const history = Object.fromEntries(
        Object.entries(policy).filter(([option]) =>
          [
            "maxChunks",
            "refetchMode",
            "publicationBatchSize",
            "publicationMaxWaitMs",
          ].includes(option)
        )
      );
      configured["streamedKey"] =
        inputKind(node.key) === "Inputless"
          ? (options?: Partial<StreamedPolicyOptions>) =>
              buildKey({ ...history, ...options })
          : (input: unknown, options?: Partial<StreamedPolicyOptions>) =>
              buildKey(input, { ...history, ...options });
    }
  }
  if (Object.hasOwn(node, "mutationOptions")) {
    const mutations = configurations.flatMap((entry) =>
      entry.mutation === undefined ? [] : [entry.mutation]
    );
    if (mutations.length > 0) {
      const candidate = node["mutationOptions"];
      if (!Predicate.isFunction(candidate)) {
        throw new TypeError("mutationOptions must be a function");
      }
      // SAFETY: Generated mutation builders return their owned mutation function and options.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      let builder = candidate as RuntimeMutationBuilder;
      for (const entry of mutations) {
        builder = configureMutation(builder, {
          policy: entry.policy,
          callbacks: entry.callbacks,
        });
      }
      const interceptors = mutations.flatMap(
        (entry) => entry.interceptors ?? []
      );
      if (interceptors.length > 0) {
        builder = configureMutation(builder, { interceptors });
      }
      configured["mutationOptions"] = builder;
    }
  }
  return configured;
};

const configureNode = (
  node: RuntimeNode,
  inherited: readonly ConfigurationLayer[],
  configuration: RuntimeConfiguration
): RuntimeNode => {
  const configurations = [
    ...inherited,
    {
      depth: node.key().length,
      options: snapshotConfiguration(configuration),
    },
  ];
  const children = Object.entries(node).filter(
    (entry): entry is [string, RuntimeNode] =>
      Predicate.hasProperty(entry[1], "key") &&
      Predicate.isFunction(entry[1].key)
  );
  for (const name of Object.keys(configuration.scoped ?? {})) {
    if (!children.some(([key]) => key === name)) {
      throw new TypeError(`Unknown utility scope: ${name}`);
    }
  }
  if (children.length === 0) {
    const previous = configuredLeaves.get(node);
    const original = previous?.original ?? node;
    const layers = EffectArray.sortWith(
      [...(previous?.layers ?? []), ...configurations],
      (layer) => layer.depth,
      Order.Number
    );
    const configured = Object.freeze({
      ...configureLeaf(original, scopeConfigurations(layers)),
    });
    configuredLeaves.set(configured, { original, layers });
    return configured;
  }
  return Object.freeze({
    ...node,
    ...Object.fromEntries(
      children.map(([key, child]) => [
        key,
        configureNode(
          child,
          configurations,
          configuration.scoped !== undefined &&
            Object.hasOwn(configuration.scoped, key)
            ? (configuration.scoped[key] ?? {})
            : {}
        ),
      ])
    ),
  });
};

/** Applies root, branch, and leaf configuration while preserving generated cache identity. */
export const configureUtils = <
  Node extends UtilityNode,
  const Configuration extends object,
>(
  tree: Node,
  configuration: Configuration &
    NoInfer<UtilsConfiguration<Node>> &
    NoInfer<ExactConfiguration<Node, Configuration>>
): ConfiguredUtils<Node, Configuration> => {
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const node = tree as RuntimeNode;
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const options = configuration as RuntimeConfiguration;
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  return configureNode(node, [], options) as ConfiguredUtils<
    Node,
    Configuration
  >;
};
