import {
  createContractHydrationRegistry,
  createHydrationRegistry,
  createRpcQueryUtils,
  queryViewCodec,
} from "@ueberbrot/effect-api-query";
import type {
  HydrationRegistry,
  RuntimeInput,
} from "@ueberbrot/effect-api-query";
import { Context, Effect, Schema } from "effect";
import { Sse } from "effect/encoding";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

import { Profile } from "./docs-hydration-rich.ts";
import { Cursor } from "./docs-hydration-views.ts";

type Assert<Condition extends true> = Condition;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

class DecA extends Context.Service<DecA, { readonly a: number }>()("DecA") {}
class EncA extends Context.Service<EncA, { readonly a: number }>()("EncA") {}
class DecB extends Context.Service<DecB, { readonly b: number }>()("DecB") {}
class EncB extends Context.Service<EncB, { readonly b: number }>()("EncB") {}
class DecHdr extends Context.Service<DecHdr, { readonly h: number }>()(
  "DecHdr"
) {}
class EncHdr extends Context.Service<EncHdr, { readonly h: number }>()(
  "EncHdr"
) {}
class ErrSvc extends Context.Service<ErrSvc, { readonly e: number }>()(
  "ErrSvc"
) {}
class PageParamSvc extends Context.Service<
  PageParamSvc,
  { readonly p: number }
>()("PageParamSvc") {}

const ServiceProfileA = Profile.pipe(
  Schema.middlewareDecoding((decode) => DecA.pipe(Effect.andThen(decode))),
  Schema.middlewareEncoding((encode) => EncA.pipe(Effect.andThen(encode)))
);

const ServiceStringB = Schema.String.pipe(
  Schema.middlewareDecoding((decode) => DecB.pipe(Effect.andThen(decode))),
  Schema.middlewareEncoding((encode) => EncB.pipe(Effect.andThen(encode)))
);

const ServiceHeaders = Schema.Struct({
  "x-id": Schema.String.pipe(
    Schema.middlewareDecoding((decode) => DecHdr.pipe(Effect.andThen(decode))),
    Schema.middlewareEncoding((encode) => EncHdr.pipe(Effect.andThen(encode)))
  ),
});

const TransportError = Schema.String.pipe(
  Schema.middlewareDecoding((decode) => ErrSvc.pipe(Effect.andThen(decode))),
  Schema.middlewareEncoding((encode) => ErrSvc.pipe(Effect.andThen(encode)))
);

const ServiceCursor = Cursor.pipe(
  Schema.middlewareDecoding((decode) =>
    PageParamSvc.pipe(Effect.andThen(decode))
  )
);

const rpcGroup = RpcGroup.make(
  Rpc.make("users.read", {
    payload: { id: Schema.Int },
    success: ServiceProfileA,
  }),
  Rpc.make("users.optional", { success: Schema.UndefinedOr(Profile) }),
  Rpc.make("events.watch", {
    success: ServiceStringB,
    error: TransportError,
    stream: true,
  })
);

const rpcBare = createContractHydrationRegistry(rpcGroup);
type _RpcBareServices = Assert<
  Equal<typeof rpcBare, HydrationRegistry<DecA | DecB, EncA | EncB>>
>;

const rpcDisabledPath = createContractHydrationRegistry(rpcGroup, {
  paths: {
    "users.read": false,
  },
});
type _RpcDisabledPathServices = Assert<
  Equal<typeof rpcDisabledPath, HydrationRegistry<DecB, EncB>>
>;

declare const eitherRpcPath:
  | { readonly "users.read": false }
  | { readonly "events.watch": false };
const rpcAlternativePaths = createContractHydrationRegistry(rpcGroup, {
  paths: eitherRpcPath,
});
type _RpcAlternativePathServices = Assert<
  Equal<typeof rpcAlternativePaths, HydrationRegistry<DecA | DecB, EncA | EncB>>
>;

// @ts-expect-error An explicit options type requires an options argument.
createContractHydrationRegistry<typeof rpcGroup, { views: { query: false } }>(
  rpcGroup
);

// @ts-expect-error A codec for one literal cannot encode every string in the view.
createContractHydrationRegistry(rpcGroup, {
  paths: { "events.watch": { live: Schema.Literal("event") } },
});

const rpcViewsDisabled = createContractHydrationRegistry(rpcGroup, {
  views: { live: false, streamed: false },
});
type _RpcViewsDisabledServices = Assert<
  Equal<typeof rpcViewsDisabled, HydrationRegistry<DecA, EncA>>
>;

const rpcOverriddenWithInfinite = createContractHydrationRegistry(rpcGroup, {
  keyPrefix: ["app"],
  paths: {
    "users.read": {
      query: Profile,
      infinite: { pageParam: ServiceCursor },
    },
    "events.watch": {
      live: Schema.String,
      streamed: false,
    },
  },
});
type _RpcOverriddenServices = Assert<
  Equal<
    typeof rpcOverriddenWithInfinite,
    HydrationRegistry<PageParamSvc, never>
  >
>;

const rpcQueryDisabledInfinite = createContractHydrationRegistry(rpcGroup, {
  paths: {
    "users.read": {
      query: false,
      infinite: { pageParam: Cursor },
    },
    "events.watch": false,
  },
});
type _RpcQueryDisabledInfiniteServices = Assert<
  Equal<typeof rpcQueryDisabledInfinite, HydrationRegistry<DecA, EncA>>
>;

