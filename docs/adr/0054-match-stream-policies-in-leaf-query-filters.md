# Match stream policies in leaf query filters

Status: Accepted. Partially amends [ADR 0051](0051-colocate-query-filters-on-utility-trees.md).

Streaming leaves accept view policy options in `queryFilter` as specified in [#216](https://github.com/ueberBrot/effect-api-query/issues/216). When a caller supplies a policy option, match the complete stream identity from the key builder, including configured defaults and SSE decoder settings. Require `maxChunks` for accumulated identity when configuration supplies no retention. With input omitted, a prefix filter can match that policy across inputs. Native `exact` still requires the full key.

Callers can omit policy options to retain ADR 0051's broad prefix match. Compare the complete policy segment because native partial matching would also accept policies with extra options.
