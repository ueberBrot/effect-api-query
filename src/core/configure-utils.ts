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
  RuntimeOptions,
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
import { isStreamPolicyOption } from "./streamed-query";
import type {
  OwnedMutationOption,
  StreamedPolicyOptions,
  LivePolicyOptions,
  KeysOfUnion,
  UnaryQueryBuilder,
  UnaryQueryBuilderDescriptor,
  utilityPaths,
} from "./types";
import {
  buildBranchFrom,
  defineLazyLeafDescriptor,
  readLazyLeafSlot,
} from "./utility-tree";
import type { LazyLeafSlot } from "./utility-tree";

export interface UtilityNode {
  readonly key: () => QueryKey;
}

export type StreamKeyPolicy<Leaf, View extends "streamed" | "live"> =
  Leaf extends Record<`${View}Key`, (...args: infer Args) => unknown>
    ? Required<Args> extends readonly [infer Options]
      ? Partial<Omit<NonNullable<Options>, "input">>
      : View extends "streamed"
        ? Partial<StreamedPolicyOptions>
        : LivePolicyOptions
    : View extends "streamed"
      ? Partial<StreamedPolicyOptions>
      : LivePolicyOptions;

export type QueryConfiguration<
  Leaf,
  View extends SupportedQueryView<Leaf>,
> = QueryPolicy<Leaf, View> &
  (View extends "streamed" | "live" ? StreamKeyPolicy<Leaf, View> : unknown) & {
    readonly interceptors?: readonly QueryInterceptor<Leaf, View>[];
  };

