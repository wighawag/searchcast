// The engine chain with fake engines over a fake transport (test/engines.ts).

import {describe, expect, it} from 'vitest';
import {
	createMemoryStore,
	createSearchcast,
	DEFAULT_COOLDOWN_MS,
	SearchcastError,
	type SearchcastOptions,
} from '../src/index.js';
import {
	clock,
	engine,
	fakeTransport,
	pages,
	recordingStore,
	type Answer,
	type FakeRequest,
} from './engines.js';

const [a, b, c] = [engine('a'), engine('b'), engine('c')];

function setup(
	answers: Record<string, (request: FakeRequest) => Answer>,
	options: SearchcastOptions = {},
) {
	const time = clock();
	const fake = fakeTransport(answers);
	const searchcast = createSearchcast({
		now: time.now,
		transport: fake.transport,
		...options,
	});
	return {...fake, time, searchcast};
}

const failure = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => expect.fail('expected a failure'),
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(SearchcastError);
	return error as SearchcastError;
};
const kinds = (failures: {engine: string; error: SearchcastError}[] = []) =>
	failures.map((f) => [f.engine, f.error.kind]);

describe('createSearchcast: the chain', () => {
	it('returns the first answer, reports earlier failures, calls no later engine', async () => {
		const {searchcast, hits} = setup({
			a: pages.broken,
			b: () => pages.results('B1', 'B2'),
			c: () => pages.results('C1'),
		});
		const response = await searchcast.search('q', {engines: [a, b, c]});
		expect(response.engine).toBe('b');
		expect(response.results.map((r) => r.title)).toEqual(['B1', 'B2']);
		expect(response.results[0]!.url).toBe('https://b.test/B1');
		expect(kinds(response.failures)).toEqual([['a', 'recipe']]);
		expect(hits('a')).toHaveLength(1);
		expect(hits('c')).toHaveLength(0);
	});

	it('treats an empty match as the answer', async () => {
		const {searchcast, hits} = setup({
			a: pages.empty,
			b: () => pages.results('B'),
		});
		const response = await searchcast.search('q', {engines: [a, b]});
		expect(response).toEqual({results: [], engine: 'a', failures: []});
		expect(hits('b')).toHaveLength(0);
	});

	it('cuts the answer to maxResults', async () => {
		const {searchcast} = setup({a: () => pages.results('1', '2', '3')});
		const {results} = await searchcast.search('q', {
			engines: [a],
			maxResults: 2,
		});
		expect(results.map((r) => r.title)).toEqual(['1', '2']);
	});

	it('throws exhausted with every failure when all engines fail, never []', async () => {
		const timeout = new SearchcastError('timeout', 'slow');
		const {searchcast} = setup({
			a: pages.broken,
			b: pages.blocked,
			c: () => ({throw: timeout}),
		});
		const error = await failure(searchcast.search('q', {engines: [a, b, c]}));
		expect(error.kind).toBe('exhausted');
		expect(kinds(error.failures)).toEqual([
			['a', 'recipe'],
			['b', 'blocked'],
			['c', 'timeout'],
		]);
		expect(error.failures![2]!.error).toBe(timeout);
	});

	it('throws exhausted for an empty chain', async () => {
		const {searchcast} = setup({});
		const error = await failure(searchcast.search('q', {engines: []}));
		expect(error.kind).toBe('exhausted');
		expect(error.failures).toEqual([]);
	});

	it('aborts the whole search on an impersonation error', async () => {
		const {searchcast, hits} = setup({
			a: pages.broken,
			b: () => ({throw: new SearchcastError('impersonation', 'no library')}),
			c: () => pages.results('C'),
		});
		const error = await failure(searchcast.search('q', {engines: [a, b, c]}));
		expect(error.kind).toBe('impersonation');
		expect(hits('c')).toHaveLength(0);
	});

	it("rejects with the signal's reason when aborted, calling no later engine", async () => {
		const controller = new AbortController();
		const reason = new Error('stop');
		const {searchcast, hits} = setup({
			a: () => {
				controller.abort(reason);
				return {throw: reason};
			},
			b: () => pages.results('B'),
		});
		await expect(
			searchcast.search('q', {engines: [a, b], signal: controller.signal}),
		).rejects.toBe(reason);
		expect(hits('b')).toHaveLength(0);
	});

	it('rethrows an error that is not a SearchcastError (a bug, not an engine failure)', async () => {
		const bug = new TypeError('bug');
		const {searchcast} = setup({
			a: () => ({throw: bug}),
			b: () => pages.results('B'),
		});
		await expect(searchcast.search('q', {engines: [a, b]})).rejects.toBe(bug);
	});
});

