// Ported from searchcast's test/recipe.test.ts: the cases and expected
// messages are unchanged; only the imports moved (the loaders live on the
// node subpath).
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {RecipeError, parseRecipe} from '../src/index.js';
import {listRecipeFiles, loadRecipeFile, loadRecipes} from '../src/node.js';

const base = {
	name: 'web',
	navigate: {url: 'https://example.test/?q={query}'},
	ready: '.r',
	results: {
		item: '.r',
		fields: {title: {selector: 'h2'}, url: {selector: 'a', attr: 'href'}},
	},
};

describe('parseRecipe', () => {
	it('accepts a minimal navigate recipe', () => {
		const recipe = parseRecipe(base);
		expect(recipe.name).toBe('web');
		expect(recipe.navigate?.url).toContain('{query}');
		expect(recipe.results.fields.url).toEqual({selector: 'a', attr: 'href'});
	});

	it('accepts a form recipe; submit defaults to enter', () => {
		const {navigate, ...rest} = base;
		expect(
			parseRecipe({
				...rest,
				form: {url: 'https://example.test/', input: 'input'},
			}).form?.submit,
		).toBe('enter');
		expect(
			parseRecipe({
				...rest,
				form: {
					url: 'https://example.test/',
					input: 'input',
					submit: {click: 'button'},
				},
			}).form?.submit,
		).toEqual({click: 'button'});
	});

	it.each([
		[
			'neither navigate nor form',
			{...base, navigate: undefined},
			/exactly one of/,
		],
		[
			'both navigate and form',
			{...base, form: {url: 'x', input: 'i'}},
			/exactly one of/,
		],
		[
			'navigate url without {query}',
			{...base, navigate: {url: 'https://example.test/'}},
			/\{query\}/,
		],
		[
			'missing title field',
			{...base, results: {item: '.r', fields: {url: {attr: 'href'}}}},
			/title is required/,
		],
		['missing ready', {...base, ready: undefined}, /ready must be/],
		['bad limit', {...base, limit: 0}, /limit must be a positive integer/],
		[
			'bad blockedUrl regex',
			{...base, blockedUrl: ['(']},
			/not a valid regular expression/,
		],
		[
			'bad submit',
			{
				...base,
				navigate: undefined,
				form: {url: 'x', input: 'i', submit: 'tab'},
			},
			/form.submit/,
		],
	])('rejects %s', (_label, value, message) => {
		expect(() => parseRecipe(value)).toThrow(RecipeError);
		expect(() => parseRecipe(value)).toThrow(message);
	});
});

describe('loadRecipes', () => {
	const dirs: string[] = [];
	const tempDir = () => {
		const dir = mkdtempSync(join(tmpdir(), 'searchcast-recipes-'));
		dirs.push(dir);
		return dir;
	};
	afterAll(() => {
		for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
	});

	it('loads a directory, naming recipes after their file when unnamed', () => {
		const dir = tempDir();
		const {name, ...unnamed} = base;
		writeFileSync(join(dir, 'alpha.json'), JSON.stringify(unnamed));
		writeFileSync(
			join(dir, 'beta.json'),
			JSON.stringify({...base, name: 'beta'}),
		);
		writeFileSync(join(dir, 'notes.txt'), 'ignored');
		expect([...loadRecipes([dir]).keys()]).toEqual(['alpha', 'beta']);
	});

	it('rejects duplicate names', () => {
		const dir = tempDir();
		writeFileSync(join(dir, 'a.json'), JSON.stringify(base));
		writeFileSync(join(dir, 'b.json'), JSON.stringify(base));
		expect(() => loadRecipes([dir])).toThrow(/duplicate recipe name "web"/);
	});

	it("skips a set's manifest.json and hidden files when listing a directory", () => {
		const dir = tempDir();
		writeFileSync(join(dir, 'web.json'), JSON.stringify(base));
		writeFileSync(
			join(dir, 'manifest.json'),
			JSON.stringify({name: 'my-set', version: '1.0.0'}),
		);
		writeFileSync(join(dir, '.source.json'), JSON.stringify({source: 'x'}));
		writeFileSync(join(dir, '._web.json'), 'not json');
		expect([...loadRecipes([dir]).keys()]).toEqual(['web']);
	});

	it('still parses any other non-recipe *.json in a directory', () => {
		const dir = tempDir();
		writeFileSync(join(dir, 'web.json'), JSON.stringify(base));
		writeFileSync(join(dir, 'package.json'), JSON.stringify({name: 'x'}));
		expect(() => loadRecipes([dir])).toThrow(RecipeError);
	});

	it.each([['manifest.json'], ['.source.json'], ['.web.json']])(
		'loads %s when passed explicitly by path',
		(file) => {
			const dir = tempDir();
			const path = join(dir, file);
			writeFileSync(path, JSON.stringify({...base, name: 'explicit'}));
			expect([...loadRecipes([path]).keys()]).toEqual(['explicit']);
			writeFileSync(path, JSON.stringify({name: 'my-set', version: '1.0.0'}));
			expect(() => loadRecipes([path])).toThrow(RecipeError);
		},
	);
});

