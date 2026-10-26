---
title: Generate the README LOC column with a script and check it in verify
slug: loc-table-generated
blockedBy: [http-targets-no-secure-context-headers]
covers: []
---

## What to build

The README "Size discipline (per-module LOC)" table drifts because each task only updates the rows it touches. Add a script that rewrites the `LOC` column from the actual line counts of the listed source files (keeping `target` and row order as authored, adding rows for source files that have none and failing on rows whose file no longer exists), with a `--check` mode that exits non-zero when the table is out of date. Wire `--check` into the verify gate (for example as part of `test` or `format:check`) and add a script to fix it (`pnpm loc`). Rows must name files unambiguously across packages (the `src/index.ts` row is currently ambiguous). Run it once to correct the table.

## Acceptance criteria

- [ ] `pnpm loc` rewrites the column; `--check` fails on a stale table and passes after `pnpm loc`.
- [ ] The verify gate fails when the table is stale.
- [ ] Every row names a file that exists, unambiguously; every source file under `packages/*/src` has a row.
- [ ] The table is correct at the end of the task.
- [ ] Tests cover the script (stale, fresh, missing file, new file).

## Blocked by

- http-targets-no-secure-context-headers (serialized: last, so the table is generated after the other code changes)

## Prompt

Origin: observation `2026-09-29-loc-table-stale`. Keep the script small and dependency-free (Node, like the other `scripts/*.mjs`). Define "LOC" exactly as the table's header text does (it says the actual line count of the source file) and keep that definition. Delete the observation note once resolved.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
