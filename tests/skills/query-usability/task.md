Build a dashboard integration using the installed effect-api-query package and its usage skill. Work only in the disposable consumer directory.

Implement `dashboard` in `solution.ts`, using the types supplied by `fixture.ts`. Return:

- `read`: a leaf for `rpc.users.read` with a one-second freshness default. Every successful query execution calls `audit` with its returned number. Local freshness options must still override the default.
- `refresh`: an async function that invalidates ordinary queries under `rpc.users`, including nested leaves, without invalidating live stream entries.
- `watch`: options for `rpc.users.watch` that publish the first event immediately and flush later ordered events when ten accumulate or after fifty milliseconds.

Keep the original utility tree unchanged and preserve builder inference. Do not change the contract or fixture. Do not inspect the authoring repository or grading files. Load the installed package guidance through Intent before implementation. Report the guidance loaded, commands run, and any limitations.
