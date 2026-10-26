// Node-only recipe loaders, published on the `@searchcast/recipe/node` subpath
// so the main entry stays usable without `node:fs`. Extracted unchanged from
// the browser runner's `src/recipe.ts` (searchcast@0.1.1, now
// @searchcast/browser).

import {readFileSync, readdirSync, statSync} from 'node:fs';
import {basename, extname, join} from 'node:path';
import {RecipeError, parseRecipe, type Recipe} from './recipe.js';

/** Read one recipe file. The name defaults to the file name without `.json`. */
export function loadRecipeFile(path: string): Recipe {
	let json: unknown;
	try {
		json = JSON.parse(readFileSync(path, 'utf8'));
	} catch (e) {
		throw new RecipeError(`${path}: ${(e as Error).message}`);
	}
	return parseRecipe(json, basename(path, extname(path)));
}

/**
 * Whether a directory entry is a recipe file `loadRecipes` loads: a `*.json`
 * that is neither hidden (a leading `.`) nor `manifest.json`.
 *
 * Decision (task load-recipes-skips-set-metadata, 2026-10-26): a recipe set
 * written by `searchcast install-recipes` holds, besides its recipes, the
 * archive's `manifest.json` and a `.source.json` recording where it came
 * from; those are exactly the JSON files skipped here (all hidden files are
 * skipped, as install refuses hidden files in an archive, so in a set only
 * its own `.source.json` can be one). Any other `*.json` is still parsed and
 * fails if it is not a recipe. A file named explicitly in `paths` is loaded
 * whatever its name. Alternative: skip every JSON that does not parse as a
 * recipe, which would hide a broken recipe instead of reporting it.
 */
function isListedRecipeFile(entry: string): boolean {
	return (
		entry.endsWith('.json') &&
		!entry.startsWith('.') &&
		entry !== 'manifest.json'
	);
}

/**
 * The recipe files `loadRecipes(paths)` loads, in the order it loads them: a
 * file path as given, and a directory as its `*.json` entries in name order,
 * except hidden files and `manifest.json` (an installed recipe set's
 * metadata). Directory entries are `join(dir, entry)`. Nothing is parsed, so
 * a caller can report each recipe's file (`loadRecipeFile` on each one gives
 * the recipes `loadRecipes` returns). Throws like `statSync` when a path does
 * not exist.
 *
 * Decision (task export-list-recipe-files, 2026-10-26): exported from this
 * node subpath only. `@searchcast/browser` re-exports `loadRecipeFile` and
 * `loadRecipes` but is NOT given `listRecipeFiles` here (its export list is
 * its own API surface; add it there in a browser task if a consumer needs
 * it). Alternative: re-export it from browser too, widening a second
 * package's API in a recipe-only task.
 */
export function listRecipeFiles(paths: string[]): string[] {
	const files: string[] = [];
	for (const p of paths) {
		if (statSync(p).isDirectory()) {
			for (const entry of readdirSync(p).sort()) {
				if (isListedRecipeFile(entry)) files.push(join(p, entry));
			}
		} else {
			files.push(p);
		}
	}
	return files;
}

/**
 * Load recipes from files and directories: every file `listRecipeFiles(paths)`
 * lists, keyed by recipe name. A directory contributes every `*.json` inside
 * except hidden files and `manifest.json` (an installed recipe set's
 * metadata); a file given by path is always loaded.
 */
export function loadRecipes(paths: string[]): Map<string, Recipe> {
	const recipes = new Map<string, Recipe>();
	for (const file of listRecipeFiles(paths)) {
		const recipe = loadRecipeFile(file);
		if (recipes.has(recipe.name)) {
			throw new RecipeError(`${file}: duplicate recipe name "${recipe.name}"`);
		}
		recipes.set(recipe.name, recipe);
	}
	return recipes;
}
