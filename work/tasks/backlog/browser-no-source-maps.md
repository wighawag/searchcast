---
title: @searchcast/browser ships no source maps (it ships no sources), and the pack check refuses maps
slug: browser-no-source-maps
spec: searchcast-monorepo
blockedBy: []
covers: [16]
---

## What to build

`packages/browser/tsconfig.json` does not extend `tsconfig.base.json` and sets `sourceMap` and `declarationMap`, so the `@searchcast/browser` tarball carries about 20 `dist/*.map` files pointing at `src/`, which it does not ship (observation `work/notes/observations/2026-09-30-browser-ships-source-maps-without-sources.md`). The owner decided (2026-09-30): fix it before the first release. Make `packages/browser/tsconfig.json` extend `../../tsconfig.base.json` like the other packages, keeping only what it genuinely needs on top (its `lib` includes `dom` and `dom.iterable` because page-side code is type-checked; keep that if the build needs it), with no source or declaration maps. Then tighten `scripts/pack-check.mjs` so `.map` files are no longer accepted in any package's `dist` (the `DIST_FILES` pattern), with a test that a `.map` in a tarball fails the check. Delete the observation note (it is resolved) in the same change.

Changeset: none needed if the pending `@searchcast/browser` minor already covers the first release (a patch changeset on top would still plan 0.1.0; decide and record). The release-plan check must still report searchcast 0.2.0, @searchcast/browser 0.1.0, @searchcast/recipe 0.1.0 and the platform packages at 0.1.0.

## Acceptance criteria

- [ ] `pnpm --filter @searchcast/browser build` emits no `.map` files; the package still builds and every browser and serve test passes (CI, no skips).
- [ ] The pack check refuses a `.map` in any tarball (tested) and passes on the tree.
- [ ] The observation note is removed; the release plan is unchanged.

## Blocked by

- None, can start immediately.

## Prompt

Goal: the published tarball contains nothing that points at files it does not contain. Small, mechanical change; do not touch anything else in the browser package.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- Read ADR 0005 (`docs/adr/0005-*`) first: it is the rename table this task implements a part of. ADRs 0001 to 0004 still hold for the mechanics (read "serpcast" there as `searchcast`).
- Do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia example under `examples/` is the one owner-approved exception.
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
