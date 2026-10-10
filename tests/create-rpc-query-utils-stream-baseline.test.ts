import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { QueryClient } from '@tanstack/query-core'
import {
  Array as EffectArray,
  Config,
  ConfigProvider,
  Crypto,
  Effect,
  FileSystem,
  Option,
  Path,
  Predicate,
  Schema,
  Stream,
} from 'effect'
import { Hex } from 'effect/encoding'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
import { afterAll } from 'vitest'

import { createRpcQueryUtils } from '#effect-api-query'

const SampleSchema = Schema.Struct({
  version: Schema.Finite,
  reading: Schema.Struct({ unit: Schema.Literal('items'), value: Schema.Finite }),
  labels: Schema.Array(Schema.String),
})
type Sample = typeof SampleSchema.Type
type Value = number | Sample
type Data = Value | null | readonly Value[]
const Watch = Rpc.make('samples.watch', {
  payload: { workload: Schema.Literals(['numbers', 'objects']) },
  success: Schema.Union([Schema.Finite, SampleSchema]),
  stream: true,
})
const group = RpcGroup.make(Watch)
const values = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((value) => Array.from({ length: 8 }, () => value))

const modes = [
  { view: 'unlimited', maxChunks: undefined },
  { view: 'bounded-4', maxChunks: 4 },
  { view: 'bounded-16', maxChunks: 16 },
  { view: 'live', maxChunks: undefined },
] as const
const cases = (['numbers', 'objects'] as const).flatMap((workload) =>
  modes.flatMap((mode) =>
    ([true, false] as const).map((structuralSharing) => ({ workload, ...mode, structuralSharing })),
  ),
)
type Case = (typeof cases)[number]

const retainedValues = (data: Data | undefined): readonly Value[] => {
  if (data === undefined || data === null) {
    return []
  }
  return EffectArray.isArray<Data>(data) ? data : [data]
}

const versionOf = (value: Value) => (Predicate.isNumber(value) ? value : value.version)

const observedObjects = () => {
  const samples = new WeakSet<Sample>()
  const readings = new WeakSet<Sample['reading']>()
  const labels = new WeakSet<Sample['labels']>()
  let sampleReferences = 0
  let readingReferences = 0
  let labelArrayReferences = 0
  const observe = (data: Data | undefined) => {
    for (const value of retainedValues(data)) {
      if (!Predicate.isNumber(value)) {
        if (!samples.has(value)) {
          samples.add(value)
          sampleReferences += 1
        }
        if (!readings.has(value.reading)) {
          readings.add(value.reading)
          readingReferences += 1
        }
        if (!labels.has(value.labels)) {
          labels.add(value.labels)
          labelArrayReferences += 1
        }
      }
    }
  }
  return {
    observe,
    result: () => ({ sampleReferences, readingReferences, labelArrayReferences }),
  }
}

const measure = Effect.fnUntraced(function* (scenario: Case) {
  let sourceEmissions = 0
  let finalized = false
  const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(
      group.toLayer({
        'samples.watch': ({ workload }) =>
          Stream.fromIterable(values).pipe(
            Stream.map((version): Value => {
              sourceEmissions += 1
              return workload === 'numbers'
                ? version
                : {
                    version,
                    reading: { unit: 'items', value: version },
                    labels: ['west', 'current'],
                  }
            }),
            Stream.ensuring(
              Effect.sync(() => {
                finalized = true
              }),
            ),
          ),
      }),
    ),
  )
  const queryClient = new QueryClient()
  const leaf = createRpcQueryUtils(group, {
    client,
    keyPrefix: ['stream-baseline'],
  }).samples.watch
  const input = { workload: scenario.workload }
  const queryKey =
    scenario.view === 'live'
      ? leaf.liveKey(input)
      : leaf.streamedKey(input, { maxChunks: scenario.maxChunks })
  const objects = observedObjects()
  let cacheNotifications = 0
  let cacheUpdates = 0
  let dataWrites = 0
  let manualDataWrites = 0
  let fetchCompletionWrites = 0
  let dataReferenceChanges = 0
  let publishedArrayReferences = 0
  let changedReferenceElementSlots = 0
  let dataWriteElementSlots = 0
  let maxRetainedValues = 0
  let previous: Data | undefined
  let firstPublication: Data | undefined
  const arrays = new WeakSet<readonly Value[]>()
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    cacheNotifications += 1
    if (event.type === 'updated') {
      cacheUpdates += 1
      if (event.action.type === 'success') {
        dataWrites += 1
        if (event.action.manual === true) {
          manualDataWrites += 1
        } else {
          fetchCompletionWrites += 1
        }
        const current = queryClient.getQueryData<Data>(queryKey)
        firstPublication ??= current
        const retained = retainedValues(current).length
        dataWriteElementSlots += retained
        maxRetainedValues = Math.max(maxRetainedValues, retained)
        if (!Object.is(previous, current)) {
          dataReferenceChanges += 1
          changedReferenceElementSlots += retained
          if (EffectArray.isArray<Data | undefined>(current) && !arrays.has(current)) {
            arrays.add(current)
            publishedArrayReferences += 1
          }
        }
        objects.observe(current)
        previous = current
      }
    }
  })
  try {
    const data = yield* Effect.promise(async () =>
      scenario.view === 'live'
        ? await queryClient.query(
            leaf.liveOptions({ input, structuralSharing: scenario.structuralSharing }),
          )
        : await queryClient.query(
            leaf.streamedOptions({
              input,
              maxChunks: scenario.maxChunks,
              structuralSharing: scenario.structuralSharing,
            }),
          ),
    )
    const retained = retainedValues(data)
    return {
      ...scenario,
      data,
      sourceEmissions,
      finalized,
      cacheNotifications,
      cacheUpdates,
      dataWrites,
      manualDataWrites,
      fetchCompletionWrites,
      dataReferenceChanges,
      lifecycleUpdates: cacheUpdates - dataWrites,
      equalReferenceWrites: dataWrites - dataReferenceChanges,
      publishedArrayReferences,
      changedReferenceElementSlots,
      dataWriteElementSlots,
      maxRetainedValues,
      retainedValues: retained.length,
      retainedVersions: retained.map(versionOf),
      firstPublicationVersions: retainedValues(firstPublication).map(versionOf),
      ...objects.result(),
      retainedSampleReferences: new Set(retained.filter((value) => !Predicate.isNumber(value)))
        .size,
    }
  } finally {
    unsubscribe()
    queryClient.clear()
  }
})

