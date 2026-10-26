---
'@searchcast/recipe': minor
---

`@searchcast/recipe/node` now exports `listRecipeFiles(paths)`: the exact files `loadRecipes(paths)` loads, in the same order (a file path as given; a directory as its `*.json` entries in name order, without hidden files and `manifest.json`), without parsing them. Loading each with `loadRecipeFile` gives the same recipes, so a caller that needs each recipe's file no longer has to copy the directory rule. `loadRecipes` is now built on it.
