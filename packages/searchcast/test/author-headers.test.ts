// Author headers on a `fetch` request (a page's `fetch(url, {headers})`): the
// measured placement and preflight as table literals, and every refusal
// (work/notes/findings/fetch-author-headers.md). No network: the wire is
// asserted in author-headers-native.test.ts.

import {describe, expect, it} from 'vitest';
import {authorHeaders} from '../src/author-headers.js';
import {
	AUTHOR_HEADER_SETS,
	headerTable,
	preflightTable,
	SearchcastError,
} from '../src/index.js';

const UA =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const SEC_CH_UA =
	'"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"';
const PAGE = 'https://www.example.com:39383/page?q=x';
const ORIGIN = 'https://www.example.com:39383';
const URLS = {
	'same-origin': 'https://www.example.com:39383/api',
	'same-site': 'https://cdn.example.com:39383/api',
	'cross-site': 'https://www.example.net:39383/api',
} as const;

const recipeError = (message: RegExp) =>
	expect.objectContaining({
		kind: 'recipe',
		message: expect.stringMatching(message),
	});

describe('author headers: placement (the finding fetch-author-headers)', () => {
	it('supports exactly the measured name sets', () => {
		expect(AUTHOR_HEADER_SETS).toEqual([['api-key'], ['authorization']]);
	});

	it('literal: GET, same-origin, API-Key goes after sec-ch-ua-platform, lowercased', () => {
		expect(
			headerTable('fetch', {
				referer: PAGE,
				url: URLS['same-origin'],
				cookie: 'a=1',
				headers: {'API-Key': 'k1'},
			}),
		).toEqual([
			['sec-ch-ua-platform', '"Linux"'],
			['api-key', 'k1'],
			['user-agent', UA],
			['sec-ch-ua', SEC_CH_UA],
			['sec-ch-ua-mobile', '?0'],
			['accept', '*/*'],
			['sec-fetch-site', 'same-origin'],
			['sec-fetch-mode', 'cors'],
			['sec-fetch-dest', 'empty'],
			['referer', PAGE],
			['accept-encoding', 'gzip, deflate, br, zstd'],
			['accept-language', 'en-US,en;q=0.9'],
			['cookie', 'a=1'],
			['priority', 'u=1, i'],
		]);
	});

	it('literal: POST json, cross-site, Authorization goes after sec-ch-ua-platform', () => {
		expect(
			headerTable('fetch', {
				referer: PAGE,
				url: URLS['cross-site'],
				method: 'POST',
				contentType: 'application/json',
				contentLength: 7,
				headers: {Authorization: 'Bearer t'},
			}),
		).toEqual([
			['content-length', '7'],
			['sec-ch-ua-platform', '"Linux"'],
			['authorization', 'Bearer t'],
			['user-agent', UA],
			['sec-ch-ua', SEC_CH_UA],
			['content-type', 'application/json'],
			['sec-ch-ua-mobile', '?0'],
			['accept', '*/*'],
			['origin', ORIGIN],
			['sec-fetch-site', 'cross-site'],
			['sec-fetch-mode', 'cors'],
			['sec-fetch-dest', 'empty'],
			['sec-fetch-storage-access', 'active'],
			['referer', `${ORIGIN}/`],
			['accept-encoding', 'gzip, deflate, br, zstd'],
			['accept-language', 'en-US,en;q=0.9'],
			['priority', 'u=1, i'],
		]);
	});

	for (const site of ['same-origin', 'same-site', 'cross-site'] as const) {
		for (const method of ['GET', 'POST'] as const) {
			for (const name of ['api-key', 'authorization']) {
				it(`${method} ${site} with ${name}: the table without it, plus it right after sec-ch-ua-platform`, () => {
					const context = {
						referer: PAGE,
						url: URLS[site],
						method,
						...(method === 'POST' && {
							contentType: 'text/plain',
							contentLength: 3,
						}),
					};
					const plain = headerTable('fetch', context);
					const at = plain.findIndex(([n]) => n === 'sec-ch-ua-platform');
					expect(
						headerTable('fetch', {...context, headers: {[name]: 'v'}}),
					).toEqual([
						...plain.slice(0, at + 1),
						[name, 'v'],
						...plain.slice(at + 1),
					]);
				});
			}
		}
	}

	it('normalizes values as fetch() does, and combines names that differ only in case', () => {
		expect(authorHeaders('fetch', {'API-Key': ' \tk1 \r\n'})).toEqual([
			['api-key', 'k1'],
		]);
		expect(authorHeaders('fetch', {'API-Key': 'a', 'api-key': 'b'})).toEqual([
			['api-key', 'a, b'],
		]);
		expect(authorHeaders('fetch', {})).toBeUndefined();
		expect(authorHeaders('fetch', undefined)).toBeUndefined();
		expect(authorHeaders('document', undefined)).toBeUndefined();
	});
});

