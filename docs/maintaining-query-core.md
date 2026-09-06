# Maintain Query Core compatibility

Query Core's streamed-query interface is experimental. Check both types and runtime behavior when
updating the supported dependency versions.

1. Update the Query Core and React Query development catalog entries together and regenerate the
   lockfile.
2. Run the packed-package checks:

   ```sh
   vp run packed-package
   ```

   This installs isolated consumers at the lower bound and development version, compiles their
   contracts with the supported TypeScript compilers, and executes the generated builders.

3. Run the complete validation suite:

   ```sh
   vp run validate
   ```

Fix incompatibilities or narrow the peer range before publishing. Raise the major-version ceiling
only after these checks pass against the new major.
