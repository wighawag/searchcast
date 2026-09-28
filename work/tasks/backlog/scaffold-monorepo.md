---
title: Scaffold the serpcast pnpm monorepo (serpcast-recipe MIT + serpcast AGPL) with a green verify gate
slug: scaffold-monorepo
spec: serpcast
blockedBy: []
covers: []
---

## What to build

The empty-but-working monorepo every other task builds in: a pnpm workspace with two packages, `serpcast-recipe` and `serpcast`, each building with `tsc` and testing with vitest, formatted with prettier, so `pnpm format:check && pnpm build && pnpm test` (the `verify` in `dorfl.json`) passes on a fresh clone after `pnpm install`. Each package exports one trivial placeholder and has one test, so the gate proves something runs. Add a CI workflow that runs the same gate on push and pull request. Add the repo's README (what serpcast is, the two packages, the per-module LOC table webveil keeps, empty for now) and a CONTEXT.md with the domain vocabulary (recipe, declarative recipe, code recipe, browser engine, engine chain, transport, impersonation target, header table, request kind, strict mode, state store, session, cooldown, typed errors `blocked`/`recipe`/`timeout`/`transport`/`impersonation`/`exhausted`).

## Acceptance criteria

- [ ] `pnpm install && pnpm format:check && pnpm build && pnpm test` passes from a clean clone.
- [ ] `packages/serpcast-recipe/package.json` has `"license": "MIT"`, `"type": "module"`, no runtime dependencies, and an MIT `LICENSE` file in the package directory (copyright wighawag).
- [ ] `packages/serpcast/package.json` has `"license": "AGPL-3.0-only"`, `"type": "module"`, a `serpcast` bin entry (a stub that prints usage is fine), and depends on `serpcast-recipe` via `workspace:*`.
- [ ] Both packages are ESM, NodeNext, strict TypeScript, emit `.d.ts`, and set `files`/`exports` so only built output ships.
- [ ] Root `package.json` is private, has `format`, `format:check`, `build`, `test` scripts, and prettier config matches webveil (tabs, single quotes, no bracket spacing).
- [ ] A CI workflow runs the verify gate on push and pull request (Node 24, pnpm).
- [ ] README and CONTEXT.md exist as described; no em dash characters in any file.
- [ ] Tests cover the placeholder exports.

## Blocked by

- None, can start immediately.

## Prompt

Goal: scaffold the serpcast monorepo so later tasks only add code. Read `work/specs/tasked/serpcast.md` (problem, solution, user stories) and `docs/adr/0001`..`0003` for context. Mirror the layout and tooling of webveil (https://github.com/wighawag/webveil: pnpm workspace, `packages/*`, root tsconfig base, vitest, prettier config, `dorfl.json` verify gate), and searchcast (https://github.com/wighawag/searchcast) for the CI `test.yml`. Do not add the release workflow or changesets config; that is the separate `release-workflow-oidc` task. Keep versions at `0.0.0` (both names are reserved on npm at 0.0.0).

FIRST, check this task against current reality (it is a launch snapshot and may have drifted). If the repo already has a different structure, do not overwrite it; route the task to needs-attention with the discrepancy.

RECORD non-obvious in-scope decisions (ADR if it meets `work/protocol/ADR-FORMAT.md`'s gate, otherwise a note linked from the done record).
