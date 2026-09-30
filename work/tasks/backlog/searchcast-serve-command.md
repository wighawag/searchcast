---
title: searchcast serve and browser-query, delegating to @searchcast/browser; the SearXNG engine ships in searchcast
slug: searchcast-serve-command
spec: searchcast-monorepo
blockedBy: [rename-serpcast-to-searchcast]
covers: [6, 7, 8, 15]
---

## What to build

The `searchcast` bin gains `serve` and `browser-query`. Both delegate to `@searchcast/browser`'s `./cli` entry (task `browser-library-package`) with the arguments unchanged, so `searchcast serve ...` behaves exactly as `searchcast serve ...` did in 0.1.2: same flags, defaults, messages, exit codes, `--listen host:port|/path.sock|systemd`, `--idle-exit`, `--xvfb`, `--ephemeral`, `--profile`, `--proxy`, `--headless`, `--concurrency`, `--chrome-arg=`. `browser-query` is 0.1.2's `searchcast query` (browser one-shot).

- `@searchcast/browser` is an OPTIONAL peer dependency of `searchcast` (it already is, since `browser-library-package`), imported lazily and only for these two commands. When it is missing, the command exits non-zero with one clear line naming the package and the install command (`npm install -g @searchcast/browser` next to `searchcast`). Decide and record the exit code.
- `serve` and `browser-query` must not load koffi or the libcurl library (a machine running only the browser server needs neither to work); prove it with a test.
- `searchcast --help` lists every command, including these two with a pointer to the flags (`searchcast serve --help` prints the browser CLI's usage).
- The SearXNG engine moves (with `git mv`) from `packages/browser/integrations/searxng/searchcast.py` to `packages/searchcast/integrations/searxng/searchcast.py` and is in the `searchcast` package's `files`, so it is at `integrations/searxng/searchcast.py` inside the published package, the same path as in 0.1.2 (packagers reference it). Its docstring's path example and `about.website` stay valid.
- The end-to-end CLI tests move from `packages/browser` to `packages/searchcast` and spawn the real `searchcast` bin (the built `dist/cli.js`); the temporary launcher is deleted. Every case keeps running in CI with Chrome, with the same assertions: TCP serve, Unix socket with ephemeral profile and idle exit (profile deleted), no-loopback namespace (through `browser-query`), `--listen systemd` refusal and socket activation, xvfb, and the SearXNG engine test. `packages/searchcast` gets `@searchcast/browser` as a `workspace:^` devDependency for them.
- The README gains the serve documentation from the browser package (options table, systemd socket activation example, SearXNG engine and its stable path, the Xvfb note), and the upgrade note: after upgrading, install `@searchcast/browser` next to `searchcast` and existing units work unchanged. The browser package README points there.
- Changeset: `searchcast` minor noting `serve`/`browser-query`/the SearXNG path (it lands in the same 0.2.0).

## Acceptance criteria

- [ ] `searchcast serve` with every 0.1.2 flag works through the bin (the moved CLI tests pass in CI; every case still runs, none skipped by the move).
- [ ] Missing `@searchcast/browser`: clear message and non-zero exit (tested by hiding the module).
- [ ] `serve` does not load koffi/libcurl (tested).
- [ ] The packed `searchcast` tarball contains `integrations/searxng/searchcast.py` at that path (tested with a pack dry-run or equivalent).
- [ ] README documents serve, systemd, SearXNG path and the upgrade step.

## Blocked by

- rename-serpcast-to-searchcast

## Prompt

Goal: existing systemd units and the SearXNG integration keep working after `npm install -g searchcast @searchcast/browser` replaces searchcast 0.1.2. Behaviour must be identical; compare against the 0.1.2 CLI (the history of `packages/browser/src/cli.ts`) when in doubt.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- Read ADR 0005 (`docs/adr/0005-*`) first: it is the rename table this task implements a part of. ADRs 0001 to 0004 still hold for the mechanics (read "serpcast" there as `searchcast`).
- Do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia example under `examples/` is the one owner-approved exception.
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
