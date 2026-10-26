# @searchcast/recipe

## 0.2.0

### Minor Changes

- 39e9112: `@searchcast/recipe/node` now exports `listRecipeFiles(paths)`: the exact files `loadRecipes(paths)` loads, in the same order (a file path as given; a directory as its `*.json` entries in name order, without hidden files and `manifest.json`), without parsing them. Loading each with `loadRecipeFile` gives the same recipes, so a caller that needs each recipe's file no longer has to copy the directory rule. `loadRecipes` is now built on it.

## 0.1.1

### Patch Changes

- 1f860b3: `loadRecipes` (in `@searchcast/recipe/node`, re-exported by `@searchcast/browser`, and so `--recipes <dir>` of `serve`) now skips hidden files (a leading `.`) and `manifest.json` when it lists a directory, so a recipe set installed by `searchcast install-recipes` (which writes the set's `manifest.json` and `.source.json` beside its recipes) loads as just its recipes instead of failing on its metadata. Any other `*.json` in the directory is still parsed as a recipe, and a file passed by path is loaded whatever its name.

## 0.1.0

### Minor Changes

- 691d8e2: First release under the new name `@searchcast/recipe`; identical to `serpcast-recipe` 0.2.0 (same format, same API, same error messages).

The entries below were released as `serpcast-recipe` (from the [serpcast](https://github.com/wighawag/serpcast) repo), before the package was renamed `@searchcast/recipe` (ADR 0005).

## 0.2.0

### Minor Changes

- 5b896a3: Recipes may declare an optional `decoyProne` boolean: the site sometimes answers with results unrelated to the query. `parseRecipe` validates it (`recipe "<name>": decoyProne must be a boolean`) and keeps it in its output, and the `Recipe` type has it. serpcast's engine chain reads it; searchcast ignores it. Recipes without it parse exactly as before.

## 0.1.0

### Minor Changes

- 03e9f7f: First release. `serpcast-recipe`: the shared recipe schema, its types and its validator. `serpcast`: the transport (libcurl-impersonate), the declarative and code recipe runners, browser engines (searchcast), the engine chain with its state store, and the CLI (`query`, `install-libcurl`, `doctor`).
