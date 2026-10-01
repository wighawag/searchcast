---
title: The gate type-checks every package's tests
slug: typecheck-tests
blockedBy: []
covers: []
---

## What to build

Observation `work/notes/observations/2026-09-30-tests-not-type-checked.md`: each package's `tsconfig.json` includes only `src/`, and vitest strips types without checking, so a type error in a test (a failing `expectTypeOf` included) never fails `pnpm format:check && pnpm build && pnpm test`. Add a type check of the tests to every package with tests (`recipe`, `browser`, `searchcast`): for example a `tsconfig.test.json` per package (extends the package config, `noEmit`, includes `src` and `test`) and a `typecheck` script run by the root `test` (so `verify` in `dorfl.json` and CI run it with no workflow change). Fix every type error it reveals in tests (never by `any`-casting a real check away; a `@ts-expect-error` is fine where a test deliberately passes a wrong type, with a comment). Prove it bites: a test or script check that a deliberately wrong `expectTypeOf` fails the type check. Delete the observation note.

## Acceptance criteria

- [ ] A type error in any package's test fails `pnpm test` (proved).
- [ ] The tree type-checks clean; CI green, no-skip guard green.
- [ ] The observation note is removed.

## Blocked by

- None, can start immediately.

## Prompt

Goal: the type-level tests (deprecated aliases, recipe types) actually guard something. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- No package version edits; no changeset unless a published package's content changes (state it in the PR if none).
- Security properties and every existing test stay unchanged in strength.
- Public repo: no real search engine named (placeholders), except the owner-approved Marginalia and Mwmbl examples.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.

## Decisions

1. **`rootDir` is the repo root (`../..`) in every `tsconfig.test.json`.** Why: `searchcast`'s `serve.test.ts` imports `packages/browser/test/fixture.ts`, which is outside the package. The alternatives were rearranging the test helpers, or using this setting only in `searchcast`; I kept the three configs identical. It only affects the test check, since the build configs are unchanged and nothing is emitted. This is recorded in the header comment of each `tsconfig.test.json`.
2. **The type check is its own `typecheck` step, not vitest's built-in type-check mode.** Why: it's plain `tsc`, as the task suggested, and it fails fast before any test runs. The alternative was vitest's mode, which would also have changed how the "no skipped tests" check reads the test reports. This is recorded in the header comment of `test/typecheck.test.ts`.
3. **The fixture is written to a temporary folder inside `packages/searchcast`, outside `test/`.** Why: from there `vitest` and `../src` resolve exactly as they do for real tests, and a leftover folder can never be picked up by the `test/**` check. The alternative, the system temp folder, can't resolve those imports. This is recorded in a comment in `test/typecheck.test.ts` and in `.gitignore`.
