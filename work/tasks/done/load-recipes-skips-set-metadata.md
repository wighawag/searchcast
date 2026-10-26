---
title: loadRecipes skips an installed set's metadata (manifest.json and hidden files)
slug: load-recipes-skips-set-metadata
blockedBy: []
covers: []
---

## What to build

`loadRecipes` in `@searchcast/recipe` (the node-only subpath) loads every `*.json` file of a directory as a recipe, so pointing it at a recipe set written by `searchcast install-recipes` also parses the set's `manifest.json` and `.source.json` and fails. When it lists a directory, it skips hidden files (names starting with `.`) and `manifest.json`. A file passed explicitly by path is still loaded whatever its name. Document the rule in the recipe package's README and add a changeset (patch for `@searchcast/recipe`, and for `searchcast` if its docs change).

## Acceptance criteria

- [ ] `loadRecipes([dir])` on a directory holding recipes plus `manifest.json` and `.source.json` returns only the recipes.
- [ ] A hidden or `manifest.json` file passed explicitly as a path is still parsed (and fails as before if it is not a recipe).
- [ ] The installed-set case is tested with a set written the way `install-recipes` writes it.
- [ ] README and changeset updated.
- [ ] Tests cover the new behaviour.

## Blocked by

- None, can start immediately.

## Prompt

Origin: webveil's observation `serpcast-loadrecipes-reads-set-metadata-as-recipes` (webveil carries a workaround in `src/core/backends/searchcast.ts`, which a webveil task will drop once this is released). Check how `install-recipes` names the files it writes (manifest and source metadata) and skip exactly those, not every non-recipe JSON.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Decisions

- **Skip every hidden JSON, not only `.source.json`, plus `manifest.json`.** This follows the task's "What to build". It stays "exactly the install metadata" because install refuses hidden files in a set, so nothing else hidden can be there. Every other non-recipe JSON still fails, so a broken recipe is reported rather than silently skipped (I considered and rejected that alternative). This affects `@searchcast/browser`'s `loadRecipes` and `searchcast serve --recipes <dir>`. The decision is recorded in a JSDoc on `isListedRecipeFile` in `packages/recipe/src/node.ts`.

I made no git operations, and the working tree holds only the intended changes (6 modified files and the new changeset).
