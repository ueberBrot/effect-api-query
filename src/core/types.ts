import type {
  DataTag,
  InfiniteData,
  InfiniteQueryObserverOptions,
  InitialDataFunction,
  MutationObserverOptions,
  NonUndefinedGuard,
  QueryFunction,
  QueryKey,
  QueryObserverOptions,
  SkipToken,
} from "@tanstack/query-core";
import type { Effect, Exit, Redacted } from "effect";

import type { PreparedInput } from "./prepared-input";

export type JsonPrimitive = boolean | null | number | string;

/** An immutable JSON value accepted in cache keys. */
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type QueryData<A> = undefined extends A
  ? Exclude<A, undefined | void> | null
  : A;

/** Runs an Effect and returns its Exit, optionally forwarding an abort signal. */
export type RunPromiseExit<R = never> = <A, E>(
  effect: Effect.Effect<A, E, R>,
  options?: { readonly signal?: AbortSignal }
) => Promise<Exit.Exit<A, E>>;

/** Requires encoders only when eligible requests need an override. */
export type KeyEncoderRequirement<Eligible, Required, Encoders> = [
  Eligible,
] extends [never]
  ? { readonly keyEncoders?: never }
  : [Required] extends [never]
    ? {
        /** Overrides synchronous semantic encoding for selected requests. */
        readonly keyEncoders?: Encoders;
      }
    : {
        /** Supplies safe synchronous cache identity for requests requiring an encoder. */
        readonly keyEncoders: Encoders;
      };

/** Requires a custom runner when client-side Schema services remain. */
export type RunnerRequirement<Services> = [Services] extends [never]
  ? {
      /** Overrides service-free execution; defaults to `Effect.runPromiseExit`. */
      readonly runPromiseExit?: RunPromiseExit;
    }
  : {
      /** Runs Effects that retain client-side Schema services. */
      readonly runPromiseExit: RunPromiseExit<Services>;
    };

/** Uses the adapter's inputless proof to determine key-builder arguments. */
export type KeyBuilder<Input, Key, Inputless extends boolean> = [
  Inputless,
] extends [true]
  ? () => Key
  : (input: Input | PreparedInput<Input>) => Key;

export type OwnedQueryOption =
  | "queryFn"
  | "queryKey"
  | "queryKeyHashFn"
  | "queryHash";
export type OwnedMutationOption = "mutationFn" | "mutationKey";

export type StreamRefetchMode = "append" | "replace" | "reset";

export type StreamedPolicyOptions = {
  /** Controls whether a refetch clears, appends to, or replaces accumulated data. */
  readonly refetchMode?: StreamRefetchMode | undefined;
  /** Retains at most this many newest elements; must be a positive safe integer. */
  readonly maxChunks?: number | undefined;
  /** Publishes the first element immediately, then ordered batches; defaults to one. */
  readonly publicationBatchSize?: number | undefined;
  /** Flushes a partial batch after this many milliseconds; omitted means count-only. */
  readonly publicationMaxWaitMs?: number | undefined;
};

export type WithDefinedInitialData<Options, Data> = Omit<
  Options,
  "initialData"
> & {
  readonly initialData:
    | NonUndefinedGuard<Data>
    | (() => NonUndefinedGuard<Data>);
};

export type WithUndefinedInitialData<Options, Data> = Omit<
  Options,
  "initialData"
> & {
  readonly initialData?:
    | undefined
    | InitialDataFunction<NonUndefinedGuard<Data>>
    | NonUndefinedGuard<Data>;
};

export type QueryInput<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  AdapterOptions = unknown,
> = Omit<
  QueryObserverOptions<Data, Error, Selected, Data, Key>,
  OwnedQueryOption
> &
  AdapterOptions;

export type QueryOptions<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  Fn = QueryFunction<Data>,
> = QueryInput<Data, Error, Selected, Key> & {
  readonly queryFn: Fn;
  readonly queryKey: Key;
};

export type ConditionalQueryOptions<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
> = QueryOptions<Data, Error, Selected, Key, QueryFunction<Data> | SkipToken>;

export type InputQueryOptions<
  Input,
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
> = unknown extends Input
  ? ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>
  : [Input] extends [SkipToken]
    ? QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>
    : SkipToken extends Input
      ? ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>
      : QueryOptions<Data, Error, Selected, Key>;

export type ExactBuilderOptions<Expected, Supplied> = Expected &
  Supplied & {
    readonly [
      Key in Exclude<
        keyof Supplied,
        keyof Expected | typeof uninferredBuilderOptions
      >
    ]: string extends Key
      ? Supplied[Key]
      : number extends Key
        ? Supplied[Key]
        : never;
  };

