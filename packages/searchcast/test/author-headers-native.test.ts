// Author headers on a `fetch` request, through the real native library against
// a local HTTP/2 server: the measured order and lowercase spelling on the
// wire, the CORS preflight they cause (GET and POST) with its
// `access-control-request-headers`, a refusal when the preflight does not
// allow the header, and the preflight cache covering header names
// (work/notes/findings/fetch-author-headers.md). Skipped without
// SEARCHCAST_LIBCURL_PATH, like the other native tests.

import type http2 from 'node:http2';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
	createTransport,
	headerTable,
	preflightTable,
	type RequestOptions,
} from '../src/index.js';
import {CA_PATH, startH2Server, type H2Server} from './servers.js';

const LIB = process.env.SEARCHCAST_LIBCURL_PATH;

interface Seen {
	method: string;
	path: string;
	/** Header names and values, pseudo-headers excluded, in wire order. */
	headers: string[];
	/** Which connection it came on (1, 2, ... in accept order). */
	connection: number;
}

describe.skipIf(!LIB)('author headers (native libcurl-impersonate)', () => {
	let server: H2Server;
	const seen: Seen[] = [];
	const connections = new WeakMap<object, number>();
	let nextConnection = 1;
	const transport = createTransport({libcurlPath: LIB, caPath: CA_PATH});
	const url = (path: string) => `https://localhost:${server.port}${path}`;
	const at = (method: string, path: string) =>
		seen.filter((s) => s.method === method && s.path === path);
	const header = (s: Seen, name: string) =>
		s.headers[s.headers.indexOf(name) + 1];

	beforeAll(async () => {
		server = await startH2Server((req, res) => {
			req.resume();
			req.on('end', () => {
				const session = (req.stream as http2.ServerHttp2Stream).session!;
				if (!connections.has(session))
					connections.set(session, nextConnection++);
				seen.push({
					method: req.method,
					path: req.url,
					headers: req.rawHeaders.slice(8),
					connection: connections.get(session)!,
				});
				const origin = req.headers.origin;
				if (req.method === 'OPTIONS') {
					// `?allow=<list>` answers with that list, else with what was asked.
					const allow =
						new URL(req.url, 'https://x').searchParams.get('allow') ??
						req.headers['access-control-request-headers'] ??
						'';
					res.setHeader('access-control-allow-origin', origin!);
					res.setHeader('access-control-allow-credentials', 'true');
					res.setHeader('access-control-allow-headers', allow);
					if (req.url.includes('max-age'))
						res.setHeader('access-control-max-age', '600');
					res.statusCode = 204;
					res.end();
					return;
				}
				if (origin) {
					res.setHeader('access-control-allow-origin', origin);
					res.setHeader('access-control-allow-credentials', 'true');
				}
				res.setHeader('content-type', 'application/json');
				res.end('{"ok":true}');
			});
		});
		await transport.check();
	});
	afterAll(() => server?.close());

	const pages = {
		'same-origin': () => url('/page?q=x'),
		'same-site': () => 'https://localhost:1/page?q=x', // another port
		'cross-site': () => 'https://example.test/page?q=x',
	} as const;
	const requests = {
		GET: {},
		'POST json': {
			method: 'POST',
			body: '{"a":1}',
			contentType: 'application/json',
		},
		'POST form': {
			method: 'POST',
			body: 'a=1',
			contentType: 'application/x-www-form-urlencoded',
		},
	} as const;

	for (const site of ['same-origin', 'same-site', 'cross-site'] as const) {
		for (const [label, extra] of Object.entries(requests)) {
			for (const [name, value] of [
				['API-Key', 'k1'],
				['Authorization', 'Bearer t'],
			] as const) {
				it(`${label}, ${site}, ${name}: the measured table on the wire, and the preflight Chrome would send`, async () => {
					const referer = pages[site]();
					const path = `/author/${site}/${label.replace(' ', '-')}/${name}`;
					const options = {
						kind: 'fetch',
						referer,
						headers: {[name]: value},
						...extra,
					} as RequestOptions;
					const response = await transport
						.session()
						.request(url(path), options);
					expect(response.status).toBe(200);
					const post = 'body' in extra;
					const [sent] = at(post ? 'POST' : 'GET', path);
					const lower = name.toLowerCase();
					const expected = headerTable('fetch', {
						referer,
						url: url(path),
						headers: {[name]: value},
						...(post && {
							method: 'POST',
							contentType: extra.contentType,
							contentLength: extra.body.length,
						}),
					}).flat();
					expect(sent!.headers).toEqual(expected);
					// Lowercased, right after sec-ch-ua-platform (the measured slot).
					const i = sent!.headers.indexOf(lower);
					expect(sent!.headers[i - 2]).toBe('sec-ch-ua-platform');
					expect(sent!.headers[i + 1]).toBe(value);
					expect(sent!.headers[i + 2]).toBe('user-agent');
					expect(sent!.headers).not.toContain(name);

					const preflights = at('OPTIONS', path);
					if (site === 'same-origin') {
						expect(preflights).toHaveLength(0);
						return;
					}
					expect(preflights).toHaveLength(1);
					expect(preflights[0]!.headers).toEqual(
						preflightTable({
							referer,
							url: url(path),
							headers: {[name]: value},
							...(post
								? {method: 'POST', contentType: extra.contentType}
								: {method: 'GET'}),
						})!.flat(),
					);
					expect(header(preflights[0]!, 'access-control-request-method')).toBe(
						post ? 'POST' : 'GET',
					);
					expect(header(preflights[0]!, 'access-control-request-headers')).toBe(
						label === 'POST json' ? `${lower},content-type` : lower,
					);
					// The preflight never carries the author header itself.
					expect(
						preflights[0]!.headers.filter((_, j) => j % 2 === 0),
					).not.toContain(lower);
					expect(seen.indexOf(preflights[0]!)).toBeLessThan(
						seen.indexOf(sent!),
					);
					expect(preflights[0]!.connection).not.toBe(sent!.connection);
				});
			}
		}
	}

	it('does not send the request when the preflight does not allow the header (recipe error)', async () => {
		const attempt = (path: string, extra = {}) =>
			transport.session().request(url(path), {
				kind: 'fetch',
				referer: pages['cross-site'](),
				headers: {'API-Key': 'k'},
				...extra,
			} as RequestOptions);
		await expect(attempt('/deny/get?allow=content-type')).rejects.toMatchObject(
			{
				kind: 'recipe',
				message: expect.stringContaining(
					'api-key is not in access-control-allow-headers',
				),
			},
		);
		await expect(
			attempt('/deny/post?allow=api-key', {
				method: 'POST',
				body: '{}',
				contentType: 'application/json',
			}),
		).rejects.toMatchObject({
			kind: 'recipe',
			message: expect.stringContaining(
				'content-type is not in access-control-allow-headers',
			),
		});
		// `*` is no wildcard for a credentialed request (measured).
		await expect(attempt('/deny/star?allow=*')).rejects.toMatchObject({
			kind: 'recipe',
		});
		// The names are compared case-insensitively (measured).
		await expect(attempt('/deny/case?allow=API-KEY')).resolves.toMatchObject({
			status: 200,
		});
		for (const path of ['/deny/get', '/deny/post', '/deny/star']) {
			expect(
				seen.filter((s) => s.method !== 'OPTIONS' && s.path.startsWith(path)),
			).toHaveLength(0);
			expect(
				seen.filter((s) => s.method === 'OPTIONS' && s.path.startsWith(path)),
			).toHaveLength(1);
		}
	});

	it('refuses, before sending anything, forbidden or unmeasured names, bad values and headers on another kind (recipe errors)', async () => {
		const session = transport.session();
		const referer = pages['cross-site']();
		const attempts = [
			{kind: 'fetch', referer, headers: {Cookie: 'a=1'}},
			{kind: 'fetch', referer, headers: {'Sec-Fetch-Site': 'none'}},
			{kind: 'fetch', referer, headers: {'Proxy-Authorization': 'x'}},
			{kind: 'fetch', referer, headers: {'User-Agent': 'x'}},
			{kind: 'fetch', referer, headers: {'X-Other': 'x'}},
			{kind: 'fetch', referer, headers: {'API-Key': 'a', Authorization: 'b'}},
			{kind: 'fetch', referer, headers: {'API-Key': 'a\r\nX-Injected: 1'}},
			{kind: 'fetch', method: 'POST', referer, headers: {Origin: 'x'}},
			{kind: 'script', referer, headers: {'API-Key': 'k'}},
			{kind: 'document', headers: {'API-Key': 'k'}},
		];
		for (const attempt of attempts) {
			await expect(
				session.request(url('/refused'), attempt as never),
			).rejects.toMatchObject({kind: 'recipe'});
		}
		expect(seen.filter((s) => s.path === '/refused')).toHaveLength(0);
	});

	it('remembers a preflight with the header names it allowed; a new preflight replaces it (as measured)', async () => {
		const session = transport.session();
		const referer = pages['same-site']();
		const get = (path: string, headers: Record<string, string>) =>
			session.request(url(path), {kind: 'fetch', referer, headers});
		const json = (path: string, headers?: Record<string, string>) =>
			session.request(url(path), {
				kind: 'fetch',
				method: 'POST',
				referer,
				body: '{}',
				contentType: 'application/json',
				...(headers && {headers}),
			});
		const preflights = (path: string) =>
			at('OPTIONS', path).map((s) =>
				header(s, 'access-control-request-headers'),
			);

		// The answer allows api-key only: another name preflights again, and its
		// answer replaces the entry, so api-key preflights again too.
		const a = '/cache/a/max-age';
		await get(a, {'API-Key': 'k'});
		await get(a, {'API-Key': 'k'});
		await json(a);
		await get(a, {Authorization: 'x'});
		await get(a, {'API-Key': 'k'});
		expect(preflights(a)).toEqual([
			'api-key',
			'content-type',
			'authorization',
			'api-key',
		]);

		// The answer allows more than was asked: covered later without a preflight.
		const b = '/cache/b/max-age?allow=api-key,%20content-type';
		await get(b, {'API-Key': 'k'});
		await json(b, {'API-Key': 'k'});
		await json(b);
		await get(b, {'API-Key': 'k'});
		expect(preflights(b)).toEqual(['api-key']);
		expect(at('POST', b)).toHaveLength(2);
		expect(at('GET', b)).toHaveLength(2);
	});
});
