// The pinned browser identity: the libcurl-impersonate target (TLS and HTTP/2
// side) and the header tables (header side) both derive from CHROME_MAJOR, so
// they cannot drift apart (ADR 0001). Upgrading Chrome means changing
// CHROME_MAJOR and re-checking every table against a capture of that version.
//
// Source of the tables: work/notes/findings/impers-fingerprint-vs-curl-cffi.md
// (net-log capture of real Chromium on Linux, 2026-09-28; order and per-kind
// structure), with branded Chrome values on Linux. Same-site and cross-site
// `fetch` and `script`: work/notes/findings/sec-fetch-site-by-initiator.md
// (2026-09-29). POST `fetch` and its CORS preflight:
// work/notes/findings/post-requests.md (2026-09-29). Author headers on a
// `fetch` (placement, and the preflight they cause):
// work/notes/findings/fetch-author-headers.md (2026-09-30), rules in
// author-headers.ts. Plain `http://` targets (no secure-context headers,
// HTTP/1.1 casing, mixed content refused, the referer downgrade):
// work/notes/findings/http-target-headers.md (2026-10-26), see
// `targetTable`. Not measured, so not offered: navigations to another
// origin, navigation (form) POST, non-English `accept-language`, author-header
// name sets other than the measured ones.

import {
	authorHeaders,
	authorHeaderSlot,
	type AuthorHeaders,
} from './author-headers.js';
import {SearchcastError} from './errors.js';

/** The pinned Chrome major version. */
export const CHROME_MAJOR = 146;

/** The libcurl-impersonate target, never the moving `chrome` alias. */
export const IMPERSONATE_TARGET = `chrome${CHROME_MAJOR}`;

/**
 * What a request is from the browser's point of view; selects its header
 * table. `document` is a typed-URL top-level navigation, the other kinds come
 * from a page and carry that page as `referer`.
 */
export type RequestKind =
	'document' | 'same-origin-navigation' | 'fetch' | 'script';

export const REQUEST_KINDS: readonly RequestKind[] = [
	'document',
	'same-origin-navigation',
	'fetch',
	'script',
];

/**
 * The `sec-ch-ua` value Chrome sends for a major version: Chromium's brand
 * GREASE, seeded by the major version (`GenerateBrandVersionList` and
 * `GetGreasedUserAgentBrandVersion` in
 * components/embedder_support/user_agent_utils.cc).
 */
export function secChUa(major: number): string {
	const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
	const versions = ['8', '99', '24'];
	const orders = [
		[0, 1, 2],
		[0, 2, 1],
		[1, 0, 2],
		[1, 2, 0],
		[2, 0, 1],
		[2, 1, 0],
	];
	const grease = `"Not${chars[major % 11]}A${chars[(major + 1) % 11]}Brand";v="${versions[major % 3]}"`;
	const order = orders[major % 6];
	const list: string[] = [];
	list[order[0]] = grease;
	list[order[1]] = `"Chromium";v="${major}"`;
	list[order[2]] = `"Google Chrome";v="${major}"`;
	return list.join(', ');
}

const UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const SEC_CH_UA = secChUa(CHROME_MAJOR);
const NAV_ACCEPT =
	'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const ACCEPT_ENCODING = 'gzip, deflate, br, zstd';
/** `accept-encoding` to a target that is not potentially trustworthy. */
const INSECURE_ACCEPT_ENCODING = 'gzip, deflate';
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

/** A header table: ordered `[name, value]` pairs, sent exactly as listed. */
export type HeaderTable = [name: string, value: string][];

/**
 * How a page-initiated request relates to the page it comes from (its
 * `referer`): the value of Chrome's `sec-fetch-site` header.
 */
export type FetchSite = 'same-origin' | 'same-site' | 'cross-site';

export const FETCH_SITES: readonly FetchSite[] = [
	'same-origin',
	'same-site',
	'cross-site',
];

/**
 * Second-level labels that, under a two-letter country TLD, are part of the
 * public suffix (`example.co.uk`, `example.com.au`, `example.ac.jp`).
 */
const CC_SECOND_LEVEL = new Set([
	'ac',
	'co',
	'com',
	'edu',
	'go',
	'gob',
	'gov',
	'ltd',
	'mil',
	'ne',
	'net',
	'or',
	'org',
	'plc',
	'sch',
]);

