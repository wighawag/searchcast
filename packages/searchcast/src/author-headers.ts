// Author headers: the headers a page's script adds to its own `fetch()`
// (`fetch(url, {headers: {'API-Key': key}})`), which a code recipe may add to a
// `fetch` request too, and nothing more. The header table stays Chrome's
// (chrome.ts): author headers are placed where Chrome places them, and a
// request Chrome would preflight is preflighted (transport.ts).
//
// Chrome orders a request's author headers together with `user-agent`, the
// client hints and `content-type` by Blink's `HTTPHeaderMap` hash-table
// iteration, so where they land depends on the whole NAME SET (and a larger
// set even moves `user-agent`). searchcast does not reimplement that hash: it
// supports only the name sets whose wire order was measured, listed in
// AUTHOR_HEADER_SETS, and refuses any other set. Extending it means measuring
// a new set the way the finding did and adding it here. Measurement:
// work/notes/findings/fetch-author-headers.md. Decisions:
// work/notes/observations/2026-09-30-fetch-author-headers-decisions.md.

import type {RequestKind} from './chrome.js';
import {SearchcastError} from './errors.js';

/** Author headers as a code recipe passes them: header name to value. */
export type AuthorHeaders = Record<string, string>;

/**
 * The measured author-header name sets (lowercase), each with the header of
 * the `fetch` table that Chrome puts it right after. Measured for GET and
 * POST (every body kind), same-origin, same-site and cross-site, with
 * Chromium 152: both single-header sets land right after
 * `sec-ch-ua-platform`, before `user-agent`.
 */
const PLACEMENT = new Map<string, string>([
	['api-key', 'sec-ch-ua-platform'],
	['authorization', 'sec-ch-ua-platform'],
]);

/** The supported author-header name sets (lowercase names), as measured. */
export const AUTHOR_HEADER_SETS: readonly (readonly string[])[] = [
	...PLACEMENT.keys(),
].map((key) => key.split(','));

/**
 * The Fetch standard's forbidden request-header names: a page's script cannot
 * set them (Chrome drops them). Every `sec-*` and `proxy-*` name too.
 */
const FORBIDDEN = new Set([
	'accept-charset',
	'accept-encoding',
	'access-control-request-headers',
	'access-control-request-method',
	'connection',
	'content-length',
	'cookie',
	'cookie2',
	'date',
	'dnt',
	'expect',
	'host',
	'keep-alive',
	'origin',
	'referer',
	'set-cookie',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'via',
	'x-http-method',
	'x-http-method-override',
	'x-method-override',
]);

/**
 * Names the header table sends itself. A page's script may set some of them
 * (`accept`, `accept-language`, `priority`), but Chrome then moves them
 * (measured for `accept-language`), which the table model does not express;
 * `content-type` is a POST's `contentType` option.
 */
const TABLE_NAMES = new Set([
	'user-agent',
	'accept',
	'accept-language',
	'priority',
	'content-type',
	'upgrade-insecure-requests',
]);

/** An HTTP token (RFC 9110 `tchar`s): what a header name may be. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** The supported sets for an error message: `{api-key}, {authorization}`. */
function supported(): string {
	return AUTHOR_HEADER_SETS.map((set) => `{${set.join(', ')}}`).join(', ');
}

/**
 * A request's author headers as `[lowercase name, value]` pairs in Chrome's
 * wire order, or `undefined` when there are none (`headers` absent or `{}`).
 * Values are normalized as `fetch()` does (leading and trailing spaces, tabs,
 * CR and LF removed); two names differing only in case are combined as
 * `a, b`, as Chrome does. Refused with a `recipe` error naming the header:
 * `headers` on a request that is not `fetch`, a value that is not a string
 * or not a non-empty printable ASCII string (CR/LF inside a value, header
 * injection, included), a name that is not a token, a forbidden name
 * (`FORBIDDEN`, `sec-*`, `proxy-*`), a name the header table sends itself,
 * and a name set whose order Chrome's hash gives was not measured (see
 * AUTHOR_HEADER_SETS).
 */
export function authorHeaders(
	kind: RequestKind | undefined,
	headers: unknown,
): [name: string, value: string][] | undefined {
	if (headers === undefined) return undefined;
	if (kind !== 'fetch') {
		throw new SearchcastError(
			'recipe',
			`headers are only for a fetch request (a page's script), not ${String(kind)}`,
		);
	}
	if (
		typeof headers !== 'object' ||
		headers === null ||
		Array.isArray(headers)
	) {
		throw new SearchcastError(
			'recipe',
			'headers must be an object of header names to string values',
		);
	}
	const combined = new Map<string, string>();
	for (const [name, raw] of Object.entries(headers)) {
		if (!TOKEN.test(name)) {
			throw new SearchcastError(
				'recipe',
				`header ${JSON.stringify(name)} is not a valid header name`,
			);
		}
		const lower = name.toLowerCase();
		if (
			FORBIDDEN.has(lower) ||
			lower.startsWith('sec-') ||
			lower.startsWith('proxy-')
		) {
			throw new SearchcastError(
				'recipe',
				`header ${name}: a page's script cannot set it (a forbidden request header)`,
			);
		}
		if (TABLE_NAMES.has(lower)) {
			throw new SearchcastError(
				'recipe',
				`header ${name}: the header table sends it${lower === 'content-type' ? ' (use the contentType option of a POST)' : ''}`,
			);
		}
		const value =
			typeof raw === 'string'
				? raw.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '')
				: raw;
		if (typeof value !== 'string' || !/^[\t\x20-\x7e]+$/.test(value)) {
			throw new SearchcastError(
				'recipe',
				`header ${name}: the value must be a non-empty printable ASCII string`,
			);
		}
		const before = combined.get(lower);
		combined.set(lower, before === undefined ? value : `${before}, ${value}`);
	}
	if (combined.size === 0) return undefined;
	const key = [...combined.keys()].sort().join(',');
	if (!PLACEMENT.has(key)) {
		throw new SearchcastError(
			'recipe',
			`author headers {${[...combined.keys()].sort().join(', ')}} are not supported: Chrome orders author headers by a hash of the whole name set, and only these measured sets are modelled: ${supported()}`,
		);
	}
	// Every measured set has one name, so its order is trivially the wire order.
	return [...combined];
}

/** The header of the `fetch` table that Chrome puts these (checked) author headers right after. */
export function authorHeaderSlot(headers: readonly [string, string][]): string {
	return PLACEMENT.get(
		headers
			.map(([name]) => name)
			.sort()
			.join(','),
	)!;
}
