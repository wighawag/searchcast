// Plain `http://` targets through the real native library against a local
// HTTP/1.1 server: the exact tables Chromium was measured to send there
// (work/notes/findings/http-target-headers.md), names as spelled on the wire,
// values and order, `Host` first. A host that is not a loopback one is reached
// through a SOCKS5 proxy that connects every host name to 127.0.0.1 (so the
// request URL, and the `Host` header, can be `www.example.test` with no DNS
// and no traffic off this machine). Skipped without SEARCHCAST_LIBCURL_PATH,
// like the other native tests.

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
	createTransport,
	REQUEST_KINDS,
	SearchcastError,
	type RequestKind,
	type RequestOptions,
} from '../src/index.js';
import {
	startH1Server,
	startSocksProxy,
	type H1Server,
	type RecordingProxy,
} from './servers.js';

const LIB = process.env.SEARCHCAST_LIBCURL_PATH;

const UA =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const SEC_CH_UA =
	'"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"';
const NAV_ACCEPT =
	'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const LANG = 'en-US,en;q=0.9';

/** The measured table for a target that is not potentially trustworthy (the finding's "Not a loopback host"). */
function insecureTable(kind: RequestKind, referer: string): string[][] {
	if (kind === 'document' || kind === 'same-origin-navigation') {
		return [
			['Connection', 'keep-alive'],
			['Upgrade-Insecure-Requests', '1'],
			['User-Agent', UA],
			['Accept', NAV_ACCEPT],
			...(kind === 'document' ? [] : [['Referer', referer]]),
			['Accept-Encoding', 'gzip, deflate'],
			['Accept-Language', LANG],
		];
	}
	return [
		['Connection', 'keep-alive'],
		['User-Agent', UA],
		['Accept', '*/*'],
		['Referer', referer],
		['Accept-Encoding', 'gzip, deflate'],
		['Accept-Language', LANG],
	];
}

/** The measured table for a loopback `http://` target (secure-context headers, HTTP/1.1 spelling, no priority). */
function loopbackTable(kind: RequestKind, referer: string): string[][] {
	if (kind === 'document' || kind === 'same-origin-navigation') {
		return [
			['Connection', 'keep-alive'],
			['sec-ch-ua', SEC_CH_UA],
			['sec-ch-ua-mobile', '?0'],
			['sec-ch-ua-platform', '"Linux"'],
			['Upgrade-Insecure-Requests', '1'],
			['User-Agent', UA],
			['Accept', NAV_ACCEPT],
			['Sec-Fetch-Site', kind === 'document' ? 'none' : 'same-origin'],
			['Sec-Fetch-Mode', 'navigate'],
			['Sec-Fetch-User', '?1'],
			['Sec-Fetch-Dest', 'document'],
			...(kind === 'document' ? [] : [['Referer', referer]]),
			['Accept-Encoding', 'gzip, deflate, br, zstd'],
			['Accept-Language', LANG],
		];
	}
	return [
		['Connection', 'keep-alive'],
		['sec-ch-ua-platform', '"Linux"'],
		['User-Agent', UA],
		['sec-ch-ua', SEC_CH_UA],
		['sec-ch-ua-mobile', '?0'],
		['Accept', '*/*'],
		['Sec-Fetch-Site', 'same-origin'],
		['Sec-Fetch-Mode', kind === 'fetch' ? 'cors' : 'no-cors'],
		['Sec-Fetch-Dest', kind === 'fetch' ? 'empty' : 'script'],
		['Referer', referer],
		['Accept-Encoding', 'gzip, deflate, br, zstd'],
		['Accept-Language', LANG],
	];
}

