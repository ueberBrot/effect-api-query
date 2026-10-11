# Changesets

If a pull request changes the published package's runtime behavior, types, exports, or peer or runtime dependency ranges, add a non-empty Changeset.
Changes to metadata that affects installation also require a non-empty Changeset:

```sh
vp run changeset
```

Choose the pre-1.0 version bump and describe the change that consumers see.
The version workflow uses Vite+'s Oxfmt task to format generated changelogs and manifests.
If changes to `src/**` or the root `package.json` can require a Changeset, the Changeset Bot leaves an advisory pull-request comment.

Documentation, examples, tests, internal tooling, and CI do not require a Changeset.
Explain an intentional omission during review. Do not add an empty Changeset as a process marker.

Only the root `effect-api-query` package is versioned and published. The private example workspace
packages remain unversioned.
