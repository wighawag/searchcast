---
title: searchcast serve and browser-query also accept options before the command, as 0.1.2 did
slug: serve-options-before-command
spec: searchcast-monorepo
blockedBy: [searchcast-serve-command]
covers: [6]
---

## What to build

`searchcast` 0.1.2 parsed its command line with `parseArgs` over the whole argv, so options could come before the command: `searchcast --ephemeral serve --recipes r`, `searchcast --listen systemd serve ...`, `searchcast --headless browser-query ...` (0.1.2 spelled it `query`). Since `searchcast-serve-command` (decision 2 in `work/notes/observations/2026-09-30-searchcast-serve-command-decisions.md`), the `searchcast` bin only delegates when `serve`/`browser-query` is the FIRST argument, and the other order is a usage error. The owner asked for exactly 0.1.2's flags and behaviour, so restore it.

The way decision 2 itself names: `@searchcast/browser/cli` exports what is needed to find the command with the browser runner's own option table (for example `browserCommand(argv): string | undefined`, the first positional as the browser CLI's `parseArgs` sees it, or `undefined` when argv does not parse under that table), so the table is not copied into the `searchcast` bin. The `searchcast` bin delegates to `runCli(argv)` with argv UNCHANGED when:

- the first argument is `serve` or `browser-query` (today's rule, unchanged), or
- the first argument is an option, argv does not parse as an HTTP command (its first positional under the HTTP parser is not one of the HTTP commands), and under the browser runner's table the first positional is `serve` or `browser-query`.

Otherwise behaviour is as today (HTTP commands, usage errors). The added export is additive (a minor in `@searchcast/browser`'s pending 0.1.0; no second changeset needed unless the export warrants a line, decide), and the changeset of `searchcast` from `searchcast-serve-command` loses its sentence saying 0.1.x also accepted options before the command (edit that pending changeset file) since that is no longer a difference.

> RETRY HANDOFF (conductor, after PR #13 was blocked): the first attempt (branch `work/task-serve-options-before-command`, PR #13, closed) was right except one test: the Chrome e2e case "serves with options before the command" asserted `readdirSync(tmp)` is empty, and in CI Chrome itself leaves `com.google.Chrome.chrome_chrome_url_fetcher_*` in TMPDIR. Assert only that no `searchcast-profile-*` entry remains, exactly like the existing ephemeral-profile case. If that branch is available, build on it rather than starting over.

## Acceptance criteria

- [ ] `searchcast --ephemeral serve ...`, `searchcast --listen systemd serve ...` and `searchcast --headless browser-query --recipe r q` behave as with the command first (Chrome-free tests: the usage errors, `--listen systemd` refusal and missing-package line reached through that order; and one Chrome e2e case with an option before `serve`).
- [ ] HTTP commands with options first (`searchcast --proxy x query --recipe r q`, `searchcast --libcurl l doctor`) are unaffected, including a query whose text is `serve`.
- [ ] The browser option table exists in one place (`@searchcast/browser`), not copied.
- [ ] koffi is still never requested for the browser commands, whatever the order (the existing preload test extended).
- [ ] README and the pending changeset no longer describe the order as a difference.

## Blocked by

- searchcast-serve-command

## Prompt

Goal: close the one gap Gate 3 found in `searchcast-serve-command` (PR #12): existing command lines of `searchcast` 0.1.2 must keep working with any argument order 0.1.2 accepted. Read `packages/searchcast/src/browser-cli.ts`, `packages/searchcast/src/cli.ts`, `packages/browser/src/cli.ts`, and the decisions note above.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- Read ADR 0005 (`docs/adr/0005-*`) first: it is the rename table this task implements a part of. ADRs 0001 to 0004 still hold for the mechanics (read "serpcast" there as `searchcast`).
- Do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia example under `examples/` is the one owner-approved exception.
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
