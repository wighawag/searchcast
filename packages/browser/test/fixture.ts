import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';

const page = (body: string) =>
	`<!doctype html><html><head><meta charset="utf-8"><title>fixture</title></head><body>${body}</body></html>`;

function escape(s: string): string {
	return s.replace(
		/[&<>"]/g,
		(c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!,
	);
}

/**
 * A tiny search site:
 * - `/search?q=`: results rendered by JS after a delay (so callers must poll).
 *   `q=nothing` renders a no-results page; `q=blockme` redirects to a
 *   challenge page; `q=challenge` shows an inline challenge; `q=hang` never renders.
 * - `/form`: a search form (text input + button) that GETs `/search`.
 * - `/webdriver`: echoes `navigator.webdriver` into `#webdriver[data-value]`.
 */
export async function startFixture(): Promise<{
	url: string;
	server: Server;
	queries: string[];
}> {
	const queries: string[] = [];
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const html = (body: string) => {
			res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
			res.end(page(body));
		};
		if (url.pathname === '/form') {
			return html(`<form action="/search" method="get">
				<input name="q" type="text" value="stale">
				<button id="go" type="submit">Search</button>
			</form>`);
		}
		if (url.pathname === '/challenge')
			return html('<div id="captcha">prove it</div>');
		if (url.pathname === '/webdriver') {
			return html(`<script>
				const el = document.createElement('div');
				el.id = 'webdriver';
				el.dataset.value = String(navigator.webdriver);
				el.dataset.url = location.href;
				document.body.appendChild(el);
			</script>`);
		}
		if (url.pathname === '/search') {
			const q = url.searchParams.get('q') ?? '';
			queries.push(q);
			if (q === 'blockme') {
				res.writeHead(302, {location: '/challenge'});
				return res.end();
			}
			if (q === 'challenge')
				return html('<div class="modal challenge">are you human?</div>');
			if (q === 'hang') return html('<div>loading forever</div>');
			if (q === 'nothing') {
				return html(`<div id="app"></div><script>
					setTimeout(() => { document.getElementById('app').innerHTML = '<p class="no-results">No results</p>'; }, 200);
				</script>`);
			}
			const items = [1, 2, 3]
				.map(
					(i) =>
						`<article class="r"><h2><a class="t" href="/doc/${i}?q=${encodeURIComponent(q)}">${escape(q)} result ${i}</a></h2><p class="s">snippet   ${i}\n about ${escape(q)}</p></article>`,
				)
				.join('');
			// One item with no link: must be skipped, not returned half-empty.
			const broken = '<article class="r"><h2>no link here</h2></article>';
			return html(`<div id="app"></div><script>
				setTimeout(() => { document.getElementById('app').innerHTML = ${JSON.stringify(broken + items)}; }, 300);
			</script>`);
		}
		res.writeHead(404);
		res.end();
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const {port} = server.address() as AddressInfo;
	return {url: `http://127.0.0.1:${port}`, server, queries};
}
