// The example recipe examples/recipes/mwmbl.mjs (outside the packages, not
// published) run in the engine chain against a fake of Mwmbl's search API
// (test/engines.ts). No test contacts the real API.

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
	new URL('../../../examples/recipes/mwmbl.mjs', import.meta.url),
);
const HOST = 'api.mwmbl.org';

const json = (value: unknown, status = 200): Answer => ({
	status,
	body: JSON.stringify(value),
	headers: {'content-type': 'application/json'},
});
// The shape of a real answer (one live request, 2026-09-30).
const answer = (results: unknown[]) =>
	json({query: 'q', number_of_results: results.length, results});
const result = (url: string, title: string, content: string) => ({
	url,
	title,
	title_highlights: [title],
	content,
	content_highlights: [],
	engine: 'engine-a',
	score: 0.5,
});

let mwmbl: CodeRecipe;
const savedKey = process.env.MWMBL_API_KEY;
beforeEach(async () => {
	delete process.env.MWMBL_API_KEY;
	mwmbl = await loadCodeRecipe(path);
});
afterEach(() => {
	if (savedKey === undefined) delete process.env.MWMBL_API_KEY;
	else process.env.MWMBL_API_KEY = savedKey;
});

function setup(reply: (request: FakeRequest) => Answer) {
	const time = clock();
	const fake = fakeTransport({[HOST]: reply});
	const searchcast = createSearchcast({
		now: time.now,
		transport: fake.transport,
	});
	return {...fake, time, searchcast};
}

describe('example recipe: mwmbl', () => {
	it('is a code recipe named mwmbl', () => {
		expect(mwmbl.name).toBe('mwmbl');
	});

	it('maps title, url and content (as snippet)', async () => {
		const {searchcast, requests} = setup(() =>
			answer([
				result('https://a.example/', 'A', 'about a'),
				result('https://b.example/', 'B', ''),
				result('https://c.example/', '', ''),
				{title: 'no url', content: 'x'},
			]),
		);
		const {results} = await searchcast.search('linear b', {engines: [mwmbl]});
		expect(results).toEqual([
			{title: 'A', url: 'https://a.example/', snippet: 'about a'},
			{title: 'B', url: 'https://b.example/'},
			{title: 'https://c.example/', url: 'https://c.example/'},
		]);
		expect(requests).toMatchObject([{kind: 'document'}]);
	});

	it('URL-encodes the query into `q` and sends no key by default', async () => {
		const {searchcast, requests} = setup(() => answer([]));
		await searchcast.search('c++ & a/b?#x', {engines: [mwmbl]});
		expect(requests[0]!.url).toBe(
			`https://${HOST}/api/v2/search/?q=c%2B%2B%20%26%20a%2Fb%3F%23x`,
		);
		expect(new URL(requests[0]!.url).searchParams.get('q')).toBe(
			'c++ & a/b?#x',
		);
	});

	it('an empty MWMBL_API_KEY sends no key', async () => {
		process.env.MWMBL_API_KEY = '';
		const {searchcast, requests} = setup(() => answer([]));
		await searchcast.search('q', {engines: [mwmbl]});
		expect(new URL(requests[0]!.url).searchParams.has('api_key')).toBe(false);
	});

	it('sends MWMBL_API_KEY as the `api_key` query parameter, encoded', async () => {
		process.env.MWMBL_API_KEY = 'my key&x';
		const {searchcast, requests} = setup(() => answer([]));
		await searchcast.search('q', {engines: [mwmbl]});
		expect(requests[0]!.url).toBe(
			`https://${HOST}/api/v2/search/?q=q&api_key=my%20key%26x`,
		);
	});

	it('cuts the results to maxResults', async () => {
		const many = ['a', 'b', 'c', 'd'].map((n) =>
			result(`https://${n}.example/`, n, ''),
		);
		const {searchcast} = setup(() => answer(many));
		const {results} = await searchcast.search('q', {
			engines: [mwmbl],
			maxResults: 2,
		});
		expect(results.map((r) => r.url)).toEqual([
			'https://a.example/',
			'https://b.example/',
		]);
		const all = await mwmbl.search('q', {
			http: {json: async () => ({results: many})},
			maxResults: undefined,
		} as never);
		expect(all).toHaveLength(4);
		const cut = await mwmbl.search('q', {
			http: {json: async () => ({results: many})},
			maxResults: 3,
		} as never);
		expect(cut).toHaveLength(3);
	});

	it.each([429, 503])(
		'HTTP %s (quota or overload) is blocked and starts the cooldown',
		async (status) => {
			const {searchcast, time, hits} = setup(() => json({}, status));
			const first = await searchcast.search('q', {engines: [mwmbl]}).then(
				() => expect.fail('expected a failure'),
				(e: {failures: {error: {kind: string}}[]}) => e,
			);
			expect(first.failures[0]!.error.kind).toBe('blocked');
			time.advance(DEFAULT_COOLDOWN_MS - 1);
			await searchcast.search('q', {engines: [mwmbl]}).catch(() => {});
			expect(hits(HOST)).toHaveLength(1);
		},
	);

	it.each([
		['no results array', json({query: 'q', number_of_results: 0})],
		['results that is not an array', json({results: 'nope'})],
		['a JSON null', json(null)],
	])('a response with %s is a recipe error', async (_, reply) => {
		const {searchcast} = setup(() => reply);
		const error = await searchcast.search('q', {engines: [mwmbl]}).then(
			() => expect.fail('expected a failure'),
			(e: {failures: {error: {kind: string; message: string}}[]}) => e,
		);
		expect(error.failures[0]!.error).toMatchObject({
			kind: 'recipe',
			message: 'mwmbl: no "results" array in the API response',
		});
	});

	it('another server error stays a transport error', async () => {
		const {searchcast} = setup(() => json({}, 500));
		const error = await searchcast.search('q', {engines: [mwmbl]}).then(
			() => expect.fail('expected a failure'),
			(e: {failures: {error: {kind: string}}[]}) => e,
		);
		expect(error.failures[0]!.error.kind).toBe('transport');
	});
});