// @ts-expect-error keyPrefix rejects empty tuple
createContractHydrationRegistry(rpcGroup, {
  keyPrefix: [],
});

// @ts-expect-error keyPrefix rejects mutable string[]
createContractHydrationRegistry(rpcGroup, {
  keyPrefix: ["app"] as string[],
});

// @ts-expect-error keyPrefix rejects explicit undefined
createContractHydrationRegistry(rpcGroup, {
  keyPrefix: undefined,
});

// @ts-expect-error RPC views omits metadata
createContractHydrationRegistry(rpcGroup, {
  views: { metadata: false },
});

// @ts-expect-error Unknown view key is rejected
createContractHydrationRegistry(rpcGroup, {
  views: { queryy: false },
});

// @ts-expect-error Unknown RPC path is rejected
createContractHydrationRegistry(rpcGroup, {
  paths: {
    "users.unknown": false,
  },
});

// @ts-expect-error ADR 0012 normalizes undefined to null
createContractHydrationRegistry(rpcGroup, {
  paths: {
    "users.optional": {
      query: Schema.UndefinedOr(Profile),
    },
  },
});

// @ts-expect-error Streaming RPC cannot register infinite
createContractHydrationRegistry(rpcGroup, {
  paths: {
    "events.watch": {
      infinite: { pageParam: Cursor },
    },
  },
});

// @ts-expect-error Infinite config requires pageParam
createContractHydrationRegistry(rpcGroup, {
  paths: {
    "users.read": {
      infinite: { page: Profile },
    },
  },
});

createContractHydrationRegistry(rpcGroup, {
  paths: {
    "users.optional": {
      query: Schema.NullOr(Profile),
    },
  },
});

const CustomSseEvent = Schema.Struct({
  ...Sse.EventEncoded.fields,
  event: Schema.Literal("update"),
  data: Schema.fromJsonString(Schema.toCodecJson(ServiceStringB)),
});

const httpApi = HttpApi.make("types-http")
  .add(
    HttpApiGroup.make("root", { topLevel: true }).add(
      HttpApiEndpoint.get("health", "/health", {
        success: HttpApiSchema.NoContent,
      })
    )
  )
  .add(
    HttpApiGroup.make("data").add(
      HttpApiEndpoint.get("profile", "/profile", { success: ServiceProfileA }),
      HttpApiEndpoint.get("sseData", "/sse-data", {
        success: HttpApiSchema.WithHeaders(
          HttpApiSchema.StreamSse({
            data: ServiceStringB,
            error: TransportError,
          }),
          ServiceHeaders
        ),
      }),
      HttpApiEndpoint.get("sseEvents", "/sse-events", {
        success: HttpApiSchema.StreamSse({
          events: CustomSseEvent,
          error: TransportError,
        }),
      }),
      HttpApiEndpoint.get("ndjson", "/ndjson", {
        success: HttpApiSchema.StreamNdjson({ schema: ServiceStringB }),
      })
    )
  );

const httpBare = createContractHydrationRegistry(httpApi);
type _HttpBareServices = Assert<
  Equal<
    typeof httpBare,
    HydrationRegistry<DecA | DecB | DecHdr, EncA | EncB | EncHdr>
  >
>;

declare const eitherHttpPath:
  | { readonly "data.profile": false }
  | { readonly "data.sseData": false };
const httpAlternativePaths = createContractHydrationRegistry(httpApi, {
  paths: eitherHttpPath,
});
type _HttpAlternativePathServices = Assert<
  Equal<typeof httpAlternativePaths, typeof httpBare>
>;

const httpQueryInheritMetadata = createContractHydrationRegistry(httpApi, {
  views: { live: false, streamed: false },
  paths: {
    "data.profile": {
      query: Profile,
    },
  },
});
type _HttpQueryInheritServices = Assert<
  Equal<typeof httpQueryInheritMetadata, HydrationRegistry<never, never>>
>;

// @ts-expect-error Unknown HTTP views key is rejected
createContractHydrationRegistry(httpApi, { views: { metadtaa: false } });

// @ts-expect-error Unknown HTTP path is rejected
createContractHydrationRegistry(httpApi, { paths: { "data.missing": false } });

declare const maybeOptions:
  | {
      readonly paths?: {
        readonly "users.read"?: {
          readonly query?: typeof Profile;
        };
      };
    }
  | undefined;

const optionalSound = createContractHydrationRegistry(rpcGroup, maybeOptions);
type _OptionalSoundServices = Assert<
  Equal<typeof optionalSound, HydrationRegistry<DecA | DecB, EncA | EncB>>
>;

declare const flatClient: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof rpcGroup>
>;
declare const rpcRuntime: RuntimeInput<DecA | DecB | ErrSvc>;
const rpcUtils = createRpcQueryUtils(rpcGroup, {
  client: flatClient,
  keyPrefix: ["manual"],
  runtime: rpcRuntime,
});
const manualCodec = queryViewCodec(
  rpcUtils.users.read,
  "query",
  ServiceProfileA
);
const composed = createHydrationRegistry([
  rpcDisabledPath,
  httpQueryInheritMetadata,
  manualCodec,
]);
type _ComposedServices = Assert<
  Equal<typeof composed, HydrationRegistry<DecA | DecB, EncA | EncB>>
>;

void [
  rpcBare,
  rpcDisabledPath,
  rpcViewsDisabled,
  rpcOverriddenWithInfinite,
  rpcQueryDisabledInfinite,
  httpBare,
  httpQueryInheritMetadata,
  optionalSound,
  composed,
];