describe('createSearchcast: cooldowns', () => {
	it('skips a blocked engine during its cooldown and tries it again after', async () => {
		const {searchcast, hits, time} = setup({
			a: pages.blocked,
			b: () => pages.results('B'),
		});
		const first = await searchcast.search('q', {engines: [a, b]});
		expect(kinds(first.failures)).toEqual([['a', 'blocked']]);
		expect(hits('a')).toHaveLength(1);

		time.advance(DEFAULT_COOLDOWN_MS - 1);
		const second = await searchcast.search('q', {engines: [a, b]});
		expect(hits('a')).toHaveLength(1); // skipped
		expect(second.engine).toBe('b');
		expect(kinds(second.failures)).toEqual([['a', 'blocked']]);
		expect(second.failures[0]!.error.message).toMatch(/cooling down until/);

		time.advance(1);
		await searchcast.search('q', {engines: [a, b]});
		expect(hits('a')).toHaveLength(2); // tried again
	});

	it('uses the configured cooldown, and only blocked starts one', async () => {
		const {searchcast, hits, time} = setup(
			{a: pages.blocked, b: pages.broken, c: () => pages.results('C')},
			{cooldownMs: 1000},
		);
		await searchcast.search('q', {engines: [a, b, c]});
		await searchcast.search('q', {engines: [a, b, c]});
		expect(hits('a')).toHaveLength(1);
		expect(hits('b')).toHaveLength(2); // a recipe failure starts no cooldown
		time.advance(1000);
		await searchcast.search('q', {engines: [a, b, c]});
		expect(hits('a')).toHaveLength(2);
	});
});

describe('createSearchcast: decoyGuard', () => {
	const query = 'debian bookworm backports kernel install';
	const decoy = () => pages.results('RuneScape', 'Kernel', 'Install', 'Wiki');
	const genuine = () =>
		pages.results('Debian-backports', 'Debian-kernel', 'Other', 'Else');

	it('turns a decoy answer of a guarded engine into a decoy failure and tries the next engine', async () => {
		const {searchcast, hits} = setup(
			{a: decoy, b: () => pages.results('B')},
			{decoyGuard: ['a']},
		);
		const response = await searchcast.search(query, {engines: [a, b]});
		expect(response.engine).toBe('b');
		expect(kinds(response.failures)).toEqual([['a', 'decoy']]);
		const {message} = response.failures[0]!.error;
		expect(message).toContain('backports bookworm debian install kernel');
		expect(message).toContain('"RuneScape", "Kernel", "Install", "Wiki"');
		expect(hits('a')).toHaveLength(1);
	});

	it('judges the whole answer, before the maxResults cut', async () => {
		const {searchcast} = setup(
			{a: decoy, b: () => pages.results('B')},
			{decoyGuard: ['a']},
		);
		const response = await searchcast.search(query, {
			engines: [a, b],
			maxResults: 1,
		});
		expect(kinds(response.failures)).toEqual([['a', 'decoy']]);
	});

	it('passes a relevant answer of a guarded engine', async () => {
		const {searchcast} = setup({a: genuine}, {decoyGuard: ['a']});
		const response = await searchcast.search(query, {engines: [a]});
		expect(response.engine).toBe('a');
		expect(response.failures).toEqual([]);
	});

	it('never judges an unguarded engine, and is off by default', async () => {
		const guarded = setup({a: decoy, b: decoy}, {decoyGuard: ['b']});
		const response = await guarded.searchcast.search(query, {engines: [a, b]});
		expect(response.engine).toBe('a');
		expect(response.results.map((r) => r.title)[0]).toBe('RuneScape');

		const plain = setup({a: decoy});
		expect((await plain.searchcast.search(query, {engines: [a]})).engine).toBe(
			'a',
		);
	});

	it('starts no cooldown: the engine is tried again at once, and answers another query', async () => {
		const {searchcast, hits, time} = setup(
			{
				a: (request) =>
					request.url.includes('debian') ? decoy() : pages.results('A'),
				b: () => pages.results('B'),
			},
			{decoyGuard: ['a']},
		);
		await searchcast.search(query, {engines: [a, b]});
		time.advance(1);
		const again = await searchcast.search(query, {engines: [a, b]});
		expect(hits('a')).toHaveLength(2); // not skipped
		expect(kinds(again.failures)).toEqual([['a', 'decoy']]);
		const other = await searchcast.search('q', {engines: [a, b]});
		expect(other.engine).toBe('a');
	});

	it('lists a decoy in exhausted like any failure', async () => {
		const {searchcast} = setup(
			{a: decoy, b: pages.broken},
			{decoyGuard: ['a']},
		);
		const error = await failure(searchcast.search(query, {engines: [a, b]}));
		expect(error.kind).toBe('exhausted');
		expect(kinds(error.failures)).toEqual([
			['a', 'decoy'],
			['b', 'recipe'],
		]);
	});

	it('applies to code recipes too', async () => {
		const code = {
			name: 'code',
			search: () =>
				['Why', 'WHY meaning', 'why - Wiktionary'].map((title, i) => ({
					title,
					url: `https://dictionary.test/${i}`,
				})),
		};
		const {searchcast} = setup(
			{b: () => pages.results('B')},
			{decoyGuard: ['code']},
		);
		const response = await searchcast.search('why does git rebase rewrite', {
			engines: [code, b],
		});
		expect(kinds(response.failures)).toEqual([['code', 'decoy']]);
	});
});

