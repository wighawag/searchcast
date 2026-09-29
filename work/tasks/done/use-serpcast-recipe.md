---
title: Validate recipes with serpcast-recipe instead of searchcast's own copy of the schema
slug: use-serpcast-recipe
blockedBy: []
covers: []
---

## What to build

searchcast drops its in-file recipe schema, types and validator and depends on `serpcast-recipe` (the shared, MIT, zero-dependency package from the serpcast repo), re-exporting the recipe types and loaders from its own entry so its public API does not change. Behaviour is identical: every recipe accepted today is accepted, every error message is the same. The README says the recipe format is shared with serpcast (which runs the same recipes over HTTP with a browser fingerprint) and links to it.

Origin: the serpcast spec (`wighawag/serpcast`, `work/specs/tasked/serpcast.md`, user story 23; ADR 0003 there). This repo has no specs of its own, so this task carries no `spec:` field.

## Acceptance criteria

- [ ] `serpcast-recipe` is a runtime dependency; searchcast's own schema and validation code is removed. `src/recipe.ts` stays as a thin re-export shim (types, `RecipeError`, `parseRecipe` from the main entry, the file loaders from the node-only subpath), because `test/recipe.test.ts`, `src/probe.ts`, `src/server.ts` and others import `./recipe.js`; their imports do not change.
- [ ] searchcast's public exports (`Recipe`, `RecipeError`, `parseRecipe`, `loadRecipeFile`, `loadRecipes`, and any others exported today) still exist with the same types.
- [ ] The existing test suite passes unchanged.
- [ ] README updated: "no runtime dependencies" is corrected (one dependency, the shared recipe schema), and the recipe section links to serpcast.
- [ ] A changeset records the change.

## Blocked by

- External: `serpcast-recipe` must be published at a real version (not the `0.0.0` placeholder). Promote this task from backlog only after that release.

## Prompt

Goal: one recipe format for two runners, with no drift (serpcast ADR 0003). Compare `serpcast-recipe`'s exports with searchcast's current recipe module first; if the published package differs in meaning or messages, do NOT paper over it: route the task to needs-attention with the difference, because the fix belongs in `serpcast-recipe`.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Decisions

- **Version range `^0.1.0`, not an exact pin.** Why: this is the standard range for a runtime dependency, and on 0.x a caret only allows 0.1.x patches. ADR 0003 makes `serpcast-recipe` the single home of the format, so later fixes there should reach searchcast. Alternative: pin `0.1.0` exactly, so no upstream patch could change messages without a searchcast release. Touches only searchcast's `package.json` and the lockfile.
- **No new exports.** The package also exports `DEFAULT_LIMIT`, `DEFAULT_TIMEOUT_MS`, `requiresBrowser` and `packageName`. I did not add them to searchcast's public API, and I did not replace searchcast's own hard-coded defaults of 10 and 15000 with the package constants. Why: the task says the public API does not change, and it scopes the work to the schema and validator. Alternative: re-export them and use them in `searchcast.ts`, which would be a separate follow-up. Touches `src/index.ts` and `src/searchcast.ts` only if someone takes that up later.
