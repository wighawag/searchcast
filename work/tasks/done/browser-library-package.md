---
title: The browser runner becomes the library @searchcast/browser, with its CLI as an exported function
slug: browser-library-package
spec: searchcast-monorepo
blockedBy: [recipe-package-rename]
covers: [9, 16]
---

## What to build

`packages/browser` (today npm `searchcast` 0.1.2, the real-browser runner) is published as `@searchcast/browser`, a library with NO bin (the `searchcast` bin belongs to the HTTP package after the next task). Its main entry exports exactly what `searchcast` 0.1.2 exported (`Searchcast`, `SearchcastError`, `Browser`, `Page`, `findChrome`, `CdpConnection`, `startXvfb`, `createSearchcastServer`, the recipe re-exports, and their types), unchanged. Its API names are NOT renamed (ADR 0005).

Its CLI becomes an exported function on a `./cli` subpath (for example `runCli(argv: string[]): Promise<void>`), taking the same arguments the 0.1.2 bin took after `node cli.js` (`serve ...` and `query ...`), with byte-identical flags, defaults, usage text (except the one line naming the query command, see below), stderr messages (`searchcast: ...`), exit codes (2 on a usage error), signal handling, `--listen systemd` (fd 3, `LISTEN_FDS`/`LISTEN_PID` checks before anything starts), `--idle-exit`, `--xvfb`, `--ephemeral` cleanup. The only difference: the one-shot query is spelled `browser-query` in the usage text, because the `searchcast` bin will route `searchcast browser-query ...` to it (`searchcast query` becomes the HTTP query). The function must not call `process.exit` on success paths it did not call it on before, and must not be executed on import.

Until the `searchcast` bin delegates to it (task `searchcast-serve-command`), the end-to-end CLI tests spawn a tiny test-only launcher (a file under `test/` that imports the built `./cli` entry and calls it with `process.argv.slice(2)`), so every existing CLI case keeps running in CI with Chrome: TCP, Unix socket with ephemeral profile and idle exit, no-loopback namespace, `--listen systemd` refusal and socket activation, xvfb, and the SearXNG engine.

Package metadata: name `@searchcast/browser`, `version` `0.0.0` (reserved on npm; the changeset takes it to 0.1.0), no `bin`, no `packageManager`, no local `release`/`prepublishOnly`/`changeset:check` scripts (the root owns releasing), `exports` for `.` and `./cli`, `files` = `dist` (plus README, LICENSE), `dependencies` `@searchcast/recipe` `workspace:^`, repository/homepage/bugs on the searchcast repo with `directory: packages/browser`, license AGPL-3.0-only with a LICENSE file in the package (copied at pack time like `packages/searchcast` does, or committed; decide and record). The SearXNG engine file stays where it is in this task (it moves to the `searchcast` package with the serve command).

README of the package: a library README (what it is, `new Searchcast({...})`, the recipe format pointer to `@searchcast/recipe`, the `./cli` entry used by `searchcast serve`, "formerly the `searchcast` package 0.1.x; the CLI is now `searchcast serve` from the `searchcast` package"). Its CHANGELOG keeps the 0.1.x history under a line saying those versions were released as `searchcast`.

The HTTP package's browser engines (library mode) import `@searchcast/browser` instead of `searchcast`: the optional peer dependency becomes `@searchcast/browser` (range `>=0.1.0 <0.2.0` or `workspace:^`; decide and record), the missing-module error names `@searchcast/browser` with its install line, and the `SearchcastModule` seam keeps working. Endpoint mode is unchanged.

Changesets: `@searchcast/browser` minor (first release under the new name, library only, CLI moved). No changeset for the HTTP package here (its rename task writes the 0.2.0 entry and should mention the peer change; leave a note in the PR description).

## Acceptance criteria

- [ ] `@searchcast/browser` exports the same names as `searchcast` 0.1.2 (a test lists them) plus the `./cli` entry; no bin.
- [ ] Every CLI test case that existed runs through the new launcher, unchanged in what it asserts (only the launcher path and the `browser-query` spelling change).
- [ ] The HTTP package's library-mode browser engine tests pass importing `@searchcast/browser`; its missing-peer test asserts the new package name.
- [ ] No workspace package is named `searchcast` except, after the next task, the HTTP one: after this task no package is named `searchcast` at all (the HTTP one is still `serpcast`).
- [ ] Pack dry-run of `@searchcast/browser` shows `dist`, README, LICENSE, CHANGELOG, package.json only.
- [ ] One changeset (minor, `@searchcast/browser`).

## Blocked by

- recipe-package-rename

## Prompt

Goal: the browser runner becomes a library other packages build on, without changing one byte of `serve`'s behaviour, because systemd units and a SearXNG integration run it in production (see the systemd section of the package README). Read `packages/browser/src/cli.ts`, `packages/browser/test/cli.test.ts` and `packages/searchcast/src/browser.ts`.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- Read ADR 0005 (`docs/adr/0005-*`) first: it is the rename table this task implements a part of. ADRs 0001 to 0004 still hold for the mechanics (read "serpcast" there as `searchcast`).
- Do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia example under `examples/` is the one owner-approved exception.
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
