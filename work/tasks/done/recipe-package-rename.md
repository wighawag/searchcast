---
title: serpcast-recipe becomes @searchcast/recipe
slug: recipe-package-rename
spec: searchcast-monorepo
blockedBy: []
covers: [10, 16]
---

## What to build

`packages/recipe` (today `serpcast-recipe` 0.2.0) is published as `@searchcast/recipe`: MIT, zero runtime dependencies, same two entries (`.` and `./node`), same exports, same behaviour and exactly the same error messages. Every importer in the workspace (`packages/searchcast`, `packages/browser`) imports `@searchcast/recipe` / `@searchcast/recipe/node` instead of `serpcast-recipe`, through a `workspace:^` dependency (the browser package today pulls `serpcast-recipe ^0.1.0` from npm; it must use the workspace package now).

Package metadata: name `@searchcast/recipe`, `version` set to `0.0.0` (the reserved npm version; the changeset takes it to 0.1.0), `repository.url` `git+https://github.com/wighawag/searchcast.git` with `directory: packages/recipe`, homepage and bugs on the searchcast repo, `publishConfig.access: public`, keywords without `serpcast`. `packageName` export becomes `'@searchcast/recipe'`. Its README: the new name and install line, links to the searchcast repo, a short "Formerly `serpcast-recipe`" note (same format, same API). Its CHANGELOG keeps the serpcast-recipe history under a line saying the entries below were released as `serpcast-recipe`. Comments that call the package `serpcast-recipe` or the runners serpcast/searchcast are updated to `@searchcast/recipe`, `searchcast` (HTTP) and `@searchcast/browser`.

A changeset: `@searchcast/recipe` minor ("first release under the new name; identical to serpcast-recipe 0.2.0"). The `serpcast` package directory still has its old name and version until the rename task; only its dependency and imports change here, with no changeset for it.

## Acceptance criteria

- [ ] No `serpcast-recipe` import, dependency or lockfile entry remains in the workspace (docs and `work/` history excepted).
- [ ] `@searchcast/recipe` has no `dependencies`, license MIT, its own LICENSE file, and the same exports as before (a test compares the export list and `packageName`).
- [ ] Every existing recipe test passes unchanged apart from the package name; all three packages build and test green.
- [ ] `pnpm --filter @searchcast/recipe pack --dry-run` (or `npm pack --dry-run` in the directory) lists only `dist`, README, LICENSE, package.json, CHANGELOG.
- [ ] One changeset (minor, `@searchcast/recipe`).

## Blocked by

- None, can start immediately.

## Prompt

Goal: the first rename of ADR 0005, the shared schema package. It must stay a pure rename: if anything in its meaning or messages would change, stop and route to needs-attention.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions (in the PR description's `## Decisions` or a `work/notes/observations/` note).

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- Read ADR 0005 (`docs/adr/0005-*`) first: it is the rename table this task implements a part of. ADRs 0001 to 0004 still hold for the mechanics (read "serpcast" there as `searchcast`).
- Do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia example under `examples/` is the one owner-approved exception.
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
