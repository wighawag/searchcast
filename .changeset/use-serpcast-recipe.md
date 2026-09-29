---
'searchcast': patch
---

Validate recipes with `serpcast-recipe`, the recipe schema shared with serpcast, instead of searchcast's own copy. One recipe file now describes a site for both runners. Behaviour is unchanged: the same recipes are accepted with the same error messages, and `Recipe`, `RecipeError`, `parseRecipe`, `loadRecipeFile` and `loadRecipes` are still exported from `searchcast`.