/**
 * The registrable domain ("site" without the scheme) of a host, by a small
 * built-in rule instead of the public suffix list (which searchcast does not
 * ship): an IP address or a single-label host is its own site; otherwise the
 * last two labels, or the last three when the TLD has two letters and the
 * label before it is a common second level (`co.uk`, `com.au`, ...).
 *
 * Known limit: private suffixes (`github.io`, hosting platforms) and the
 * rarer public ones are not known, so two customers of one platform
 * (`alice.github.io`, `bob.github.io`) come out `same-site` where Chrome says
 * `cross-site`. A caller who knows better passes `fetchSite` explicitly.
 */
export function registrableDomain(host: string): string {
	const name = host.toLowerCase().replace(/\.$/, '');
	if (name.startsWith('[') || /^[\d.]+$/.test(name)) return name;
	const labels = name.split('.');
	const tld = labels.at(-1)!;
	const keep =
		labels.length >= 3 &&
		tld.length === 2 &&
		CC_SECOND_LEVEL.has(labels.at(-2)!)
			? 3
			: 2;
	return labels.slice(-keep).join('.');
}

/**
 * `sec-fetch-site` for a request to `url` from the page `referer`, as Chrome
 * computes it: same scheme, host and port is `same-origin`; same scheme and
 * registrable domain (any port) is `same-site` (sites are schemeful: `http`
 * to `https` is `cross-site`); anything else is `cross-site`.
 */
export function fetchSite(url: string | URL, referer: string | URL): FetchSite {
	const target = new URL(url);
	const page = new URL(referer);
	if (target.origin === page.origin) return 'same-origin';
	if (
		target.protocol === page.protocol &&
		registrableDomain(target.hostname) === registrableDomain(page.hostname)
	) {
		return 'same-site';
	}
	return 'cross-site';
}

/**
 * Whether Chrome treats `url` as potentially trustworthy (W3C Secure
 * Contexts), and so sends it the secure-context headers (`sec-fetch-*`, the
 * client hints, `br` and `zstd` in `accept-encoding`): every `https:` URL,
 * and an `http:` URL to a loopback host, that is `localhost`, a name ending
 * in `.localhost`, an IPv4 address in 127.0.0.0/8 or `[::1]` (Chromium's
 * `net::HostStringIsLocalhost`; measured for `localhost`, `foo.localhost`,
 * `127.0.0.1` and `127.0.0.2`, see work/notes/findings/http-target-headers.md).
 * Any other `http:` URL is not.
 */
export function isPotentiallyTrustworthy(url: string | URL): boolean {
	const target = new URL(url);
	if (target.protocol === 'https:') return true;
	if (target.protocol !== 'http:') return false;
	const host = target.hostname.toLowerCase().replace(/\.$/, '');
	return (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '[::1]' ||
		/^127\.\d+\.\d+\.\d+$/.test(host)
	);
}

/**
 * The secure table turned into the one Chrome sends to `target`, and the
 * wire spelling libcurl must be given for it. A target that is not
 * potentially trustworthy (`isPotentiallyTrustworthy`) gets no client hints,
 * no `sec-fetch-*` (`keepFetchMode` keeps `sec-fetch-mode`, which a preflight
 * still carries) and `accept-encoding: gzip, deflate`. An `http:` target is
 * HTTP/1.1 (Chrome has no cleartext HTTP/2): `connection: keep-alive` first,
 * no `priority`, and names spelled as Chrome spells them there: each
 * hyphen-separated word capitalized (`User-Agent`, `Sec-Fetch-Site`), except
 * the client hints, which stay lowercase (`sec-ch-ua`); `content-type` is
 * `Content-Type`, and author headers keep the spelling the recipe gave them
 * (`names`), as Chrome keeps the spelling a page's script gave them. `Host`
 * is not in the table: libcurl sends it first, where Chrome does.
 * Source: work/notes/findings/http-target-headers.md.
 */
function targetTable(
	table: HeaderTable,
	target: URL | undefined,
	options: {keepFetchMode?: boolean; names?: Map<string, string>} = {},
): HeaderTable {
	if (target === undefined || target.protocol !== 'http:') return table;
	const secure = isPotentiallyTrustworthy(target);
	const out: HeaderTable = [['connection', 'keep-alive']];
	for (const [name, value] of table) {
		if (name === 'priority') continue;
		if (!secure) {
			if (name.startsWith('sec-ch-')) continue;
			if (
				name.startsWith('sec-fetch-') &&
				!(options.keepFetchMode && name === 'sec-fetch-mode')
			)
				continue;
		}
		out.push([
			name,
			name === 'accept-encoding' && !secure ? INSECURE_ACCEPT_ENCODING : value,
		]);
	}
	return out.map(([name, value]) => [
		options.names?.get(name) ??
			(name.startsWith('sec-ch-')
				? name
				: name.replace(
						/(^|-)([a-z])/g,
						(_, dash, c) => dash + c.toUpperCase(),
					)),
		value,
	]);
}