describe.skipIf(!LIB)('http:// targets (native libcurl-impersonate)', () => {
	let server: H1Server;
	let proxy: RecordingProxy;
	const direct = createTransport({libcurlPath: LIB});
	let mapped: ReturnType<typeof createTransport>;
	/** A URL on a host that is not a loopback one, reached through the mapping proxy. */
	const site = (host: string, path: string) =>
		`http://${host}:${server.port}${path}`;
	const insecure = (path: string) => site('www.example.test', path);
	const loopback = (path: string) => `http://localhost:${server.port}${path}`;
	/** The one request the server got for `path`. */
	const got = (path: string) => {
		const found = server.requests.filter((r) => r.path === path);
		expect(found).toHaveLength(1);
		return found[0]!;
	};

	beforeAll(async () => {
		server = await startH1Server((req, res) => {
			if (req.method === 'OPTIONS') {
				res.setHeader('access-control-allow-origin', req.headers.origin!);
				res.setHeader('access-control-allow-credentials', 'true');
				res.setHeader('access-control-allow-headers', 'api-key, content-type');
				return res.end();
			}
			if (req.headers.origin) {
				res.setHeader('access-control-allow-origin', req.headers.origin);
				res.setHeader('access-control-allow-credentials', 'true');
			}
			if (req.url === '/set-cookie')
				res.setHeader('set-cookie', [
					'sid=abc; Path=/',
					'sec=1; Path=/; Secure',
				]);
			res.end('ok');
		});
		proxy = await startSocksProxy({connectTo: '127.0.0.1'});
		mapped = createTransport({
			libcurlPath: LIB,
			proxy: `socks5h://127.0.0.1:${proxy.port}`,
		});
		await direct.check();
	});
	afterAll(async () => {
		await proxy?.close();
		await server?.close();
	});

	it.each(REQUEST_KINDS)(
		'sends exactly the measured %s table to a host that is not a loopback one: HTTP/1.1, Host first, no secure-context headers',
		async (kind) => {
			const path = `/insecure/${kind}`;
			const referer = insecure('/page?q=x');
			const request = kind === 'document' ? {kind} : {kind, referer};
			const response = await mapped
				.session()
				.request(insecure(path), request as RequestOptions);
			expect(response.status).toBe(200);
			const seen = got(path);
			expect(seen.version).toBe('HTTP/1.1');
			expect(seen.raw).toEqual([
				'Host',
				`www.example.test:${server.port}`,
				...insecureTable(kind, referer).flat(),
			]);
		},
	);

	it.each(REQUEST_KINDS)(
		'sends exactly the measured %s table to a loopback host: secure-context headers, HTTP/1.1 spelling, no priority',
		async (kind) => {
			const path = `/loopback/${kind}`;
			const referer = loopback('/page?q=x');
			const request = kind === 'document' ? {kind} : {kind, referer};
			await direct.session().request(loopback(path), request as RequestOptions);
			const seen = got(path);
			expect(seen.version).toBe('HTTP/1.1');
			expect(seen.raw).toEqual([
				'Host',
				`localhost:${server.port}`,
				...loopbackTable(kind, referer).flat(),
			]);
		},
	);

	it('sends a same-site fetch origin and the page origin as referer, and cookies last (never a Secure one over http)', async () => {
		const session = mapped.session();
		await session.request(insecure('/set-cookie'), {kind: 'document'});
		const page = insecure('/page?q=x');
		await session.request(insecure('/c/same-origin'), {
			kind: 'fetch',
			referer: page,
		});
		await session.request(site('cdn.example.test', '/c/same-site'), {
			kind: 'fetch',
			referer: page,
		});
		const origin = `http://www.example.test:${server.port}`;
		expect(got('/c/same-origin').raw.slice(2)).toEqual([
			...insecureTable('fetch', page).flat(),
			'Cookie',
			'sid=abc',
		]);
		expect(got('/c/same-site').raw.slice(2)).toEqual([
			'Connection',
			'keep-alive',
			'User-Agent',
			UA,
			'Accept',
			'*/*',
			'Origin',
			origin,
			'Referer',
			`${origin}/`,
			'Accept-Encoding',
			'gzip, deflate',
			'Accept-Language',
			LANG,
		]);
	});

	it('sends a POST with an author header, and its preflight, as measured (sec-fetch-mode stays on the preflight)', async () => {
		const page = 'http://www.example.net/page';
		await mapped.session().request(insecure('/post/json'), {
			kind: 'fetch',
			referer: page,
			method: 'POST',
			body: '{}',
			contentType: 'application/json',
			headers: {'API-Key': 'k'},
		});
		const [preflight, post] = server.requests.filter(
			(r) => r.path === '/post/json',
		);
		expect(preflight!.method).toBe('OPTIONS');
		expect(preflight!.raw.slice(2)).toEqual([
			'Connection',
			'keep-alive',
			'Accept',
			'*/*',
			'Access-Control-Request-Method',
			'POST',
			'Access-Control-Request-Headers',
			'api-key,content-type',
			'Origin',
			'http://www.example.net',
			'User-Agent',
			UA,
			'Sec-Fetch-Mode',
			'cors',
			'Referer',
			'http://www.example.net/',
			'Accept-Encoding',
			'gzip, deflate',
			'Accept-Language',
			LANG,
		]);
		expect(post!.method).toBe('POST');
		expect(post!.raw.slice(2)).toEqual([
			'Connection',
			'keep-alive',
			'Content-Length',
			'2',
			'User-Agent',
			UA,
			'Content-Type',
			'application/json',
			'API-Key',
			'k',
			'Accept',
			'*/*',
			'Origin',
			'http://www.example.net',
			'Referer',
			'http://www.example.net/',
			'Accept-Encoding',
			'gzip, deflate',
			'Accept-Language',
			LANG,
		]);
	});

	it('sends no referer from an https page to a loopback http URL (the downgrade), preflight included', async () => {
		const page = 'https://www.example.com/page?q=x';
		const session = direct.session();
		await session.request(loopback('/down/script'), {
			kind: 'script',
			referer: page,
		});
		await session.request(loopback('/down/fetch'), {
			kind: 'fetch',
			referer: page,
			headers: {'API-Key': 'k'},
		});
		const script = got('/down/script').raw.slice(2);
		expect(script).toEqual([
			'Connection',
			'keep-alive',
			'sec-ch-ua-platform',
			'"Linux"',
			'User-Agent',
			UA,
			'sec-ch-ua',
			SEC_CH_UA,
			'sec-ch-ua-mobile',
			'?0',
			'Accept',
			'*/*',
			'Sec-Fetch-Site',
			'cross-site',
			'Sec-Fetch-Mode',
			'no-cors',
			'Sec-Fetch-Dest',
			'script',
			'Sec-Fetch-Storage-Access',
			'active',
			'Accept-Encoding',
			'gzip, deflate, br, zstd',
			'Accept-Language',
			LANG,
		]);
		const fetches = server.requests.filter((r) => r.path === '/down/fetch');
		expect(fetches.map((r) => r.method)).toEqual(['OPTIONS', 'GET']);
		for (const {raw} of fetches) {
			expect(raw).not.toContain('Referer');
			expect(raw[raw.indexOf('Origin') + 1]).toBe('https://www.example.com');
		}
	});

	it.each([
		['script', {kind: 'script'}],
		['fetch', {kind: 'fetch'}],
		['POST', {kind: 'fetch', method: 'POST', body: 'a=1'}],
	] as const)(
		'refuses a %s from an https page to a host that is not a loopback one (mixed content): a recipe error, nothing sent',
		async (name, options) => {
			const before = server.requests.length;
			const connections = proxy.requests.length;
			const error = await mapped
				.session()
				.request(insecure(`/mixed/${name}`), {
					...options,
					referer: 'https://www.example.com/page',
				} as RequestOptions)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(SearchcastError);
			expect(error).toMatchObject({
				kind: 'recipe',
				message: expect.stringContaining('mixed content'),
			});
			expect(server.requests.length).toBe(before);
			expect(proxy.requests.length).toBe(connections);
		},
	);
});