describe('createSearchcast: sessions', () => {
	const withCookie = (name: string) => (request: FakeRequest) => ({
		...(pages.results(name) as {body: string}),
		setCookie: request.cookie ? [] : [`sid=${name}; Path=/`],
	});

	it('keeps cookies across searches until the idle time passes', async () => {
		const {searchcast, requests, time} = setup(
			{a: withCookie('a')},
			{sessionIdleMs: 60_000},
		);
		await searchcast.search('q', {engines: [a]});
		time.advance(59_999);
		await searchcast.search('q', {engines: [a]});
		time.advance(59_999); // counted from the last use: still alive
		await searchcast.search('q', {engines: [a]});
		time.advance(60_000);
		await searchcast.search('q', {engines: [a]});
		expect(requests.map((r) => r.cookie)).toEqual([
			undefined,
			'sid=a',
			'sid=a',
			undefined,
		]);
	});

	it('clearSessions drops one engine or every engine', async () => {
		const {searchcast, requests} = setup({
			a: withCookie('a'),
			b: withCookie('b'),
		});
		const both = async () => {
			await searchcast.search('q', {engines: [a]});
			await searchcast.search('q', {engines: [b]});
		};
		await both();
		await searchcast.clearSessions('a');
		await both();
		await searchcast.clearSessions();
		await both();
		expect(requests.map((r) => `${r.engine}:${r.cookie ?? '-'}`)).toEqual([
			'a:-',
			'b:-',
			'a:-',
			'b:sid=b',
			'a:-',
			'b:-',
		]);
	});

	it('keeps the cookies of a failed attempt (a challenge may set them)', async () => {
		let n = 0;
		const {searchcast, requests, time} = setup({
			a: () =>
				n++ === 0
					? {status: 403, body: '', setCookie: ['challenge=ok']}
					: pages.results('A'),
			b: () => pages.results('B'),
		});
		await searchcast.search('q', {engines: [a, b]});
		time.advance(DEFAULT_COOLDOWN_MS);
		await searchcast.search('q', {engines: [a, b]});
		expect(
			requests.filter((r) => r.engine === 'a').map((r) => r.cookie),
		).toEqual([undefined, 'challenge=ok']);
	});
});

describe('createSearchcast: the state store', () => {
	it('sends every read and write to a caller-supplied store', async () => {
		const time = clock();
		const {store, calls} = recordingStore(time.now);
		const {searchcast} = setup(
			{a: pages.blocked, b: () => pages.results('B')},
			{store},
		);
		await searchcast.search('q', {engines: [a, b]});
		await searchcast.clearSessions();
		const keys = new Set(calls.map((c) => `${c.op} ${c.key}`));
		expect([...keys].sort()).toEqual([
			'delete engine/a/session',
			'delete engine/b/session',
			'delete serpcast/sessions',
			'get engine/a/cooldown',
			'get engine/a/session',
			'get engine/b/cooldown',
			'get engine/b/session',
			'get serpcast/sessions',
			'set engine/a/cooldown',
			'set engine/a/session',
			'set engine/b/session',
			'set serpcast/sessions',
		]);
	});

	it('holds all state in the store: a second instance on it sees cookies and cooldowns', async () => {
		const time = clock();
		const store = createMemoryStore({now: time.now});
		const fake = fakeTransport({
			a: pages.blocked,
			b: () => ({
				...(pages.results('B') as {body: string}),
				setCookie: ['s=1'],
			}),
		});
		const options = {store, now: time.now, transport: fake.transport};
		await createSearchcast(options).search('q', {engines: [a, b]});
		await createSearchcast(options).search('q', {engines: [a, b]});
		expect(fake.hits('a')).toHaveLength(1);
		expect(fake.hits('b').map((r) => r.cookie)).toEqual([undefined, 's=1']);
	});

	it('namespaces keys per engine name', async () => {
		const time = clock();
		const {store, calls} = recordingStore(time.now);
		const {searchcast} = setup({'a-b': () => pages.results('X')}, {store});
		await searchcast.search('q', {engines: [engine('a-b')]});
		expect(calls.some((c) => c.key === 'engine/a-b/session')).toBe(true);
	});

	it('close() resolves', async () => {
		const {searchcast} = setup({});
		await expect(searchcast.close()).resolves.toBeUndefined();
	});
});

describe('createMemoryStore', () => {
	it('expires keys after their ttl, by its clock, and copies values', async () => {
		const time = clock();
		const store = createMemoryStore({now: time.now});
		const value = {list: [1]};
		await store.set('k', value, {ttlMs: 10});
		await store.set('forever', 1);
		value.list.push(2);
		const got = (await store.get('k')) as {list: number[]};
		expect(got).toEqual({list: [1]});
		got.list.push(3);
		expect(await store.get('k')).toEqual({list: [1]});
		time.advance(10);
		expect(await store.get('k')).toBeUndefined();
		expect(await store.get('forever')).toBe(1);
		await store.delete('forever');
		expect(await store.get('forever')).toBeUndefined();
	});
});
