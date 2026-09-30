// The rename from `serpcast-recipe` 0.2.0 to `@searchcast/recipe` (ADR 0005)
// is a pure rename: the same entries, the same exports, MIT and no runtime
// dependencies. These lists are the exports of serpcast-recipe 0.2.0; a
// change here is a change to the public API, not part of a rename.
import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import * as entry from '../src/index.js';
import * as nodeEntry from '../src/node.js';

const manifest = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

describe('@searchcast/recipe package', () => {
	it('is named @searchcast/recipe, and packageName says so', () => {
		expect(manifest.name).toBe('@searchcast/recipe');
		expect(entry.packageName).toBe('@searchcast/recipe');
	});

	it('is MIT with its own LICENSE file and no runtime dependencies', () => {
		expect(manifest.license).toBe('MIT');
		expect(existsSync(new URL('../LICENSE', import.meta.url))).toBe(true);
		expect(manifest.dependencies).toBeUndefined();
		expect(manifest.peerDependencies).toBeUndefined();
		expect(manifest.optionalDependencies).toBeUndefined();
	});

	it('has the same two entries', () => {
		expect(Object.keys(manifest.exports)).toEqual(['.', './node']);
	});

	it('exports the same names from the main entry', () => {
		expect(Object.keys(entry).sort()).toEqual([
			'DEFAULT_LIMIT',
			'DEFAULT_TIMEOUT_MS',
			'RecipeError',
			'packageName',
			'parseRecipe',
			'requiresBrowser',
		]);
	});

	it('exports the same names from the node entry', () => {
		expect(Object.keys(nodeEntry).sort()).toEqual([
			'loadRecipeFile',
			'loadRecipes',
		]);
	});
});
