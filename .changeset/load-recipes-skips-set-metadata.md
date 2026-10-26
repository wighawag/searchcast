---
'@searchcast/recipe': patch
'@searchcast/browser': patch
'searchcast': patch
---

`loadRecipes` (in `@searchcast/recipe/node`, re-exported by `@searchcast/browser`, and so `--recipes <dir>` of `serve`) now skips hidden files (a leading `.`) and `manifest.json` when it lists a directory, so a recipe set installed by `searchcast install-recipes` (which writes the set's `manifest.json` and `.source.json` beside its recipes) loads as just its recipes instead of failing on its metadata. Any other `*.json` in the directory is still parsed as a recipe, and a file passed by path is loaded whatever its name.
