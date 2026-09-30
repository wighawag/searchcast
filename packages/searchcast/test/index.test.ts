import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {afterAll, describe, expect, expectTypeOf, it} from 'vitest';
import {packageName as recipePackageName} from '@searchcast/recipe';
import {
	createSearchcast,
	createSerpcast,
	packageName,
	SearchcastError,
	SerpcastError,
	usage,
	type Searchcast,
	type SearchcastErrorKind,
	type SearchcastOptions,
	type Serpcast,
	type SerpcastErrorKind,
	type SerpcastOptions,
} from '../src/index.js';
import {fakeTransport} from './engines.js';
import {HIDE_ARGS, hideEnv} from './platform-packages.js';

const run = promisify(execFile);
// The built bin; the verify gate builds before it tests.
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

describe('the searchcast package', () => {
	it('exports its package name', () => {
		expect(packageName).toBe('searchcast');
	});

	it('is published as searchcast with the one bin searchcast (no serpcast bin)', () => {
		const pkg = JSON.parse(
			readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
		);
		expect(pkg.name).toBe('searchcast');
		expect(pkg.bin).toEqual({searchcast: './dist/cli.js'});
		expect(Object.keys(pkg.exports)).toEqual(['.', './install']);
		expect(pkg.repository).toMatchObject({
			url: 'git+https://github.com/wighawag/searchcast.git',
			directory: 'packages/searchcast',
		});
		expect(pkg.keywords).not.toContain('serpcast');
	});

	it('usage names the bin', () => {
		expect(usage()).toMatch(/^Usage: searchcast /);
	});

	it('resolves @searchcast/recipe through the workspace', () => {
		expect(recipePackageName).toBe('@searchcast/recipe');
	});
});

describe("serpcast's API names, kept as deprecated aliases for one release", () => {
	it('are the same values as the new names, so instanceof still works', async () => {
		expect(SerpcastError).toBe(SearchcastError);
		expect(createSerpcast).toBe(createSearchcast);
		const error = new SerpcastError('blocked', 'x');
		expect(error).toBeInstanceOf(SearchcastError);
		expect(new SearchcastError('recipe', 'y')).toBeInstanceOf(SerpcastError);
		expect(error.name).toBe('SearchcastError');
		const instance: Serpcast = createSerpcast({
			transport: fakeTransport({}).transport,
		});
		const typed: Searchcast = instance;
		await typed.close();
	});

	it('are the same types as the new names', () => {
		expectTypeOf<SerpcastError>().toEqualTypeOf<SearchcastError>();
		expectTypeOf<SerpcastErrorKind>().toEqualTypeOf<SearchcastErrorKind>();
		expectTypeOf<Serpcast>().toEqualTypeOf<Searchcast>();
		expectTypeOf<SerpcastOptions>().toEqualTypeOf<SearchcastOptions>();
	});

	it('are exported by the built package, beside the new names', async () => {
		const main = (await import('searchcast')) as Record<string, unknown>;
		for (const name of [
			'SearchcastError',
			'SerpcastError',
			'createSearchcast',
			'createSerpcast',
		])
			expect(typeof main[name], name).toBe('function');
		expect(main.SerpcastError).toBe(main.SearchcastError);
		expect(main.createSerpcast).toBe(main.createSearchcast);
	});
});

describe('searchcast bin', () => {
	it('prints usage with --help and exits 0', async () => {
		const {stdout} = await run(process.execPath, [cli, '--help']);
		expect(stdout.trim()).toBe(usage());
	});

	it('rejects an unknown command as a usage error (exit 2)', async () => {
		await expect(run(process.execPath, [cli, 'nope'])).rejects.toMatchObject({
			code: 2,
			stderr: expect.stringContaining('unknown command: nope'),
		});
	});
});

describe('searchcast query (no native library needed)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'searchcast-cli-'));
	afterAll(() => rmSync(dir, {recursive: true, force: true}));
	const file = (name: string, recipe: object) => {
		const path = join(dir, name);
		writeFileSync(path, JSON.stringify(recipe));
		return path;
	};
	const results = {item: '.r', fields: {title: {}, url: {attr: 'href'}}};
	// No library anywhere: empty env overrides and a temp data dir.
	const env = {
		...process.env,
		SEARCHCAST_LIBCURL_PATH: '',
		SERPCAST_LIBCURL_PATH: '',
		LIBCURL_PATH: '',
		HOME: dir,
		XDG_DATA_HOME: dir,
	};
	const query = (...args: string[]) =>
		run(process.execPath, [cli, 'query', ...args], {env});

	it('needs --recipe and a query (exit 2)', async () => {
		await expect(query('hello')).rejects.toMatchObject({
			code: 2,
			stderr: expect.stringContaining('query needs --recipe <file>'),
		});
		const nav = file('nav.json', {
			navigate: {url: 'http://127.0.0.1:9/?q={query}'},
			ready: '#x',
			results,
		});
		await expect(query('--recipe', nav)).rejects.toMatchObject({
			code: 2,
			stderr: expect.stringContaining('query needs a query'),
		});
	});

	it('reports an invalid recipe file as a recipe failure (exit 1)', async () => {
		const bad = file('bad.json', {navigate: {url: 'no-placeholder'}});
		await expect(query('--recipe', bad, 'q')).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringMatching(/^searchcast: recipe: .*navigate\.url/),
		});
	});

	it('rejects a form recipe before loading anything (exit 1)', async () => {
		const form = file('form.json', {
			form: {url: 'http://127.0.0.1:9/', input: 'input'},
			ready: '#x',
			results,
		});
		await expect(query('--recipe', form, 'q')).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringMatching(
				/^searchcast: recipe: form: .*browser engine/,
			),
		});
	});

	it('fails with impersonation when no library is found (exit 1)', async () => {
		const nav = file('nav2.json', {
			navigate: {url: 'http://127.0.0.1:9/?q={query}'},
			ready: '#x',
			results,
		});
		// No platform package either (CI builds linux-x64's).
		const hidden = run(
			process.execPath,
			[...HIDE_ARGS, cli, 'query', '--recipe', nav, 'q'],
			{env: hideEnv(env)},
		);
		await expect(hidden).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringMatching(/^searchcast: impersonation: /),
		});
	});
});