export type SuppliedInitialData<Supplied> = "initialData" extends keyof Supplied
  ? undefined extends Supplied["initialData"]
    ? Omit<Supplied, "initialData"> & {
        readonly initialData?: Exclude<Supplied["initialData"], undefined>;
      }
    : Supplied
  : Supplied;

declare const uninferredBuilderOptions: unique symbol;
export interface UninferredBuilderOptions {
  readonly [uninferredBuilderOptions]?: never;
}

export type RetainedQueryOptions<Options> = Pick<
  Options,
  Extract<
    keyof Options,
    | "queryFn"
    | "queryKey"
    | "select"
    | "retry"
    | "retryDelay"
    | "initialPageParam"
    | "getNextPageParam"
  >
>;

export type SuppliedQueryOptions<Options, Supplied, AdapterOptions> =
  typeof uninferredBuilderOptions extends keyof Supplied
    ? Options
    : RetainedQueryOptions<Options> &
        Omit<SuppliedInitialData<Supplied>, "input" | keyof AdapterOptions>;

export interface InputQueryBuilder<
  Input,
  Data,
  Error,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
  AdapterOptions,
> {
  <
    Selected = Data,
    ActualInput extends Input = Input,
    Supplied extends object = UninferredBuilderOptions,
  >(
    options: ExactBuilderOptions<
      WithDefinedInitialData<
        QueryInput<
          Data,
          Error,
          Selected,
          InputQueryOptions<
            ActualInput,
            Data,
            Error,
            Selected,
            Key,
            SkippedKey
          >["queryKey"],
          AdapterOptions
        >,
        Data
      > & { readonly input: ActualInput },
      Supplied
    >
  ): WithDefinedInitialData<
    SuppliedQueryOptions<
      InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>,
      Supplied,
      AdapterOptions
    >,
    Data
  >;
  <
    Selected = Data,
    ActualInput extends Input = Input,
    Supplied extends object = UninferredBuilderOptions,
  >(
    options: ExactBuilderOptions<
      WithUndefinedInitialData<
        QueryInput<
          Data,
          Error,
          Selected,
          InputQueryOptions<
            ActualInput,
            Data,
            Error,
            Selected,
            Key,
            SkippedKey
          >["queryKey"],
          AdapterOptions
        >,
        Data
      > & { readonly input: ActualInput },
      Supplied
    >
  ): SuppliedQueryOptions<
    InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>,
    Supplied,
    AdapterOptions
  >;
}

export type UnaryQueryBuilder<
  Input,
  Data,
  Error,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
  AdapterOptions = unknown,
  Inputless extends boolean = void extends Input ? true : false,
> = UnaryQueryBuilderImpl<
  Input | PreparedInput<Input>,
  Data,
  Error,
  Key,
  SkippedKey,
  AdapterOptions,
  Inputless
>;

export type UnaryQueryBuilderImpl<
  Input,
  Data,
  Error,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
  AdapterOptions = unknown,
  Inputless extends boolean = void extends Input ? true : false,
> = Inputless extends true
  ? {
      <Selected = Data>(
        options?: undefined
      ): RetainedQueryOptions<QueryOptions<Data, Error, Selected, Key>>;
      <Selected = Data, Supplied extends object = UninferredBuilderOptions>(
        options: ExactBuilderOptions<
          WithDefinedInitialData<
            QueryInput<Data, Error, Selected, Key, AdapterOptions>,
            Data
          >,
          Supplied
        >
      ): WithDefinedInitialData<
        SuppliedQueryOptions<
          QueryOptions<Data, Error, Selected, Key>,
          Supplied,
          AdapterOptions
        >,
        Data
      >;
      <Selected = Data, Supplied extends object = UninferredBuilderOptions>(
        options?: ExactBuilderOptions<
          WithUndefinedInitialData<
            QueryInput<Data, Error, Selected, Key, AdapterOptions>,
            Data
          >,
          Supplied
        >
      ): SuppliedQueryOptions<
        QueryOptions<Data, Error, Selected, Key>,
        Supplied,
        AdapterOptions
      >;
    }
  : InputQueryBuilder<SkipToken, Data, Error, Key, SkippedKey, AdapterOptions> &
      InputQueryBuilder<Input, Data, Error, Key, SkippedKey, AdapterOptions> & {
        <Selected = Data, Supplied extends object = UninferredBuilderOptions>(
          options: ExactBuilderOptions<
            WithDefinedInitialData<
              Omit<
                ConditionalQueryOptions<
                  Data,
                  Error,
                  Selected,
                  Key | SkippedKey
                >,
                OwnedQueryOption
              >,
              Data
            > &
              AdapterOptions & { readonly input: Input | SkipToken },
            Supplied
          >
        ): WithDefinedInitialData<
          SuppliedQueryOptions<
            ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>,
            Supplied,
            AdapterOptions
          >,
          Data
        >;
        <Selected = Data, Supplied extends object = UninferredBuilderOptions>(
          options: ExactBuilderOptions<
            WithUndefinedInitialData<
              Omit<
                ConditionalQueryOptions<
                  Data,
                  Error,
                  Selected,
                  Key | SkippedKey
                >,
                OwnedQueryOption
              >,
              Data
            > &
              AdapterOptions & { readonly input: Input | SkipToken },
            Supplied
          >
        ): SuppliedQueryOptions<
          ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>,
          Supplied,
          AdapterOptions
        >;
      };