describe('author headers: preflight', () => {
	const preflight = (
		site: 'same-site' | 'cross-site',
		method: string,
		requestHeaders: string,
	): [string, string][] => [
		['accept', '*/*'],
		['access-control-request-method', method],
		['access-control-request-headers', requestHeaders],
		['origin', ORIGIN],
		['user-agent', UA],
		['sec-fetch-mode', 'cors'],
		['sec-fetch-site', site],
		['sec-fetch-dest', 'empty'],
		['referer', `${ORIGIN}/`],
		['accept-encoding', 'gzip, deflate, br, zstd'],
		['accept-language', 'en-US,en;q=0.9'],
		['priority', 'u=1, i'],
	];

	for (const site of ['same-site', 'cross-site'] as const) {
		it(`a GET with an author header to another origin (${site}) is preflighted with method GET`, () => {
			expect(
				preflightTable({
					referer: PAGE,
					url: URLS[site],
					method: 'GET',
					headers: {'API-Key': 'k'},
				}),
			).toEqual(preflight(site, 'GET', 'api-key'));
		});

		it(`a POST (${site}) asks for the author header and a non-safelisted content-type, sorted, no spaces`, () => {
			expect(
				preflightTable({
					referer: PAGE,
					url: URLS[site],
					method: 'POST',
					contentType: 'application/json',
					headers: {'API-Key': 'k'},
				}),
			).toEqual(preflight(site, 'POST', 'api-key,content-type'));
			expect(
				preflightTable({
					referer: PAGE,
					url: URLS[site],
					method: 'POST',
					contentType: 'application/json',
					headers: {Authorization: 'x'},
				}),
			).toEqual(preflight(site, 'POST', 'authorization,content-type'));
		});

		it(`a POST (${site}) with a safelisted content-type, or none, asks only for the author header`, () => {
			for (const contentType of [
				'application/x-www-form-urlencoded',
				undefined,
			])
				expect(
					preflightTable({
						referer: PAGE,
						url: URLS[site],
						method: 'POST',
						contentType,
						headers: {'API-Key': 'k'},
					}),
				).toEqual(preflight(site, 'POST', 'api-key'));
		});
	}

	it('a same-origin request is never preflighted, and a GET without author headers neither', () => {
		expect(
			preflightTable({
				referer: PAGE,
				url: URLS['same-origin'],
				method: 'GET',
				headers: {'API-Key': 'k'},
			}),
		).toBeUndefined();
		expect(
			preflightTable({referer: PAGE, url: URLS['cross-site'], method: 'GET'}),
		).toBeUndefined();
	});
});

describe('author headers: refusals (recipe errors naming the header)', () => {
	it('refuses headers on a request that is not fetch', () => {
		for (const kind of [
			'document',
			'same-origin-navigation',
			'script',
		] as const) {
			expect(() =>
				headerTable(kind, {referer: PAGE, headers: {'API-Key': 'k'}}),
			).toThrowError(
				recipeError(new RegExp(`only for a fetch request.*${kind}`)),
			);
		}
	});

	it.each([
		'Cookie',
		'Referer',
		'Origin',
		'Host',
		'Content-Length',
		'Accept-Encoding',
		'Connection',
		'Access-Control-Request-Headers',
		'Sec-Fetch-Site',
		'sec-ch-ua',
		'Sec-Anything',
		'Proxy-Authorization',
		'X-HTTP-Method-Override',
	])('refuses the forbidden name %s', (name) => {
		expect(() => authorHeaders('fetch', {[name]: 'x'})).toThrowError(
			recipeError(new RegExp(`^header ${name}: a page's script cannot set it`)),
		);
	});

	it.each([
		'User-Agent',
		'Accept',
		'Accept-Language',
		'Priority',
		'Content-Type',
	])('refuses %s, which the header table sends itself', (name) => {
		expect(() => authorHeaders('fetch', {[name]: 'x'})).toThrowError(
			recipeError(new RegExp(`^header ${name}: the header table sends it`)),
		);
	});

	it('refuses a name set whose order was not measured, naming the supported sets', () => {
		for (const headers of [
			{'X-Zeta': 'z'},
			{'API-Key': 'k', Authorization: 'a'},
			{'API-Key': 'k', 'X-Zeta': 'z'},
		]) {
			expect(() => authorHeaders('fetch', headers)).toThrowError(
				recipeError(
					/are not supported: Chrome orders author headers by a hash .*\{api-key\}, \{authorization\}$/,
				),
			);
		}
		expect(() => authorHeaders('fetch', {'X-Zeta': 'z'})).toThrowError(
			/\{x-zeta\}/,
		);
	});

	it('refuses bad values (CR/LF inside, empty, non-ASCII, not a string) and bad names', () => {
		for (const value of [
			'a\r\nX-Injected: 1',
			'a\nb',
			'a\0b',
			'',
			'  ',
			'é',
			1,
			null,
		])
			expect(() => authorHeaders('fetch', {'API-Key': value})).toThrowError(
				recipeError(/^header API-Key: the value must be/),
			);
		expect(() => authorHeaders('fetch', {'API Key': 'k'})).toThrowError(
			recipeError(/not a valid header name/),
		);
		expect(() => authorHeaders('fetch', {'': 'k'})).toThrowError(
			recipeError(/not a valid header name/),
		);
		for (const headers of [[['API-Key', 'k']], 'API-Key: k', null])
			expect(() => authorHeaders('fetch', headers)).toThrowError(
				recipeError(/headers must be an object/),
			);
	});

	it('the errors are SearchcastErrors', () => {
		expect(() => authorHeaders('fetch', {Cookie: 'x'})).toThrowError(
			SearchcastError,
		);
	});
});
