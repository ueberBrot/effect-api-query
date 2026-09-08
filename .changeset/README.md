# Changesets

Add a non-empty Changeset when a pull request changes the published package's runtime behavior, types,
exports, peer or runtime dependency ranges, or metadata that affects installation:

```sh
vp run changeset
```

Choose the pre-1.0 bump deliberately and describe the consumer-visible change. The version workflow
formats generated changelogs and manifests through Vite+'s Oxfmt task, and the Changeset Bot leaves
an advisory pull-request comment when changes to `src/**` or the root `package.json` may need a Changeset.

Documentation, examples, tests, internal tooling, and CI do not require a Changeset. Do not add an
empty Changeset as a process marker; explain an intentional omission during review instead.

Only the root `effect-api-query` package is versioned and published. The private example workspace
packages remain unversioned.
