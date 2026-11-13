# Contributor compiler

Install with `pnpm install --frozen-lockfile`, using the pinned Node and pnpm versions. Preparation prints the selected engine. Development uses Effect-enhanced TSRS 0.21.0 targeting TypeScript 7.1 beta, distributed in `@effect/tsgo@0.67.3`. Its bundled standard libraries accompany the same compiler. TypeScript 5.9 remains the consumer minimum and JavaScript compiler API dependency; Astro uses its own supported compiler API.

Run `vp run typecheck`, `vp run effect-check`, and `vp run lint`. These select TSRS explicitly, including the type-aware lint backend, without patching node_modules. `vp run toolchain-check` verifies compiler identity and rejection of ordinary TypeScript, Effect correctness, and type-aware lint errors. `vp run pack` emits declarations with TSRS and validates them with ATTW and publint. `vp run api-types`, `vp run server-local-types`, `vp run framework-types`, and `vp run effect-compatibility` check the current engine and the minimum consumer compiler. Compiler measurements identify the engine package/version separately from its TypeScript language target.

## Editor

Use the workspace settings with VS Code's TypeScript 7 support. The selected SDK directory is `.vscode/tsdk`; its `tsgo` launcher forwards to the exact Effect-enhanced TSRS version. Select the workspace SDK if prompted. Keep this as the only server for ordinary TypeScript buffers; disable separately installed TypeScript/Effect language-server extensions that would also attach. Framework component servers can retain their framework-specific roles.

Check the TypeScript server output for the workspace launcher and run `.vscode/tsdk/tsgo --version` to identify its compiler. Open a TypeScript buffer, introduce an unsaved number-to-string assignment, and verify a diagnostic; check hover and definition on `Effect.succeed`, and select its expression to request an Effect refactor such as “Wrap with Effect.gen”. A clean command-line check is insufficient evidence for these editor features.

The development container uses the same frozen installation and workspace SDK settings. Local validation covers macOS arm64 LSP protocol initialization, unsaved buffers, diagnostics, hover, definition, and Effect actions. A graphical VS Code session, Windows, Linux, and a running development container require separate validation. The packaged TSRS backend does not support Linux musl.

The compiler decision and dependency-age evidence are in [ADR 0035](../adr/0035-use-effect-enhanced-tsrs-for-development.md). The retained TypeScript 7.0.2 transitive dependency belongs to optional Fallow type analysis; it is not selected by compiler tasks.
