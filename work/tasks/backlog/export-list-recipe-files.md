---
title: Export listRecipeFiles from @searchcast/recipe/node, the files loadRecipes loads
slug: export-list-recipe-files
blockedBy: []
covers: []
---

## What to build

`loadRecipes(paths)` returns `Map<name, Recipe>` without the file each recipe came from, and its directory rule (skip hidden files and `manifest.json`) is private, so callers that need the files (webveil's `doctor` reports each recipe's file) must copy the rule. Export `listRecipeFiles(paths): string[]` from `@searchcast/recipe/node`: the exact files `loadRecipes` would parse, in the same order (a file path as given; a directory as its listed `*.json` entries, sorted, without hidden files and `manifest.json`). `loadRecipes` uses it internally so the rule lives in one place. Document it in the package README and add a changeset (minor for `@searchcast/recipe`).

## Acceptance criteria

- [ ] `listRecipeFiles` is exported from the node subpath with types.
- [ ] For any input, `loadRecipes(paths)` equals loading `listRecipeFiles(paths)` one by one (tested on files, directories, an installed set with metadata, and explicit metadata paths).
- [ ] `loadRecipes` is implemented on top of it; existing tests pass unchanged.
- [ ] README and changeset.

## Blocked by

- None, can start immediately.

## Prompt

Origin: webveil observation `2026-10-26-loadrecipes-returns-no-files`. Keep the main entry free of `node:*` imports (the listing belongs to the node subpath). A webveil task will switch to this function after the release.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
