// The example recipe examples/recipes/marginalia.mjs (outside the packages,
// not published) run in the engine chain against fakes of Marginalia's two
// APIs (test/engines.ts): the URL-keyed one without a key, the current one
// (key in an `API-Key` author header) with MARGINALIA_API_KEY. No test
// contacts the real API.

import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	createSearchcast,
	DEFAULT_COOLDOWN_MS,
	loadCodeRecipe,
	type CodeRecipe,
} from '../src/index.js';
import {
	clock,
	fakeTransport,
	type Answer,
	type FakeRequest,
} from './engines.js';

const path = fileURLToPath(
	new URL('../../../examples/recipes/marginalia.mjs', import.meta.url),
);
const HOST = 'api.marginalia.nu';
const API2 = 'api2.marginalia-search.com';

const json = (value: unknown, status = 200): Answer => ({
	status,
	body: JSON.stringify(value),
	headers: {'content-type': 'application/json'},
});
const answer = (results: unknown[]) =>
	json({query: 'q', license: 'CC-BY-NC-SA 4.0', results});

let marginalia: CodeRecipe;
const savedKey = process.env.MARGINALIA_API_KEY;
beforeEach(async () => {
	delete process.env.MARGINALIA_API_KEY;
	marginalia = await loadCodeRecipe(path);
});
afterEach(() => {
	if (savedKey === undefined) delete process.env.MARGINALIA_API_KEY;
	else process.env.MARGINALIA_API_KEY = savedKey;
});

function setup(reply: (request: FakeRequest) => Answer) {
	const time = clock();
	const fake = fakeTransport({[HOST]: reply, [API2]: reply});
	const searchcast = createSearchcast({
		now: time.now,
		transport: fake.transport,
	});
	return {...fake, time, searchcast};
}

describe('example recipe: marginalia', () => {
	it('is a code recipe named marginalia', () => {
		expect(marginalia.name).toBe('marginalia');
	});

	it('maps title, url and description (as snippet)', async () => {
		const {searchcast, requests} = setup(() =>
			answer([
				{
					url: 'https://a.example/',
					title: 'A',
					description: 'about a',
					quality: 1.5,
				},
				{url: 'https://b.example/', title: 'B', description: ''},
				{url: 'https://c.example/', title: ''},
				{title: 'no url'},
			]),
		);
		const {results} = await searchcast.search('linear b', {
			engines: [marginalia],
		});
		expect(results).toEqual([
			{title: 'A', url: 'https://a.example/', snippet: 'about a'},
			{title: 'B', url: 'https://b.example/'},
			{title: 'https://c.example/', url: 'https://c.example/'},
		]);
		expect(requests).toMatchObject([{kind: 'document'}]);
	});

	it('uses the `public` key by default and URL-encodes the query into the path', async () => {
		const {searchcast, requests} = setup(() => answer([]));
		await searchcast.search('c++ & a/b?', {engines: [marginalia]});
		expect(requests[0]!.url).toBe(
			`https://${HOST}/public/search/c%2B%2B%20%26%20a%2Fb%3F`,
		);
	});

	it('with MARGINALIA_API_KEY, calls the current API as a same-origin fetch with the key in an API-Key header', async () => {
		process.env.MARGINALIA_API_KEY = 'my-key';
		const {searchcast, requests} = setup(() =>
			answer([{url: 'https://a.example/', title: 'A', description: 'about a'}]),
		);
		const {results} = await searchcast.search('c++ & a/b?', {
			engines: [marginalia],
		});
		expect(results).toEqual([
			{title: 'A', url: 'https://a.example/', snippet: 'about a'},
		]);
		expect(requests).toEqual([
			expect.objectContaining({
				url: `https://${API2}/search?query=c%2B%2B%20%26%20a%2Fb%3F`,
				kind: 'fetch',
				referer: `https://${API2}/`,
				headers: {'api-key': 'my-key'},
			}),
		]);
		expect(requests[0]!.url).not.toContain('my-key');
	});

	it('without a key (unset or empty), calls the URL-keyed API with no headers', async () => {
		for (const key of [undefined, '']) {
			if (key === undefined) delete process.env.MARGINALIA_API_KEY;
			else process.env.MARGINALIA_API_KEY = key;
			const {searchcast, requests} = setup(() => answer([]));
			await searchcast.search('q', {engines: [marginalia]});
			expect(requests).toEqual([
				expect.objectContaining({
					url: `https://${HOST}/public/search/q`,
					kind: 'document',
				}),
			]);
			expect(requests[0]!.headers).toBeUndefined();
		}
	});

	it.each([
		[undefined, null],
		[10, '10'],
		[0, '1'],
		[250, '100'],
		[2.7, '2'],
	])(
		'sends count for maxResults %s (clamped to 1..100), to either API',
		async (max, count) => {
			for (const key of [undefined, 'my-key']) {
				if (key === undefined) delete process.env.MARGINALIA_API_KEY;
				else process.env.MARGINALIA_API_KEY = key;
				const {searchcast, requests} = setup(() => answer([]));
				await searchcast.search('q', {
					engines: [marginalia],
					...(max !== undefined && {maxResults: max}),
				});
				expect(new URL(requests[0]!.url).searchParams.get('count')).toBe(count);
			}
		},
	);

	it.each([
		[503, undefined],
		[429, undefined],
		[503, 'my-key'],
		[429, 'my-key'],
	])(
		'HTTP %s (the rate limit) is blocked and starts the cooldown (key: %s)',
		async (status, key) => {
			if (key !== undefined) process.env.MARGINALIA_API_KEY = key;
			const {searchcast, time, hits} = setup(() => json({}, status));
			const first = await searchcast.search('q', {engines: [marginalia]}).then(
				() => expect.fail('expected a failure'),
				(e: {failures: {error: {kind: string}}[]}) => e,
			);
			expect(first.failures[0]!.error.kind).toBe('blocked');
			time.advance(DEFAULT_COOLDOWN_MS - 1);
			await searchcast.search('q', {engines: [marginalia]}).catch(() => {});
			expect(hits(key ? API2 : HOST)).toHaveLength(1);
		},
	);

	it.each([
		['no results array', json({query: 'q', license: 'x'})],
		['results that is not an array', json({results: 'nope'})],
		['a JSON null', json(null)],
	])('a response with %s is a recipe error', async (_, reply) => {
		const {searchcast} = setup(() => reply);
		const error = await searchcast.search('q', {engines: [marginalia]}).then(
			() => expect.fail('expected a failure'),
			(e: {failures: {error: {kind: string; message: string}}[]}) => e,
		);
		expect(error.failures[0]!.error).toMatchObject({
			kind: 'recipe',
			message: 'marginalia: no "results" array in the API response',
		});
	});

	it('another server error stays a transport error', async () => {
		const {searchcast} = setup(() => json({}, 500));
		const error = await searchcast.search('q', {engines: [marginalia]}).then(
			() => expect.fail('expected a failure'),
			(e: {failures: {error: {kind: string}}[]}) => e,
		);
		expect(error.failures[0]!.error.kind).toBe('transport');
	});
});