export type MutationConfiguration<Leaf> = MutationPolicy<Leaf> &
  MutationPolicyOptions & {
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

export type SharedQueryConfiguration<View extends QueryView> = Omit<
  QueryObserverOptions<unknown, unknown>,
  LocalQueryOption
> &
  (View extends "streamed"
    ? Partial<StreamedPolicyOptions>
    : View extends "live"
      ? LivePolicyOptions
      : unknown) & {
    readonly interceptors?: readonly SharedQueryInterceptor<View>[];
  };

export type SharedMutationConfiguration = Omit<
  MutationObserverOptions<unknown, unknown, unknown>,
  OwnedMutationOption | "onMutate"
> &
  MutationPolicyOptions & {
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

export type IsLeaf<Node> = Node extends
  | { readonly queryOptions: unknown }
  | { readonly streamedOptions: unknown }
  | { readonly mutationOptions: unknown }
  ? true
  : false;

export type NodePaths<Node> = Node extends {
  readonly [utilityPaths]?: infer Paths extends string;
}
  ? Paths
  : never;

export type LookupPath<Node, Path extends string> = Path extends keyof Node
  ? Node[Path]
  : LookupDescendant<Node, Path>;

export type LookupDescendant<
  Node,
  Path extends string,
  Prefix extends string = "",
> = Path extends `${infer Head}.${infer Tail}`
  ? `${Prefix}${Head}` extends keyof Node
    ? LookupPath<Node[`${Prefix}${Head}`], Tail> extends infer Child
      ? [Child] extends [never]
        ? LookupDescendant<Node, Tail, `${Prefix}${Head}.`>
        : Child
      : never
    : LookupDescendant<Node, Tail, `${Prefix}${Head}.`>
  : never;

export type NodeViews<Node> =
  IsLeaf<Node> extends true
    ? {
        readonly [View in QueryView]?: View extends SupportedQueryView<Node>
          ? QueryConfiguration<Node, Extract<View, SupportedQueryView<Node>>>
          : never;
      } & {
        readonly mutation?: Node extends MutationLeaf
          ? MutationConfiguration<Node>
          : never;
      }
    : {
        readonly [View in QueryView]?: SharedQueryConfiguration<View>;
      } & {
        readonly mutation?: SharedMutationConfiguration;
      };

export type PathConfigurations<Node> = [NodePaths<Node>] extends [never]
  ? never
  : {
      readonly [Path in NodePaths<Node>]?:
        | NodeViews<LookupPath<Node, Path>>
        | (Path extends keyof InheritedMethods
            ? InheritedMethods[Path]
            : never);
    };

/** Typed defaults and ordered interceptors for a generated tree, branch, or leaf. */
export type UtilsConfiguration<Node> = NodeViews<Node> & {
  readonly paths?: IsLeaf<Node> extends true ? never : PathConfigurations<Node>;
};

export type ExtraProperties<Expected, Actual> = {
  readonly [Key in Exclude<KeysOfUnion<Actual>, keyof Expected>]: never;
};

export type Property<Value, Key extends PropertyKey> = Value extends unknown
  ? Key extends keyof Value
    ? Value[Key]
    : never
  : never;

export type ExactViews<Node, Actual> = {
  readonly [
    View in KeysOfUnion<Actual> & keyof NodeViews<Node>
  ]?: ExtraProperties<
    NonNullable<NodeViews<Node>[View]>,
    NonNullable<Property<Actual, View>>
  >;
};

export type ExactPathViews<Node, Path, Actual> =
  Path extends keyof InheritedMethods
    ? [Exclude<Actual, InheritedMethods[Path]>] extends [never]
      ? never
      :
          | ExactPathConfiguration<
              Node,
              Exclude<Actual, InheritedMethods[Path]>
            >
          | Extract<Actual, InheritedMethods[Path]>
    : ExactPathConfiguration<Node, Actual>;

export type ExactPathConfiguration<Node, Actual> = ExtraProperties<
  NodeViews<Node>,
  Actual
> &
  ExactViews<Node, Actual>;

export type ExactPaths<Node, Paths> = ExtraProperties<
  PathConfigurations<Node>,
  Paths
> & {
  readonly [Path in KeysOfUnion<Paths> & NodePaths<Node>]?: ExactPathViews<
    LookupPath<Node, Path>,
    Path,
    NonNullable<Property<Paths, Path>>
  >;
};

export type ExactConfiguration<Node, Actual> = ExactViews<Node, Actual> &
  ExtraProperties<UtilsConfiguration<Node>, Actual> & {
    readonly paths?: "paths" extends KeysOfUnion<Actual>
      ? ExactPaths<Node, NonNullable<Property<Actual, "paths">>>
      : unknown;
  };

export type HasRetention<Configuration> = [Configuration] extends [never]
  ? false
  : [Configuration] extends [
        {
          readonly streamed: {
            readonly maxChunks: StreamedPolicyOptions["maxChunks"];
          };
        },
      ]
    ? true
    : false;

export type ConfigPaths<Configuration> = [Configuration] extends [
  {
    readonly paths: infer Paths;
  },
]
  ? Paths
  : object;

export type ConfigHasAnyRetention<
  Configuration,
  Paths = ConfigPaths<Configuration>,
> =
  HasRetention<Configuration> extends true
    ? true
    : true extends {
          [Path in keyof Paths]-?: HasRetention<Paths[Path]>;
        }[keyof Paths]
      ? true
      : false;

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
  options: infer Options
) => infer Key
  ? "input" extends keyof NonNullable<Options>
    ? (
        options: Omit<NonNullable<Options>, "maxChunks"> & {
          readonly maxChunks?: StreamedPolicyOptions["maxChunks"];
        }
      ) => Key
    : (
        options?: Omit<NonNullable<Options>, "maxChunks"> & {
          readonly maxChunks?: StreamedPolicyOptions["maxChunks"];
        }
      ) => Key
  : KeyBuilder;

export type FilterWithDefaultRetention<Options> = Options extends {
  readonly view: "streamed";
  readonly maxChunks: infer Retention;
}
  ? Omit<Options, "maxChunks"> & { readonly maxChunks?: Retention }
  : Options;

export type WithDefaultFilterRetention<Filter> = Filter extends (
  options?: infer Options
) => infer Result
  ? (options?: FilterWithDefaultRetention<Options>) => Result
  : Filter;

export type JoinPath<
  Prefix extends string,
  Key extends string,
> = Prefix extends "" ? Key : `${Prefix}.${Key}`;

export type ApplyRetentionTree<
  Node,
  Paths,
  Inherited extends boolean,
  Prefix extends string = "",
> = {
  readonly [Key in keyof Node]: Key extends string
    ? Key extends "streamedOptions"
      ? Inherited extends true
        ? WithDefaultRetention<Node[Key]>
        : Node[Key]
      : Key extends "streamedKey"
        ? Inherited extends true
          ? WithDefaultKeyRetention<Node[Key]>
          : Node[Key]
        : Key extends "queryFilter"
          ? Inherited extends true
            ? WithDefaultFilterRetention<Node[Key]>
            : Node[Key]
          : Node[Key] extends UtilityNode
            ? ApplyRetentionTree<
                Node[Key],
                Paths,
                Inherited extends true
                  ? true
                  : JoinPath<Prefix, Key> extends keyof Paths
                    ? HasRetention<Paths[JoinPath<Prefix, Key>]>
                    : false,
                JoinPath<Prefix, Key>
              >
            : Node[Key]
    : Node[Key];
};

/** Preserves leaf builders and makes configured stream retention optional at call sites. */
export type ConfiguredUtils<Node, Configuration> =
  ConfigHasAnyRetention<Configuration> extends true
    ? ApplyRetentionTree<
        Node,
        ConfigPaths<Configuration>,
        HasRetention<Configuration>
      >
    : Node;

type ConfigurationViews = QueryView | "mutation";

export type RuntimeConfiguration = Partial<
  Record<QueryView | "mutation", RuntimeViewConfiguration>
>;

type RuntimePolicyMap = Partial<Record<ConfigurationViews, RuntimeOptions>> & {
  readonly paths?: Readonly<Record<string, RuntimePolicyMap>>;
};

export type RuntimeNode = Record<string, unknown> & UtilityNode;
type RuntimeBuilder = (...args: unknown[]) => unknown;

export interface ConfigurationLayer {
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

const trackedLeaves = new WeakMap<
  RuntimeNode,
  {
    readonly base: RuntimeNode;
    readonly wrap: (node: RuntimeNode) => RuntimeNode;
  }
>();

export const registerLeafTracking = (
  tracked: RuntimeNode,
  base: RuntimeNode,
  wrap: (node: RuntimeNode) => RuntimeNode
): void => {
  trackedLeaves.set(tracked, { base, wrap });
};

export const readConfiguredLeaf = (node: RuntimeNode) =>
  configuredLeaves.get(node);

export const reapplyLeafConfiguration = (
  base: RuntimeNode,
  layers: readonly ConfigurationLayer[]
): RuntimeNode => {
  const tracking = trackedLeaves.get(base);
  const configured = configureLeaf(
    tracking?.base ?? base,
    scopeConfigurations(layers)
  );
  const result = Object.freeze(tracking?.wrap(configured) ?? configured);
  configuredLeaves.set(result, { original: base, layers });
  return result;
};

const isUtilityChild = (child: RuntimeNode[string]): child is RuntimeNode =>
  Predicate.hasProperty(child, "key") && Predicate.isFunction(child.key);

const views: readonly QueryView[] = [
  "query",
  "infinite",
  "metadata",
  "live",
  "streamed",
];
const configurationViews = [...views, "mutation"] as const;

const snapshotPolicy = (
  view: QueryView | "mutation",
  policy: RuntimeOptions
): RuntimeOptions => {
  const snapshot = { ...policy };
  const { sseOptions } = snapshot;
  if (
    (view === "live" || view === "streamed") &&
    Predicate.isObject(sseOptions)
  ) {
    const { maxEventSize, dispatchEmptyNamedEvents } = sseOptions;
    snapshot["sseOptions"] = Object.freeze({
      maxEventSize,
      dispatchEmptyNamedEvents,
    });
  }
  return Object.freeze(snapshot);
};

const queryOptions = new Set<string>([
  "_defaulted",
  "_optimisticResults",
  "_type",
  "behavior",
  "enabled",
  "gcTime",
  "meta",
  "networkMode",
  "notifyOnChangeProps",
  "persister",
  "refetchInterval",
  "refetchIntervalInBackground",
  "refetchOnMount",
  "refetchOnReconnect",
  "refetchOnWindowFocus",
  "retry",
  "retryDelay",
  "retryOnMount",
  "staleTime",
  "structuralSharing",
  "suspense",
  "throwOnError",
] satisfies readonly (keyof Omit<QueryObserverOptions, LocalQueryOption>)[]);
const mutationOptions = new Set<string>([
  "_defaulted",
  "gcTime",
  "meta",
  "networkMode",
  "onError",
  "onSettled",
  "onSuccess",
  "retry",
  "retryDelay",
  "scope",
  "throwOnError",
] satisfies readonly (keyof Omit<
  MutationObserverOptions,
  OwnedMutationOption | "onMutate"
>)[]);
const validateViewOption = (view: ConfigurationViews, name: string) => {
  const valid =
    name === "interceptors" ||
    (view === "mutation"
      ? name === "callbacks" || mutationOptions.has(name)
      : queryOptions.has(name) ||
        ((view === "streamed" || view === "live") &&
          isStreamPolicyOption(view, name)));
  if (!valid) {
    throw new TypeError(`Unknown ${view} configuration option: ${name}`);
  }
};

const snapshotView = (
  view: ConfigurationViews,
  entry: RuntimeOptions
): RuntimeViewConfiguration | undefined => {
  if (!Predicate.isObject(entry) || Array.isArray(entry)) {
    throw new TypeError(`${view} configuration must be an object`);
  }
  for (const name of Object.keys(entry)) {
    validateViewOption(view, name);
  }
  const { interceptors, callbacks, ...policy } = entry;
  if (
    interceptors !== undefined &&
    (!Array.isArray(interceptors) || !interceptors.every(Predicate.isFunction))
  ) {
    throw new TypeError(`${view} interceptors must be functions`);
  }
  if (
    callbacks !== undefined &&
    callbacks !== "replace" &&
    callbacks !== "compose"
  ) {
    throw new TypeError('Mutation callbacks must use "replace" or "compose"');
  }
  const hasPolicy = Object.keys(policy).length > 0;
  const hasInterceptors = interceptors !== undefined && interceptors.length > 0;
  if (!hasPolicy && !hasInterceptors && callbacks === undefined) {
    return undefined;
  }
  return Object.freeze({
    policy: hasPolicy ? snapshotPolicy(view, policy) : undefined,
    interceptors: hasInterceptors
      ? Object.freeze([...interceptors])
      : undefined,
    callbacks,
  });
};

const snapshotConfiguration = (
  configuration: RuntimePolicyMap,
  allowPaths: boolean
): RuntimeConfiguration | undefined => {
  if (!Predicate.isObject(configuration) || Array.isArray(configuration)) {
    throw new TypeError("Utility configuration must be an object");
  }
  for (const name of Object.keys(configuration)) {
    if (
      !(allowPaths && name === "paths") &&
      !configurationViews.some((view) => view === name)
    ) {
      throw new TypeError(`Unknown utility configuration option: ${name}`);
    }
  }
  let snapshot: RuntimeConfiguration | undefined;
  for (const view of configurationViews) {
    if (!Object.hasOwn(configuration, view)) {
      continue;
    }
    const entry = configuration[view];
    const policy = entry === undefined ? undefined : snapshotView(view, entry);
    if (policy !== undefined) {
      snapshot ??= {};
      snapshot[view] = policy;
    }
  }
  return snapshot === undefined ? undefined : Object.freeze(snapshot);
};

const scopeConfigurations = (
  layers: readonly ConfigurationLayer[]
): readonly RuntimeConfiguration[] => {
  const scopes = new Map<number, RuntimeConfiguration>();
  for (const { depth, options } of layers) {
    const scope = scopes.get(depth) ?? {};
    for (const view of configurationViews) {
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
  const streamPolicies: Partial<Record<"live" | "streamed", RuntimeOptions>> =
    {};
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
    if (view === "streamed" || view === "live") {
      streamPolicies[view] = policy;
      const streamedKey = node[view === "live" ? "liveKey" : "streamedKey"];
      if (!Predicate.isFunction(streamedKey)) {
        throw new TypeError("Streamed queries require a key builder");
      }
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
      const buildKey = streamedKey as RuntimeBuilder;
      configured[view === "live" ? "liveKey" : "streamedKey"] =
        inputKind(node.key) === "Inputless"
          ? (options?: Record<string, unknown>) => {
              if (options !== undefined && !Predicate.isObject(options)) {
                throw new TypeError("Query key options must be an object");
              }
              return buildKey({ ...policy, ...options });
            }
          : (options?: Record<string, unknown>) => {
              if (!Predicate.isObject(options)) {
                throw new TypeError("Query key options must be an object");
              }
              return buildKey({ ...policy, ...options });
            };
    }
  }
  const { queryFilter } = node;
  if (
    (streamPolicies.live !== undefined ||
      streamPolicies.streamed !== undefined) &&
    Predicate.isFunction(queryFilter)
  ) {
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
    const filter = queryFilter as RuntimeBuilder;
    configured["queryFilter"] = (options?: RuntimeOptions) =>
      filter(options, streamPolicies);
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

type ChildEntry =
  | {
      readonly kind: "branch";
      readonly name: string;
      readonly node: RuntimeNode;
    }
  | {
      readonly kind: "lazy";
      readonly name: string;
      readonly slot: LazyLeafSlot;
    };

const readChildEntry = (
  node: RuntimeNode,
  name: string
): ChildEntry | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(node, name);
  if (descriptor?.enumerable !== true) {
    return undefined;
  }
  const slot = readLazyLeafSlot(descriptor);
  if (slot !== undefined) {
    return { kind: "lazy", name, slot };
  }
  if ("value" in descriptor && isUtilityChild(descriptor.value)) {
    return { kind: "branch", name, node: descriptor.value };
  }
  return undefined;
};

const configureLeafNode = (
  node: RuntimeNode,
  configurations: readonly ConfigurationLayer[]
): RuntimeNode => {
  const previous = configuredLeaves.get(node);
  const original = previous?.original ?? node;
  const layers = EffectArray.sortWith(
    [...(previous?.layers ?? []), ...configurations],
    (layer) => layer.depth,
    Order.Number
  );
  return reapplyLeafConfiguration(original, layers);
};

interface ConfigurationPlan {
  options?: RuntimeConfiguration | undefined;
  readonly children: Map<string, ConfigurationPlan>;
}

const resolvePath = (
  node: RuntimeNode,
  path: string
): readonly (readonly string[])[] => {
  const matches: string[][] = [];
  if (readChildEntry(node, path) !== undefined) {
    matches.push([path]);
  }
  for (
    let dot = path.indexOf(".");
    dot !== -1;
    dot = path.indexOf(".", dot + 1)
  ) {
    const child = readChildEntry(node, path.slice(0, dot));
    if (child?.kind === "branch") {
      for (const tail of resolvePath(child.node, path.slice(dot + 1))) {
        matches.push([child.name, ...tail]);
      }
    }
  }
  return matches;
};

const planConfiguration = (
  node: RuntimeNode,
  configuration: RuntimePolicyMap
): ConfigurationPlan => {
  const leaf = configurationViews.some((view) =>
    Object.hasOwn(node, `${view}Options`)
  );
  const plan: ConfigurationPlan = {
    options: snapshotConfiguration(configuration, !leaf),
    children: new Map(),
  };
  const { paths } = configuration;
  if (paths === undefined) {
    return plan;
  }
  if (!Predicate.isObject(paths) || Array.isArray(paths)) {
    throw new TypeError("Utility paths must be an object");
  }
  for (const [path, settings] of Object.entries(paths)) {
    const [segments, ambiguous] = resolvePath(node, path);
    if (segments === undefined || ambiguous !== undefined) {
      throw new TypeError(
        `${ambiguous === undefined ? "Unknown" : "Ambiguous"} utility path: ${path}`
      );
    }
    const snapshot = snapshotConfiguration(settings, false);
    if (snapshot === undefined) {
      continue;
    }
    let target = plan;
    for (const segment of segments) {
      let child = target.children.get(segment);
      if (child === undefined) {
        child = { children: new Map() };
        target.children.set(segment, child);
      }
      target = child;
    }
    target.options = snapshot;
  }
  return plan;
};

const configureNode = (
  node: RuntimeNode,
  inherited: readonly ConfigurationLayer[],
  plan: ConfigurationPlan | undefined
): RuntimeNode => {
  const configurations =
    plan?.options === undefined
      ? inherited
      : [...inherited, { depth: node.key().length, options: plan.options }];
  const names =
    configurations.length === 0
      ? [...(plan?.children.keys() ?? [])]
      : Object.keys(node);
  if (names.length === 0) {
    return node;
  }
  if (
    configurationViews.some((view) => Object.hasOwn(node, `${view}Options`))
  ) {
    return configureLeafNode(node, configurations);
  }
  const replacements = new Map<string, PropertyDescriptor>();
  for (const name of names) {
    const entry = readChildEntry(node, name);
    if (entry === undefined) {
      continue;
    }
    const childPlan = plan?.children.get(name);
    if (entry.kind === "lazy") {
      const leafConfigurations =
        childPlan?.options === undefined
          ? configurations
          : [
              ...configurations,
              { depth: node.key().length + 1, options: childPlan.options },
            ];
      if (leafConfigurations.length > 0) {
        replacements.set(
          name,
          defineLazyLeafDescriptor(
            () =>
              configureLeafNode(entry.slot.materialize(), leafConfigurations),
            entry.slot.ownerToken
          )
        );
      }
    } else {
      const next = configureNode(entry.node, configurations, childPlan);
      if (next !== entry.node) {
        replacements.set(name, {
          value: next,
          enumerable: true,
          writable: false,
          configurable: false,
        });
      }
    }
  }
  return replacements.size === 0 ? node : buildBranchFrom(node, replacements);
};

/** Applies root, branch, and leaf configuration while preserving generated cache identity. */
export const configureUtils = <
  Node extends UtilityNode,
  const Configuration extends object,
>(
  tree: Node,
  configuration: CheckedConfiguration<Node, Configuration>
): ConfiguredUtils<Node, Configuration> => {
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const node = tree as RuntimeNode;
  const settings: object = configuration;
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  const options = settings as RuntimePolicyMap;
  const configured = configureNode(node, [], planConfiguration(node, options));
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
  return configured as ConfiguredUtils<Node, Configuration>;
};

export type CheckedConfiguration<Node, Configuration> = Configuration &
  NoInfer<UtilsConfiguration<Node>> &
  NoInfer<ExactConfiguration<Node, Configuration>>;
