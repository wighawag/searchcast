// An example searchcast code recipe for Marginalia Search (https://marginalia-search.com),
// an independent web search engine whose API is meant for programs:
// https://about.marginalia-search.com/article/api/ (read 2026-09-29; the current API
// again 2026-09-30).
//
// Terms, in short: the key `public` is for experimentation and its rate limit
// is shared by everyone who uses it (HTTP 503 when hit); ask for a free
// personal key (non-commercial) for regular use and set it in
// MARGINALIA_API_KEY. Results are provided under CC-BY-NC-SA 4.0.
//
// With MARGINALIA_API_KEY set, it calls the current API
// (`api2.marginalia-search.com/search?query=<query>`) with the key in an
// `API-Key` header, sent as a page's script would send it: a `fetch` request
// with an author header. The page it comes from is the API's own origin, so
// the request is same-origin and Chrome would send no CORS preflight (the API
// need not answer one). Without a key, it uses the URL-keyed API
// (`api.marginalia.nu/public/search/<query>`) with the shared `public` key, as
// before; Marginalia documents that API as deprecated but working "as long as
// the project does". There the key is part of the URL, so it appears in
// searchcast's error messages (they name the URL); a personal key never does,
// since it travels in the header.
//
// This is an example, not an engine bundled with searchcast: load it by path,
// or copy it next to your own recipes and adapt it.

const API = 'https://api2.marginalia-search.com';
const OLD_API = 'https://api.marginalia.nu';

export default {
	name: 'marginalia',
	async search(query, ctx) {
		const key = process.env.MARGINALIA_API_KEY;
		// Both APIs take 1 to 100 results.
		const count =
			ctx.maxResults === undefined
				? undefined
				: Math.min(100, Math.max(1, Math.floor(ctx.maxResults)));
		let data;
		try {
			if (key) {
				let url = `${API}/search?query=${encodeURIComponent(query)}`;
				if (count !== undefined) url += `&count=${count}`;
				data = await ctx.http.json(url, {
					kind: 'fetch',
					referer: `${API}/`,
					headers: {'API-Key': key},
				});
			} else {
				let url = `${OLD_API}/public/search/${encodeURIComponent(query)}`;
				if (count !== undefined) url += `?count=${count}`;
				data = await ctx.http.json(url, {kind: 'document'});
			}
		} catch (error) {
			// ctx.http maps 429 to `blocked` already; a 503 (a `transport` error
			// there) is how this API reports its rate limit, so it is `blocked` too
			// (the engine cools down instead of being retried at once).
			if (error?.kind === 'transport' && /\bHTTP 503\b/.test(error.message))
				ctx.blocked('HTTP 503, the rate limit of the API key');
			throw error;
		}
		if (!Array.isArray(data?.results))
			ctx.recipeError('no "results" array in the API response');
		return data.results
			.filter((r) => typeof r?.url === 'string' && r.url)
			.map((r) => ({
				title: typeof r.title === 'string' && r.title ? r.title : r.url,
				url: r.url,
				...(typeof r.description === 'string' &&
					r.description && {snippet: r.description}),
			}));
	},
};
