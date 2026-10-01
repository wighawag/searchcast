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
