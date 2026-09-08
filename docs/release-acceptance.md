# Verify the initial release candidate

This one-time checklist covers acceptance of the initial release candidate in
[#73](https://github.com/ueberBrot/effect-api-query/issues/73) before the human publication work in
[#19](https://github.com/ueberBrot/effect-api-query/issues/19).
The [parent specification](https://github.com/ueberBrot/effect-api-query/issues/1) defines the delivery
contract. Keep run-specific evidence in the issue so it identifies the exact tested commit.

## Run the acceptance checks

Commit the candidate, then run:

```sh
vp run validate
DOCS_BASE_URL=https://ueberbrot.github.io vp run docs-e2e
```

The completed one-time artifact rehearsal is recorded in
[#73's acceptance evidence](https://github.com/ueberBrot/effect-api-query/issues/73#issuecomment-5569401718).
Production version-plan generation, account configuration, and publication remain in #19.

The package verifier prints the archive's SHA-512 digest, version, file inventory, peer cases, and
compiler cases after validation. Record that identity with the candidate SHA and workflow links.
When checking an existing release archive, pass its path through `EFFECT_API_QUERY_TARBALL`;
the verifier tests that archive and checks that its bytes remain unchanged.

## Audit the delivery contract

| Contract area                                                                                 | Repository evidence                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eager trees, atomic validation, paths, semantic RPC keys, custom encoders                     | `tests/create-rpc-query-utils*.test.ts`, `tests/types/public-contract.ts`                                                                                   |
| RPC execution, errors, options, skipping, pagination, request options                         | RPC execution/request-options suites, packed runtime and public-contract fixtures                                                                           |
| Accumulated streamed queries, bounds, refetch modes, live queries, cleanup                    | `tests/create-rpc-query-utils-streaming.test.ts`, packed runtime/type fixtures                                                                              |
| Buffered HTTP selection, request identity, errors, services, middleware, cancellation         | `tests/create-http-api-query-utils.test.ts`, `http-semantic-keys.test.ts`, `http-execution.test.ts`, `http-transport-cancellation.test.ts`                  |
| HTTP conditional queries, pagination, inference, cache access                                 | `tests/http-query-options.test.ts`, `tests/types/http-contract.ts`, `tests/packed-consumer/http-runtime.mts`                                                |
| One ESM root, external peers, public exports, compiler compatibility, both type-scale cases   | `scripts/verify-packed-consumer.mts`, `tests/packed-consumer/`, `tests/types/*type-scale.ts`                                                                |
| Shared domain behavior, both applications, explicit cross-adapter invalidation, commands      | `examples/contracts/`, `examples/server/`, application tests, `e2e/`                                                                                        |
| Start request ownership, SSR, hydration, navigation, request isolation                        | Start application tests and cross-browser `e2e/` cases                                                                                                      |
| Tutorials, bounded support matrix, application-owned behavior, links and generated agent text | `apps/docs/`, `scripts/verify-docs-examples.mts`, `e2e-docs/docs.spec.ts`                                                                                   |
| Shared private modules and protocol decisions                                                 | `CONTEXT.md`, `docs/adr/0021-share-utility-construction-through-private-modules.md`, `docs/adr/0022-add-buffered-http-utilities-with-separate-key-roots.md` |
| Current package identity and hosted cutover                                                   | Package metadata checks, hosted documentation suite, closed #71/#72 evidence                                                                                |

Inspect each closed extension ticket #61 through #72 against its merged PR and evidence. Audit GitHub
issue dependencies separately from parent membership: every extension ticket belongs to #1, #73 reaches
every implementation ticket through closed blockers, and #73 blocks #19. Preserve #19's earlier
closed dependencies. Check the complete dependency graph for cycles. The deferred browser sandbox
experiment in #33 remains a recorded deferral.

## Record the handoff

Attach the exact candidate SHA, successful validation and dry-run workflow links, artifact digest,
compiler/peer matrix, local and hosted browser results, and dependency audit to #73.
Check only acceptance criteria supported by that evidence. Keep #1 and #19 open.

The release workflow passes the verified artifact ID directly to publication. Its publication job
does not rebuild the package. #19 owns npm name control, the trusted publisher for
`ueberBrot/effect-api-query` / `.github/workflows/release.yml` / `npm`, any first-publication bootstrap,
the final version merge, and independent npm/provenance verification.
