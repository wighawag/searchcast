import {mkdtempSync, rmSync} from 'node:fs';
import type {Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {findChrome} from '../src/browser.js';
import {Searchcast, SearchcastError} from '../src/searchcast.js';
import {parseRecipe, type Recipe} from '../src/recipe.js';
import {createSearchcastServer} from '../src/server.js';
import {startFixture} from './fixture.js';

// These tests drive a real browser. Point SEARCHCAST_CHROME at one, or have
// chromium/chrome on PATH; without one they are skipped, loudly.
const chrome = findChrome();
if (!chrome)
	console.warn(
		'searchcast: no browser found, skipping browser tests (set SEARCHCAST_CHROME)',
	);

describe.skipIf(!chrome)('with a real browser', () => {
	let site: Awaited<ReturnType<typeof startFixture>>;
	let searchcast: Searchcast;
	let profile: string;

	const results = {
		item: 'article.r',
		fields: {
			title: {selector: 'h2'},
			url: {selector: 'a.t', attr: 'href'},
			content: {selector: 'p.s'},
		},
	};
	const navigateRecipe = (extra: Partial<Recipe> = {}): Recipe =>
		parseRecipe({
			name: 'nav',
			navigate: {url: `${site.url}/search?q={query}`},
			ready: 'article.r a.t',
			empty: '.no-results',
			blocked: ['.challenge', '#captcha'],
			blockedUrl: ['/challenge$'],
			results,
			...extra,
		});

	beforeAll(async () => {
		site = await startFixture();
		profile = mkdtempSync(join(tmpdir(), 'searchcast-profile-'));
		searchcast = new Searchcast({
			browser: {
				executable: chrome!,
				userDataDir: profile,
				headless: true,
				// e.g. --no-sandbox on CI runners whose kernel policy blocks Chrome's sandbox.
				extraArgs:
					process.env.SEARCHCAST_TEST_CHROME_ARGS?.split(' ').filter(Boolean),
			},
			concurrency: 2,
		});
		await searchcast.warmup();
	}, 60_000);

	afterAll(async () => {
		await searchcast?.close();
		site?.server.close();
		if (profile) rmSync(profile, {recursive: true, force: true});
	});

	it('navigates, waits for JS-rendered results, and extracts fields', async () => {
		const response = await searchcast.search(
			navigateRecipe(),
			'hello world & more',
		);
		expect(site.queries.at(-1)).toBe('hello world & more');
		expect(response.recipe).toBe('nav');
		expect(response.results).toHaveLength(3);
		expect(response.results[0]).toEqual({
			title: 'hello world & more result 1',
			url: `${site.url}/doc/1?q=hello%20world%20%26%20more`,
			content: 'snippet 1 about hello world & more',
		});
	});

	it('respects limit', async () => {
		const response = await searchcast.search(navigateRecipe({limit: 2}), 'x');
		expect(response.results.map((r) => r.title)).toEqual([
			'x result 1',
			'x result 2',
		]);
	});

	it('returns an empty list for a no-results page', async () => {
		expect(
			(await searchcast.search(navigateRecipe(), 'nothing')).results,
		).toEqual([]);
	});

	it('reports a redirect to a challenge URL as blocked', async () => {
		const error = await searchcast
			.search(navigateRecipe(), 'blockme')
			.catch((e) => e);
		expect(error).toBeInstanceOf(SearchcastError);
		expect(error.code).toBe('blocked');
	});

	it('reports a challenge element as blocked', async () => {
		const error = await searchcast
			.search(navigateRecipe(), 'challenge')
			.catch((e) => e);
		expect(error.code).toBe('blocked');
		expect(error.message).toContain('.challenge');
	});

	it('times out instead of returning nothing when the page never renders', async () => {
		const error = await searchcast
			.search(navigateRecipe({timeoutMs: 1500}), 'hang')
			.catch((e) => e);
		expect(error.code).toBe('timeout');
	});

	it('fills a form, replacing its existing value, and submits with Enter', async () => {
		const recipe = parseRecipe({
			name: 'form-enter',
			form: {url: `${site.url}/form`, input: 'input[name=q]'},
			ready: 'article.r a.t',
			results,
		});
		const response = await searchcast.search(recipe, 'typed query');
		expect(site.queries.at(-1)).toBe('typed query');
		expect(response.results[0].title).toBe('typed query result 1');
	});

	it('fills a form and submits by clicking', async () => {
		const recipe = parseRecipe({
			name: 'form-click',
			form: {
				url: `${site.url}/form`,
				input: 'input[name=q]',
				submit: {click: '#go'},
			},
			ready: 'article.r a.t',
			results,
		});
		expect((await searchcast.search(recipe, 'clicked')).results[0].title).toBe(
			'clicked result 1',
		);
	});

	it('reports a missing submit element as a recipe error', async () => {
		const recipe = parseRecipe({
			name: 'form-bad',
			form: {
				url: `${site.url}/form`,
				input: 'input[name=q]',
				submit: {click: '#nope'},
			},
			ready: 'article.r a.t',
			results,
		});
		const error = await searchcast.search(recipe, 'x').catch((e) => e);
		expect(error.code).toBe('recipe');
	});

	it('runs searches concurrently beyond the tab limit', async () => {
		const all = await Promise.all(
			['a', 'b', 'c', 'd'].map((q) => searchcast.search(navigateRecipe(), q)),
		);
		expect(all.map((r) => r.results[0].title)).toEqual([
			'a result 1',
			'b result 1',
			'c result 1',
			'd result 1',
		]);
	});

	it('does not look automated to the page', async () => {
		// The fixture echoes navigator.webdriver into the page; if the browser were
		// launched for automation, this would read "true" and the recipe would say so.
		const recipe = parseRecipe({
			name: 'webdriver',
			navigate: {url: `${site.url}/webdriver?q={query}`},
			ready: '#webdriver',
			results: {
				item: '#webdriver',
				fields: {title: {attr: 'data-value'}, url: {attr: 'data-url'}},
			},
		});
		const response = await searchcast.search(recipe, 'probe');
		expect(response.results[0].title).toBe('false');
	});

	describe('HTTP server', () => {
		let server: Server;
		let base: string;

		beforeAll(async () => {
			server = createSearchcastServer(
				searchcast,
				new Map([['nav', navigateRecipe()]]),
			);
			await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
			base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		});
		afterAll(() => server?.close());

		it('serves results as JSON, defaulting to the only recipe', async () => {
			const res = await fetch(`${base}/search?q=served`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.results[0].title).toBe('served result 1');
			expect(typeof body.elapsedMs).toBe('number');
		});

		it('maps blocked to 502 with an error code, never an empty 200', async () => {
			const res = await fetch(`${base}/search?q=blockme&recipe=nav`);
			expect(res.status).toBe(502);
			expect((await res.json()).error).toBe('blocked');
		});

		it('rejects bad input', async () => {
			expect((await fetch(`${base}/search`)).status).toBe(400);
			expect((await fetch(`${base}/search?q=x&recipe=nope`)).status).toBe(404);
			expect(await (await fetch(`${base}/recipes`)).json()).toEqual({
				recipes: ['nav'],
			});
		});
	});
});
