# Tests are not type-checked by the gate (2026-09-30)

`packages/searchcast/tsconfig.json` includes only `src/**/*.ts`, and vitest strips types without checking them, so a type error in `packages/searchcast/test/` (for example a failing `expectTypeOf` assertion) never fails `pnpm format:check && pnpm build && pnpm test`. Seen while adding the type-level alias test of `rename-serpcast-to-searchcast`, which was checked by hand with `tsc --noEmit`. A `tsc --noEmit` over the tests (or vitest's `typecheck` mode) in the gate would close it.