export type InfiniteInput<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  PageParam,
  AdapterOptions = unknown,
> = Omit<
  InfiniteQueryObserverOptions<Data, Error, Selected, Key, PageParam>,
  OwnedQueryOption
> &
  AdapterOptions;

export type InfiniteOptions<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  PageParam,
  Fn = QueryFunction<Data, QueryKey, PageParam>,
> = InfiniteInput<Data, Error, Selected, Key, PageParam> & {
  readonly queryFn: Fn;
  readonly queryKey: Key;
};

export type InfiniteQueryKey<
  Input,
  Data,
  Error,
  OperationKey extends readonly JsonValue[],
  PageParam = unknown,
  Inputless extends boolean = void extends Input ? true : false,
> = DataTag<
  Inputless extends true ? OperationKey : readonly [...OperationKey, JsonValue],
  InfiniteData<Data, PageParam>,
  Error
>;

export type MappedInfiniteInput<
  Input,
  Data,
  Error,
  OperationKey extends readonly JsonValue[],
  Selected,
  PageParam,
  AdapterOptions,
  Inputless extends boolean,
> = InfiniteInput<
  Data,
  Error,
  Selected,
  InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam, Inputless>,
  PageParam,
  AdapterOptions
> &
  (Inputless extends true
    ? unknown
    : { readonly input: (pageParam: PageParam) => Input });

export type ConditionalInfiniteOptions<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  PageParam,
> = InfiniteOptions<
  Data,
  Error,
  Selected,
  Key,
  PageParam,
  QueryFunction<Data, QueryKey, PageParam> | SkipToken
>;

export type InfiniteQueryBuilder<
  Input,
  Data,
  Error,
  OperationKey extends readonly JsonValue[],
  AdapterOptions = unknown,
  Inputless extends boolean = void extends Input ? true : false,