describe('listRecipeFiles', () => {
	const dirs: string[] = [];
	const tempDir = () => {
		const dir = mkdtempSync(join(tmpdir(), 'searchcast-recipe-files-'));
		dirs.push(dir);
		return dir;
	};
	afterAll(() => {
		for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
	});

	/** What loading the listed files one by one gives, as `loadRecipes` would. */
	const loadListed = (paths: string[]) =>
		new Map(
			listRecipeFiles(paths).map((file) => {
				const recipe = loadRecipeFile(file);
				return [recipe.name, recipe] as const;
			}),
		);

	/** A plain directory, an installed set with metadata, and loose files. */
	const fixture = () => {
		const root = tempDir();
		const plain = join(root, 'plain');
		mkdirSync(plain);
		const {name, ...unnamed} = base;
		writeFileSync(join(plain, 'zeta.json'), JSON.stringify(unnamed));
		writeFileSync(
			join(plain, 'alpha.json'),
			JSON.stringify({...base, name: 'alpha'}),
		);
		writeFileSync(join(plain, 'notes.txt'), 'ignored');
		const set = join(root, 'set');
		mkdirSync(set);
		writeFileSync(join(set, 'web.json'), JSON.stringify(base));
		writeFileSync(
			join(set, 'manifest.json'),
			JSON.stringify({name: 'my-set', version: '1.0.0'}),
		);
		writeFileSync(join(set, '.source.json'), JSON.stringify({source: 'x'}));
		const loose = join(root, 'loose.json');
		writeFileSync(loose, JSON.stringify({...base, name: 'loose'}));
		const manifest = join(root, 'manifest.json');
		writeFileSync(manifest, JSON.stringify({...base, name: 'from-manifest'}));
		const hidden = join(root, '.hidden.json');
		writeFileSync(hidden, JSON.stringify({...base, name: 'from-hidden'}));
		return {plain, set, loose, manifest, hidden};
	};

	it('lists a file as given and a directory as its sorted recipe entries', () => {
		const {plain, set, loose} = fixture();
		expect(listRecipeFiles([loose, plain, set])).toEqual([
			loose,
			join(plain, 'alpha.json'),
			join(plain, 'zeta.json'),
			join(set, 'web.json'),
		]);
	});

	it('lists explicit metadata-named paths as given', () => {
		const {manifest, hidden} = fixture();
		expect(listRecipeFiles([manifest, hidden])).toEqual([manifest, hidden]);
	});

	it('is empty for no paths and throws for a missing one', () => {
		expect(listRecipeFiles([])).toEqual([]);
		expect(() => listRecipeFiles([join(tempDir(), 'missing')])).toThrow(
			/ENOENT/,
		);
	});

	it.each([
		['a file', (f: ReturnType<typeof fixture>) => [f.loose]],
		['a directory', (f: ReturnType<typeof fixture>) => [f.plain]],
		[
			'an installed set with metadata',
			(f: ReturnType<typeof fixture>) => [f.set],
		],
		[
			'explicit metadata paths',
			(f: ReturnType<typeof fixture>) => [f.manifest, f.hidden],
		],
		[
			'a mix of all of them',
			(f: ReturnType<typeof fixture>) => [
				f.set,
				f.loose,
				f.plain,
				f.manifest,
				f.hidden,
			],
		],
	])('lists exactly what loadRecipes loads: %s', (_label, paths) => {
		const p = paths(fixture());
		const loaded = loadRecipes(p);
		const listed = loadListed(p);
		expect([...listed.keys()]).toEqual([...loaded.keys()]);
		expect(listed).toEqual(loaded);
	});
});