const baselineCase = {
  workload: 'numbers',
  view: 'bounded-4',
  maxChunks: 4,
  structuralSharing: true,
} as const

const manifestVersion = Effect.fnUntraced(function* (name: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const manifest = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
  )(
    yield* fs.readFileString(
      yield* path.fromFileUrl(new URL(`../node_modules/${name}/package.json`, import.meta.url)),
    ),
  )
  return manifest.version
})

const context = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const crypto = yield* Crypto.Crypto
  const directory = yield* path.fromFileUrl(new URL('../src/', import.meta.url))
  const sources = (yield* fs.readDirectory(directory, { recursive: true }))
    .filter((source) => source.endsWith('.ts'))
    .sort((left, right) => left.localeCompare(right))
  const parts: Uint8Array[] = []
  for (const source of sources) {
    parts.push(new TextEncoder().encode(source), yield* fs.readFile(path.join(directory, source)))
  }
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    effect: yield* manifestVersion('effect'),
    queryCore: yield* manifestVersion('@tanstack/query-core'),
    vitest: yield* manifestVersion('vitest'),
    sourceSha256: Hex.encode(yield* crypto.digest('SHA-256', bytes)),
    fixtureSha256: Hex.encode(
      yield* crypto.digest(
        'SHA-256',
        yield* fs.readFile(yield* path.fromFileUrl(new URL(import.meta.url))),
      ),
    ),
    readyClient: 'RpcTest.makeClient, in-memory no-serialization, default stream buffer',
    execution: 'fresh QueryClient, finite initial fetch, default reset policy, no observers',
    workload: '64 emissions: versions 0 through 7, each repeated eight times',
  }
})

const reports: Omit<Effect.Success<ReturnType<typeof measure>>, 'data'>[] = []

describe('stream baseline', () => {
  afterAll(async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const output = Option.getOrUndefined(
          yield* Config.String('STREAM_MEASURE')
            .pipe(Config.option)
            .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
        )
        if (output !== undefined && output !== '') {
          const fs = yield* FileSystem.FileSystem
          yield* fs.writeFileString(
            output,
            `${JSON.stringify({ context: yield* context(), measurements: reports }, null, 2)}\n`,
          )
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    )
  })
  it.live('separates cache data writes from fetch lifecycle updates', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const measurement = yield* measure(baselineCase)
        expect(measurement.data).toStrictEqual([7, 7, 7, 7])
        expect(measurement.lifecycleUpdates).toBeGreaterThan(0)
        expect(measurement.dataWrites).toBeLessThan(measurement.cacheUpdates)
      }),
    ),
  )
  it.live('does not treat structurally equal history writes as new data references', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const measurement = yield* measure(baselineCase)
        expect(measurement.dataReferenceChanges).toBeLessThan(measurement.dataWrites)
      }),
    ),
  )
  it.live.each(cases)('$workload $view structuralSharing=$structuralSharing', (scenario) =>
    Effect.scoped(
      Effect.gen(function* () {
        const measurement = yield* measure(scenario)
        let expected = values
        if (scenario.view === 'live') {
          expected = [7]
        } else if (scenario.maxChunks === 4) {
          expected = [7, 7, 7, 7]
        } else if (scenario.maxChunks === 16) {
          expected = [6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7]
        }
        expect(measurement.retainedVersions).toStrictEqual(expected)
        expect(measurement.firstPublicationVersions).toStrictEqual([0])
        expect(measurement.sourceEmissions).toBe(64)
        expect(measurement.finalized).toBe(true)
        expect(measurement.maxRetainedValues).toBe(expected.length)
        expect(measurement.dataReferenceChanges).toBeLessThanOrEqual(measurement.dataWrites)
        expect(measurement.lifecycleUpdates).toBeGreaterThan(0)
        if (
          Option.isSome(
            yield* Config.String('STREAM_MEASURE')
              .pipe(Config.option)
              .parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
          )
        ) {
          const { data: _data, ...report } = measurement
          reports.push(report)
        }
      }),
    ),
  )
})
