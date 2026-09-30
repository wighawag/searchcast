// The recipe schema, types and validator live in `serpcast-recipe`, shared
// with serpcast (which runs the same recipes over HTTP) so one recipe file
// describes a site for both runners (serpcast ADR 0003). This module only
// re-exports it, so searchcast's own imports and public API stay unchanged.
// A change in recipe meaning or wording belongs in `serpcast-recipe`, not here.
export {
	RecipeError,
	parseRecipe,
	type FieldSpec,
	type Recipe,
	type Submit,
} from 'serpcast-recipe';
export {loadRecipeFile, loadRecipes} from 'serpcast-recipe/node';
