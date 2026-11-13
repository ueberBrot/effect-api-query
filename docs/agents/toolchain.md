# Contributor compiler

Install with `pnpm install --frozen-lockfile`, using the pinned Node and pnpm versions. Preparation prints the selected engine. Development uses Effect-enhanced TSRS 0.21.0 targeting TypeScript 7.1 beta, distributed in `@effect/tsgo@0.67.3`. Its bundled standard libraries accompany the same compiler. TypeScript 5.9 remains the consumer minimum and JavaScript compiler API dependency; Astro uses its own supported compiler API.

Run `vp run typecheck`, `vp run effect-check`, and `vp run lint`. These select TSRS explicitly, including the type-aware lint backend, without patching node_modules. `vp run toolchain-check` verifies compiler identity and rejection of ordinary TypeScript, Effect correctness, and type-aware lint errors. `vp run pack` emits declarations with TSRS and validates them with ATTW and publint. `vp run api-types`, `vp run server-local-types`, `vp run framework-types`, and `vp run effect-compatibility` check the current engine and the minimum consumer compiler. Compiler measurements identify the engine package/version separately from its TypeScript language target.

## Editor

Editor extensions and language-server selection are contributor preferences. The repository does not install an editor SDK, force a language server, or route builds through editor files. Microsoft's [TypeScript 7 extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview) supports TSRS's protocol; optional setup follows the [upstream editor documentation](https://github.com/oxc-project/tsrs/blob/main/docs/LSP.md). Effect-specific diagnostics require an Effect-enhanced server. Avoid attaching multiple TypeScript servers to the same buffer.

Declaration production resolves the pinned native compiler from the installed Effect tooling package. `vp run toolchain-check` verifies that its version matches the command-line engine. The development container verifies the same command-line compiler after frozen installation; it does not configure an editor.

The compiler decision and dependency-age evidence are in [ADR 0035](../adr/0035-use-effect-enhanced-tsrs-for-development.md). Optional Fallow type analysis retains a transitive TypeScript 7.0.2 dependency; compiler tasks do not select it. Graphical editor behavior and Windows/container execution remain unverified. The packaged TSRS backend does not support Linux musl.