/**
 * The page and target of a page-initiated request, checked against Chrome's
 * mixed-content blocking: a `fetch` or `script` from an `https:` page to an
 * `http:` URL that is not potentially trustworthy is never sent by Chrome, so
 * it is a `recipe` error here. `downgrade` is an `https:` page loading an
 * `http:` URL (a loopback one, the only kind not blocked): Chrome's default
 * referrer policy (`strict-origin-when-cross-origin`) then sends no
 * `referer`. A referer that does not parse (allowed with `fetchSite`) or a
 * missing `url` is neither.
 */
function schemes(
	kind: RequestKind,
	context: {referer?: string; url?: string | URL},
): {target: URL | undefined; downgrade: boolean} {
	const target = context.url === undefined ? undefined : new URL(context.url);
	let page: URL | undefined;
	try {
		page = context.referer === undefined ? undefined : new URL(context.referer);
	} catch {
		page = undefined;
	}
	const downgrade = page?.protocol === 'https:' && target?.protocol === 'http:';
	if (
		downgrade &&
		(kind === 'fetch' || kind === 'script') &&
		!isPotentiallyTrustworthy(target!)
	) {
		throw new SearchcastError(
			'recipe',
			`a ${kind} request from an https page (${page!.origin}) to ${target!.origin} is mixed content, which Chrome blocks: it is not sent`,
		);
	}
	return {target, downgrade};
}

function pageUrl(kind: RequestKind, referer: string): URL {
	try {
		return new URL(referer);
	} catch {
		throw new SearchcastError(
			'recipe',
			`a ${kind} request to another origin needs an absolute referer URL, got ${JSON.stringify(referer)}`,
		);
	}
}

/** The request methods searchcast sends; `POST` only for the `fetch` kind. */
export type RequestMethod = 'GET' | 'POST';

/** The `content-type` Chrome's `fetch()` gives a string body sent without one. */
export const TEXT_BODY_CONTENT_TYPE = 'text/plain;charset=UTF-8';

const SAFELISTED_CONTENT_TYPES = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
]);

/**
 * Whether a `content-type` value is CORS-safelisted (the Fetch standard's
 * "CORS-safelisted request-header"): at most 128 bytes, no CORS-unsafe byte,
 * and a MIME essence of `application/x-www-form-urlencoded`,
 * `multipart/form-data` or `text/plain`. A cross-origin POST with any other
 * `content-type` is preflighted.
 */
