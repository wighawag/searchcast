---
title: Root scripts run their CLI when invoked through a symlink (a guard must never pass by doing nothing)
slug: guard-scripts-realpath
blockedBy: [typecheck-tests]
covers: []
---

## What to build

Observation `work/notes/observations/2026-09-30-scripts-cli-guard-symlink.md`: `scripts/pack-check.mjs`, `scripts/no-skips.mjs`, `scripts/release-plan.mjs` and `scripts/copy-publish-assets.mjs` decide whether to run their CLI with `resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))`. Node reports `import.meta.url` as the real path, so through a symlinked path the comparison is false and the script exits 0 having done nothing, which for a guard reads as "passed". `scripts/libcurl-packages.mjs` already compares realpaths. Move that comparison into one small shared helper (for example `scripts/is-main.mjs`) used by all five, and test, for each script, that invoking it through a symlinked scripts directory actually runs it (for a guard: a failing fixture fails). Delete the observation note.

## Acceptance criteria

- [ ] All five scripts use the one helper; each is tested through a symlink.
- [ ] The observation note is removed; the gate is green.

## Blocked by

- typecheck-tests (both touch the root `test` script area; serialised)

## Prompt

Goal: a release guard can never silently skip itself. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- No package version edits; no changeset unless a published package's content changes (state it in the PR if none).
- Security properties and every existing test stay unchanged in strength.
- Public repo: no real search engine named (placeholders), except the owner-approved Marginalia and Mwmbl examples.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
