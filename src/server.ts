import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import {SearchcastError, type Searchcast} from './searchcast.js';
import type {Recipe} from './recipe.js';

const STATUS: Record<SearchcastError['code'], number> = {
	blocked: 502,
	timeout: 504,
	recipe: 502,
	browser: 503,
};

function send(res: ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(json),
	});
	res.end(json);
}

/**
 * HTTP API:
 * - `GET /search?q=<query>&recipe=<name>`: run a recipe. `recipe` may be
 *   omitted when exactly one is loaded.
 * - `GET /recipes`: the loaded recipe names.
 * - `GET /health`: liveness.
 *
 * Failures are never an empty result list: they are a non-2xx status with
 * `{error: <code>, message}`, so callers can tell "blocked" from "nothing found".
 */
export interface ServerOptions {
	/**
	 * Call `onIdle` once no request has been in flight for this long. The
	 * clock starts when the server is created, so a server nobody talks to
	 * goes idle too.
	 */
	idleMs?: number;
	onIdle?: () => void;
}

export function createSearchcastServer(
	searchcast: Searchcast,
	recipes: Map<string, Recipe>,
	options: ServerOptions = {},
): Server {
	let active = 0;
	let timer: NodeJS.Timeout | undefined;
	const armIdle = () => {
		if (!options.idleMs || !options.onIdle) return;
		clearTimeout(timer);
		timer = setTimeout(
			() => active === 0 && options.onIdle?.(),
			options.idleMs,
		);
	};
	armIdle();

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		active++;
		clearTimeout(timer);
		res.once('close', () => {
			active--;
			if (active === 0) armIdle();
		});
		void handle(req, res);
	});
	server.once('close', () => clearTimeout(timer));
	return server;

	async function handle(req: IncomingMessage, res: ServerResponse) {
		const url = new URL(req.url ?? '/', 'http://localhost');
		if (req.method !== 'GET')
			return send(res, 405, {
				error: 'method',
				message: 'only GET is supported',
			});

		if (url.pathname === '/health') return send(res, 200, {ok: true});
		if (url.pathname === '/recipes')
			return send(res, 200, {recipes: [...recipes.keys()]});
		if (url.pathname !== '/search')
			return send(res, 404, {error: 'not-found', message: url.pathname});

		const query = url.searchParams.get('q')?.trim();
		if (!query) return send(res, 400, {error: 'input', message: 'missing q'});
		let name = url.searchParams.get('recipe') ?? undefined;
		if (!name && recipes.size === 1) name = [...recipes.keys()][0];
		if (!name)
			return send(res, 400, {error: 'input', message: 'missing recipe'});
		const recipe = recipes.get(name);
		if (!recipe)
			return send(res, 404, {error: 'unknown-recipe', message: name});

		try {
			send(res, 200, await searchcast.search(recipe, query));
		} catch (e) {
			if (e instanceof SearchcastError) {
				send(res, STATUS[e.code], {error: e.code, message: e.message});
			} else {
				send(res, 500, {error: 'internal', message: (e as Error).message});
			}
		}
	}
}