export function isSafelistedContentType(value: string): boolean {
	if (new TextEncoder().encode(value).length > 128) return false;
	if (/[\x00-\x08\x0a-\x1f"():<>?@[\\\]{}\x7f]/.test(value)) return false;
	const essence = value.split(';')[0]!.trim().toLowerCase();
	return SAFELISTED_CONTENT_TYPES.has(essence);
}

/** The `sec-fetch-site` of a `fetch`/`script` request (see `headerTable`). */
function siteOf(
	kind: RequestKind,
	context: {referer: string; url?: string | URL; fetchSite?: FetchSite},
): FetchSite {
	return (
		context.fetchSite ??
		(context.url === undefined
			? 'same-origin'
			: fetchSite(context.url, pageUrl(kind, context.referer)))
	);
}

/**
 * The CORS preflight (`OPTIONS`) Chrome sends before a `fetch` request, or
 * `undefined` when it sends none: only a request that is not same-origin and
 * carries a header that is not CORS-safelisted is preflighted, that is an
 * author header (every supported one is non-safelisted: `api-key`,
 * `authorization`) or, on a POST, a `content-type` that is not
 * (`isSafelistedContentType`). GET and POST are safelisted methods, so the
 * method alone never causes one. Chrome sends it without credentials (no
 * cookie, no `sec-fetch-storage-access`, and on a connection of its own),
 * with no client hints, `access-control-request-method` the request's method
 * and `access-control-request-headers` the non-safelisted header names,
 * lowercased, sorted and comma-joined without spaces (`api-key,content-type`).
 * `method` defaults to POST when `contentType` is given, else GET. Sources:
 * work/notes/findings/post-requests.md and fetch-author-headers.md.
 *
 * To an `http:` `url` (see `targetTable`): HTTP/1.1 spelling, no `priority`,
 * and, unless the target is potentially trustworthy, no `sec-fetch-site` or
 * `sec-fetch-dest` (`sec-fetch-mode: cors` stays) and `accept-encoding:
 * gzip, deflate`; from an `https:` page, no `referer`
 * (work/notes/findings/http-target-headers.md).
 */
export function preflightTable(context: {
	referer: string;
	url?: string | URL;
	fetchSite?: FetchSite;
	method?: RequestMethod;
	contentType?: string;
	/** Author headers (see `authorHeaders`); checked here too. */
	headers?: AuthorHeaders;
}): HeaderTable | undefined {
	const {contentType} = context;
	const method = context.method ?? (contentType === undefined ? 'GET' : 'POST');
	const names = (authorHeaders('fetch', context.headers) ?? []).map(
		([name]) => name,
	);
	if (
		method === 'POST' &&
		contentType !== undefined &&
		!isSafelistedContentType(contentType)
	)
		names.push('content-type');
	if (names.length === 0) return undefined;
	const site = siteOf('fetch', context);
	if (site === 'same-origin') return undefined;
	const {target, downgrade} = schemes('fetch', context);
	const origin = pageUrl('fetch', context.referer).origin;
	return targetTable(
		[
			['accept', '*/*'],
			['access-control-request-method', method],
			['access-control-request-headers', names.sort().join(',')],
			['origin', origin],
			['user-agent', UA],
			['sec-fetch-mode', 'cors'],
			['sec-fetch-site', site],
			['sec-fetch-dest', 'empty'],
			...(downgrade ? [] : [['referer', `${origin}/`] as [string, string]]),
			['accept-encoding', ACCEPT_ENCODING],
			['accept-language', ACCEPT_LANGUAGE],
			['priority', 'u=1, i'],
		],
		target,
		{keepFetchMode: true},
	);
}

/**
 * The exact headers Chrome sends for `kind`, in order. `cookie` (when the
 * session has any) goes where Chrome puts it: after `accept-language`, before
 * `priority` (last for `script`, which has no `priority`).
 *
 * For `fetch` and `script`, `sec-fetch-site` is `context.fetchSite` when
 * given, else derived from `context.url` relative to the `referer` (see
 * `fetchSite()`), else `same-origin`. A request that is not same-origin sends
 * the page's origin as `referer` (Chrome's default `strict-origin-when-cross-
 * origin`), and a `fetch` adds `origin`; a cross-site one adds
 * `sec-fetch-storage-access: active` (a credentialed request, as searchcast
 * always sends the session's cookies). `same-origin-navigation` is always
 * same-origin and `document` always `none`.
 *
 * `method: 'POST'` (`fetch` only) is Chrome's `fetch(url, {method: 'POST',
 * body, credentials: 'include'})`: `content-length` first, `content-type`
 * (when there is one) between `sec-ch-ua` and `sec-ch-ua-mobile`, and
 * `origin` ALWAYS, same-origin included (work/notes/findings/post-requests.md).
 *
 * `headers` (`fetch` only) are the request's author headers, checked and
 * placed as Chrome places them by `authorHeaders` (author-headers.ts): each
 * supported set right after `sec-ch-ua-platform`, lowercased
 * (work/notes/findings/fetch-author-headers.md).
 *
 * An `http:` `url` gets the table Chrome sends there
 * (work/notes/findings/http-target-headers.md): HTTP/1.1, so
 * `connection: keep-alive` first, no `priority` and Chrome's HTTP/1.1
 * spelling of every name (see `targetTable`); and when the target is not
 * potentially trustworthy (`isPotentiallyTrustworthy`: not a loopback host),
 * no client hints, no `sec-fetch-*`, `accept-encoding: gzip, deflate`, and
 * author headers right before `accept`. A `fetch` or `script` from an
 * `https:` page to such a URL is mixed content, which Chrome blocks: a
 * `recipe` error. From an `https:` page to a loopback `http:` URL there is
 * no `referer` (the default policy's downgrade rule). Without `url`, the
 * target is taken to be `https:`.
 */
export function headerTable(
	kind: RequestKind,
	context: {
		referer?: string;
		cookie?: string;
		/** The request URL, to derive `sec-fetch-site` from. */
		url?: string | URL;
		/** Overrides the derived `sec-fetch-site` (`fetch` and `script` only). */
		fetchSite?: FetchSite;
		/** Default `GET`. */
		method?: RequestMethod;
		/** A POST's `content-type`, if it has one. */
		contentType?: string;
		/** A POST's body length in bytes. Default 0. */
		contentLength?: number;
		/** Author headers (`fetch` only; see `authorHeaders`). */
		headers?: AuthorHeaders;
	},
): HeaderTable {
	const {referer, cookie} = context;
	const post = context.method === 'POST';
	const author = authorHeaders(kind, context.headers);
	const {target, downgrade} = schemes(kind, context);
	const secure = target === undefined || isPotentiallyTrustworthy(target);
	if (post && kind !== 'fetch') {
		throw new SearchcastError(
			'recipe',
			`a POST must be a fetch request, not ${kind}`,
		);
	}
	if (kind !== 'document' && !referer) {
		throw new SearchcastError(
			'recipe',
			`a ${kind} request needs a referer (the page it comes from)`,
		);
	}
	if (context.fetchSite !== undefined) {
		const allowed: readonly FetchSite[] =
			kind === 'fetch' || kind === 'script' ? FETCH_SITES : ['same-origin'];
		if (kind === 'document' || !allowed.includes(context.fetchSite)) {
			throw new SearchcastError(
				'recipe',
				`fetchSite ${JSON.stringify(context.fetchSite)} is not allowed for a ${kind} request (${kind === 'document' ? 'none' : allowed.join(', ')})`,
			);
		}
	}
	const tail = (priority?: string): HeaderTable => [
		['accept-encoding', ACCEPT_ENCODING],
		['accept-language', ACCEPT_LANGUAGE],
		...(cookie ? [['cookie', cookie] as [string, string]] : []),
		...(priority ? [['priority', priority] as [string, string]] : []),
	];
	if (kind === 'document' || kind === 'same-origin-navigation') {
		return targetTable(
			[
				['sec-ch-ua', SEC_CH_UA],
				['sec-ch-ua-mobile', '?0'],
				['sec-ch-ua-platform', '"Linux"'],
				['upgrade-insecure-requests', '1'],
				['user-agent', UA],
				['accept', NAV_ACCEPT],
				['sec-fetch-site', kind === 'document' ? 'none' : 'same-origin'],
				['sec-fetch-mode', 'navigate'],
				['sec-fetch-user', '?1'],
				['sec-fetch-dest', 'document'],
				...(kind === 'document' || downgrade
					? []
					: [['referer', referer!] as [string, string]]),
				...tail('u=0, i'),
			],
			target,
		);
	}
	const site = siteOf(kind, {...context, referer: referer!});
	const origin = site === 'same-origin' ? '' : pageUrl(kind, referer!).origin;
	const contentType = context.contentType;
	const table: HeaderTable = [
		...(post
			? [
					['content-length', String(context.contentLength ?? 0)] as [
						string,
						string,
					],
				]
			: []),
		['sec-ch-ua-platform', '"Linux"'],
		['user-agent', UA],
		['sec-ch-ua', SEC_CH_UA],
		...(post && contentType !== undefined
			? [['content-type', contentType] as [string, string]]
			: []),
		['sec-ch-ua-mobile', '?0'],
		['accept', '*/*'],
		...(kind === 'fetch' && (origin || post)
			? [
					['origin', origin || pageUrl(kind, referer!).origin] as [
						string,
						string,
					],
				]
			: []),
		['sec-fetch-site', site],
		['sec-fetch-mode', kind === 'fetch' ? 'cors' : 'no-cors'],
		['sec-fetch-dest', kind === 'fetch' ? 'empty' : 'script'],
		...(site === 'cross-site'
			? [['sec-fetch-storage-access', 'active'] as [string, string]]
			: []),
		...(downgrade
			? []
			: [['referer', origin ? `${origin}/` : referer!] as [string, string]]),
		...tail(kind === 'fetch' ? 'u=1, i' : undefined),
	];
	if (author) {
		// Not potentially trustworthy: no client hints in Chrome's hash order,
		// and the measured sets land right before `accept` (after any
		// `content-type`).
		const at = secure
			? table.findIndex(([name]) => name === authorHeaderSlot(author)) + 1
			: table.findIndex(([name]) => name === 'accept');
		table.splice(at, 0, ...author);
	}
	return targetTable(table, target, {names: spellings(context.headers)});
}

/** Each author header's lowercase name to the spelling the recipe gave it first. */
function spellings(headers: AuthorHeaders | undefined): Map<string, string> {
	const names = new Map<string, string>();
	for (const name of Object.keys(headers ?? {}))
		if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
	return names;
}
