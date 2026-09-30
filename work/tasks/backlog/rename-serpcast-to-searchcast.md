---
title: The serpcast package becomes searchcast 0.2.0 (name, bin, API, env, data directory, docs)
slug: rename-serpcast-to-searchcast
spec: searchcast-monorepo
blockedBy: [browser-library-package]
covers: [1, 2, 3, 4, 5, 14, 16, 17, 18]
---

## What to build

`packages/searchcast` (today npm `serpcast` 0.6.0) is published as `searchcast`, the successor of `searchcast` 0.1.2 (the browser runner, now `@searchcast/browser`). Everything serpcast did keeps working under the new names, with the one-release fallbacks of ADR 0005.

1. **Package.** name `searchcast`; `version` set to `0.1.2` (the one allowed version edit in this whole spec: it is the npm lineage of the name, so the minor changeset yields 0.2.0); bin `searchcast` (no `serpcast` bin); exports `.` and `./install` as today; repository/homepage/bugs on the searchcast repo with `directory: packages/searchcast`; keywords without `serpcast`. The prepack README/LICENSE copy script points its GitHub links at `wighawag/searchcast` and pins them to the `searchcast@<version>` tag.
2. **API.** `SerpcastError` -> `SearchcastError`, `SerpcastErrorKind` -> `SearchcastErrorKind`, `createSerpcast` -> `createSearchcast`, `Serpcast` -> `Searchcast`, `SerpcastOptions` -> `SearchcastOptions`, and any other exported name containing `Serpcast`. The old names stay exported as `@deprecated` aliases (same values, same types, `instanceof` still works) for one release, and a test pins that. `packageName` is `'searchcast'`. User-facing strings (CLI usage, error prefixes `searchcast: ...`, doctor lines, install messages, the `how to fix` hints) say `searchcast`. The state-store key `serpcast/sessions` is NOT renamed (ADR 0005).
3. **Library path.** Lookup order: `libcurlPath` option, `SEARCHCAST_LIBCURL_PATH`, `SERPCAST_LIBCURL_PATH`, `LIBCURL_PATH`, the data directory (new, then old). `LibrarySource` gains the new values; `doctor` names the source, and when the old env name or old data directory is used it says so with the new name to use. Hints mention `SEARCHCAST_LIBCURL_PATH`.
4. **Data directory.** `dataDir()` is `$XDG_DATA_HOME/searchcast` (default `~/.local/share/searchcast`); writers (`install-libcurl`, `install-recipes`) write only there. Readers fall back to `$XDG_DATA_HOME/serpcast` when the new location lacks the item: the library file, and recipe sets (a set name found in the new directory wins; otherwise the old directory's set of that name is used; `recipes list` shows both with their location). `doctor` reports an old-directory hit and prints the exact `mv` command the user can run; nothing ever moves files. Export whatever the embedder (webveil) needs to show the same notice (for example the old directory's path).
5. **Tests.** Test-only env names become `SEARCHCAST_TEST_*` (update `test.yml`, which also sets `SEARCHCAST_LIBCURL_PATH` now). New tests with temp `XDG_DATA_HOME` (asserting the real one is untouched): new-env-wins-over-old, old env still read, old data dir used when new is missing and reported by doctor, writers write only to the new dir, recipe-set fallback and precedence.
6. **Docs.** The root README becomes the monorepo's README for `searchcast`: what it is, the packages table (`searchcast`, `@searchcast/browser`, `@searchcast/recipe`, and the platform packages to come), "Upgrading from serpcast" (install `searchcast`, renamed API with aliases, env and data dir fallbacks and the `mv` command, `serpcast` is deprecated) and "Upgrading from searchcast 0.1.x" (the browser library is now `@searchcast/browser`; `serve` stays on the `searchcast` bin, added by the next task; mention it as coming in the same release). CONTEXT.md uses the new names. ADRs 0001 to 0004 and every file under `work/notes/findings/` get ONE added line at the top pointing to ADR 0005 (their text is otherwise untouched). Real engine names leave the README, the package CHANGELOG, code comments and tests (placeholders); `work/` history is left as is.
7. **Changeset.** `searchcast` minor, whose text states the break clearly: "searchcast 0.2.0 is serpcast renamed. It replaces the browser runner published as searchcast 0.1.x, which is now @searchcast/browser; `searchcast serve` keeps its flags and behaviour. Users of serpcast: ...". The package CHANGELOG keeps serpcast's history under a line saying those versions were released as `serpcast`.

## Acceptance criteria

- [ ] The workspace has one package named `searchcast` (this one), version 0.1.2 in the source, bin `searchcast`, and a pending minor changeset.
- [ ] New API names exported; old names exported as deprecated aliases; a test covers both.
- [ ] Library lookup order as above, each step tested with injected env and temp dirs; doctor names the source and flags old names and the old data dir, with the `mv` command.
- [ ] Writers never write to the old data directory; nothing moves user files (tested).
- [ ] Security tests unchanged in strength: strict mode refuses without libcurl-impersonate, the main entry reaches no download code, install-libcurl and install-recipes checksum and archive validation.
- [ ] README, CONTEXT.md, ADR notes, findings notes as above; no real engine named outside `work/` and the Marginalia example.
- [ ] CI env names updated; the gate is green.

## Blocked by

- browser-library-package

## Prompt

Goal: the main rename of ADR 0005. It is mostly mechanical; the care is in the fallbacks (read old, write new, say so, never move) and in not weakening any security test while renaming. Read `packages/searchcast/src/libcurl.ts`, `doctor.ts`, `recipes.ts`, `install.ts`, `install-recipes.ts`, `index.ts`, `errors.ts`, and `scripts/copy-publish-assets.mjs`.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- Read ADR 0005 (`docs/adr/0005-*`) first: it is the rename table this task implements a part of. ADRs 0001 to 0004 still hold for the mechanics (read "serpcast" there as `searchcast`).
- Apart from the one version edit named above, do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia example under `examples/` is the one owner-approved exception.
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