> = {
  <
    PageParam,
    Selected = InfiniteData<Data, PageParam>,
    Supplied extends object = UninferredBuilderOptions,
  >(
    options: ExactBuilderOptions<
      WithDefinedInitialData<
        MappedInfiniteInput<
          Input,
          Data,
          Error,
          OperationKey,
          Selected,
          PageParam,
          AdapterOptions,
          Inputless
        >,
        InfiniteData<Data, PageParam>
      >,
      Supplied
    >
  ): WithDefinedInitialData<
    SuppliedQueryOptions<
      InfiniteOptions<
        Data,
        Error,
        Selected,
        InfiniteQueryKey<
          Input,
          Data,
          Error,
          OperationKey,
          PageParam,
          Inputless
        >,
        PageParam
      >,
      Supplied,
      AdapterOptions
    >,
    InfiniteData<Data, PageParam>
  >;
  <
    PageParam,
    Selected = InfiniteData<Data, PageParam>,
    Supplied extends object = UninferredBuilderOptions,
  >(
    options: ExactBuilderOptions<
      WithUndefinedInitialData<
        MappedInfiniteInput<
          Input,
          Data,
          Error,
          OperationKey,
          Selected,
          PageParam,
          AdapterOptions,
          Inputless
        >,
        InfiniteData<Data, PageParam>
      >,
      Supplied
    >
  ): SuppliedQueryOptions<
    InfiniteOptions<
      Data,
      Error,
      Selected,
      InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam, Inputless>,
      PageParam
    >,
    Supplied,
    AdapterOptions
  >;
} & (Inputless extends true
  ? unknown
  : {
      <
        PageParam,
        Selected = InfiniteData<Data, PageParam>,
        Supplied extends object = UninferredBuilderOptions,
      >(
        options: ExactBuilderOptions<
          WithDefinedInitialData<
            InfiniteInput<
              Data,
              Error,
              Selected,
              OperationKey,
              PageParam,
              AdapterOptions
            >,
            InfiniteData<Data, PageParam>
          > & { readonly input: SkipToken },
          Supplied
        >
      ): WithDefinedInitialData<
        SuppliedQueryOptions<
          InfiniteOptions<
            Data,
            Error,
            Selected,
            OperationKey,
            PageParam,
            SkipToken
          >,
          Supplied,
          AdapterOptions
        >,
        InfiniteData<Data, PageParam>
      >;
      <
        PageParam,
        Selected = InfiniteData<Data, PageParam>,
        Supplied extends object = UninferredBuilderOptions,
      >(
        options: ExactBuilderOptions<
          WithUndefinedInitialData<
            InfiniteInput<
              Data,
              Error,
              Selected,
              OperationKey,
              PageParam,
              AdapterOptions
            >,
            InfiniteData<Data, PageParam>
          > & { readonly input: SkipToken },
          Supplied
        >
      ): SuppliedQueryOptions<
        InfiniteOptions<
          Data,
          Error,
          Selected,
          OperationKey,
          PageParam,
          SkipToken
        >,
        Supplied,
        AdapterOptions
      >;
      <
        PageParam,
        Selected = InfiniteData<Data, PageParam>,
        Supplied extends object = UninferredBuilderOptions,
      >(
        options: ExactBuilderOptions<
          WithDefinedInitialData<
            InfiniteInput<
              Data,
              Error,
              Selected,
              | InfiniteQueryKey<
                  Input,
                  Data,
                  Error,
                  OperationKey,
                  PageParam,
                  Inputless
                >
              | OperationKey,
              PageParam,
              AdapterOptions
            >,
            InfiniteData<Data, PageParam>
          > & { readonly input: ((pageParam: PageParam) => Input) | SkipToken },
          Supplied
        >
      ): WithDefinedInitialData<
        SuppliedQueryOptions<
          ConditionalInfiniteOptions<
            Data,
            Error,
            Selected,
            | InfiniteQueryKey<
                Input,
                Data,
                Error,
                OperationKey,
                PageParam,
                Inputless
              >
            | OperationKey,
            PageParam
          >,
          Supplied,
          AdapterOptions
        >,
        InfiniteData<Data, PageParam>
      >;
      <
        PageParam,
        Selected = InfiniteData<Data, PageParam>,
        Supplied extends object = UninferredBuilderOptions,
      >(
        options: ExactBuilderOptions<
          WithUndefinedInitialData<
            InfiniteInput<
              Data,
              Error,
              Selected,
              | InfiniteQueryKey<
                  Input,
                  Data,
                  Error,
                  OperationKey,
                  PageParam,
                  Inputless
                >
              | OperationKey,
              PageParam,
              AdapterOptions
            >,
            InfiniteData<Data, PageParam>
          > & { readonly input: ((pageParam: PageParam) => Input) | SkipToken },
          Supplied
        >
      ): SuppliedQueryOptions<
        ConditionalInfiniteOptions<
          Data,
          Error,
          Selected,
          | InfiniteQueryKey<
              Input,
              Data,
              Error,
              OperationKey,
              PageParam,
              Inputless
            >
          | OperationKey,
          PageParam
        >,
        Supplied,
        AdapterOptions
      >;
    });

export type MutationOptions<
  Data,
  Error,
  Input,
  Key extends QueryKey,
  OnMutateResult,
> = Omit<
  MutationObserverOptions<Data, Error, Input, OnMutateResult>,
  OwnedMutationOption
> & {
  readonly mutationFn: (variables: Input) => Promise<Data>;
  readonly mutationKey: Key;
};

export type MutationBuilder<
  Data,
  Error,
  Input,
  Key extends QueryKey,
  AdapterOptions = unknown,
> = <OnMutateResult = unknown>(
  options?: Omit<
    MutationObserverOptions<Data, Error, Input, OnMutateResult>,
    OwnedMutationOption
  > &
    AdapterOptions
) => MutationOptions<Data, Error, Input, Key, OnMutateResult>;

export type HasSeenType<A, Seen> = Seen extends unknown
  ? (<T>() => T extends A ? 1 : 2) extends <T>() => T extends Seen ? 1 : 2
    ? true
    : false
  : never;

export type ContainsRedacted<A, Seen = never> =
  A extends Redacted.Redacted<unknown>
    ? true
    : true extends HasSeenType<A, Seen>
      ? false
      : A extends readonly (infer Value)[]
        ? ContainsRedacted<Value, Seen | A>
        : A extends object
          ? true extends {
              readonly [Key in keyof A]: ContainsRedacted<A[Key], Seen | A>;
            }[keyof A]
            ? true
            : false
          : false;
