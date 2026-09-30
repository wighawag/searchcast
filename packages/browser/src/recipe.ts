// The recipe schema, types and validator live in `@searchcast/recipe`, shared
// with searchcast (which runs the same recipes over HTTP) so one recipe file
// describes a site for both runners (ADR 0003). This module only re-exports
// it, so this package's own imports and public API stay unchanged. A change in
// recipe meaning or wording belongs in `@searchcast/recipe`, not here.
export {
	RecipeError,
	parseRecipe,
	type FieldSpec,
	type Recipe,
	type Submit,
} from '@searchcast/recipe';
export {loadRecipeFile, loadRecipes} from '@searchcast/recipe/node';
