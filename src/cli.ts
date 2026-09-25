#!/usr/bin/env node
import {mkdtempSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {findChrome, type BrowserOptions} from './browser.js';
import {Searchcast, SearchcastError} from './searchcast.js';
import {RecipeError, loadRecipeFile, loadRecipes} from './recipe.js';
import {createSearchcastServer} from './server.js';
import {startXvfb, type Xvfb} from './xvfb.js';

const USAGE = `searchcast: turn a web search form into a JSON API by driving a real browser

Usage:
  searchcast serve --recipes <file|dir> [--recipes ...] [options]
  searchcast query --recipe <file> [options] <query...>

Serve options:
  --listen <where>       host:port, /path.sock, or \`systemd\` for a socket passed by
                         systemd socket activation (default 127.0.0.1:8931)
  --idle-exit <seconds>  Exit after this long with no request in flight (pairs
                         with socket activation: systemd starts it again on demand)

Browser options:
  --chrome <path>        Browser executable (default $SEARCHCAST_CHROME, then chromium/chrome on PATH)
  --profile <dir>        Persistent profile (default $XDG_STATE_HOME/searchcast/profile)
  --ephemeral            Use a fresh profile in a temporary directory, deleted on exit
  --proxy <url>          Proxy for all browser traffic, e.g. socks5://127.0.0.1:1080
  --xvfb <path>          Start this Xvfb as a private, authenticated display for the browser
  --headless             Run headless (easier to detect; for tests and quick checks)
  --concurrency <n>      Maximum simultaneous tabs (default 2)
  --chrome-arg <arg>     Extra browser argument (repeatable)

Without --headless the browser needs a display: pass --xvfb on a machine without one.
`;

function fail(message: string): never {
	process.stderr.write(`searchcast: ${message}\n`);
	process.exit(2);
}

function defaultProfile(): string {
	const state =
		process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
	return join(state, 'searchcast', 'profile');
}

async function main(argv: string[]): Promise<void> {
	const {values, positionals} = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			recipes: {type: 'string', multiple: true},
			recipe: {type: 'string'},
			listen: {type: 'string', default: '127.0.0.1:8931'},
			chrome: {type: 'string'},
			profile: {type: 'string'},
			proxy: {type: 'string'},
			headless: {type: 'boolean', default: false},
			ephemeral: {type: 'boolean', default: false},
			xvfb: {type: 'string'},
			'idle-exit': {type: 'string'},
			concurrency: {type: 'string', default: '2'},
			'chrome-arg': {type: 'string', multiple: true},
			help: {type: 'boolean', short: 'h'},
		},
	});
	const [command, ...rest] = positionals;
	if (values.help || !command) {
		process.stdout.write(USAGE);
		return;
	}

	const executable = values.chrome ?? findChrome();
	if (!executable)
		fail('no browser found: pass --chrome or set SEARCHCAST_CHROME');
	const concurrency = Number(values.concurrency);
	if (!Number.isInteger(concurrency) || concurrency < 1)
		fail('--concurrency must be a positive integer');
	if (values.ephemeral && values.profile) {
		fail('--ephemeral and --profile are mutually exclusive');
	}
	if (values.headless && values.xvfb) {
		fail('--headless and --xvfb are mutually exclusive');
	}
	let idleMs: number | undefined;
	if (values['idle-exit'] !== undefined) {
		const seconds = Number(values['idle-exit']);
		if (!Number.isFinite(seconds) || seconds <= 0) {
			fail('--idle-exit must be a positive number of seconds');
		}
		idleMs = seconds * 1000;
	}

	const listen = values.listen;
	if (command === 'serve' && listen === 'systemd') {
		// sd_listen_fds(3): the first passed socket is fd 3. Checked before
		// anything is started, so a misconfigured unit fails fast and clean.
		const fds = Number(process.env.LISTEN_FDS);
		const pid = process.env.LISTEN_PID;
		if (!(fds >= 1) || (pid !== undefined && Number(pid) !== process.pid)) {
			fail(
				'--listen systemd needs a socket from systemd socket activation (LISTEN_FDS)',
			);
		}
	}

	// Everything that must be undone on the way out, in reverse order.
	const cleanups: Array<() => Promise<void> | void> = [];
	const cleanup = async () => {
		for (const step of cleanups.reverse()) await step();
	};

	let userDataDir = values.profile ?? defaultProfile();
	if (values.ephemeral) {
		userDataDir = mkdtempSync(join(tmpdir(), 'searchcast-profile-'));
		const remove = () => rmSync(userDataDir, {recursive: true, force: true});
		process.once('exit', remove);
		cleanups.push(remove);
	}
	let xvfb: Xvfb | undefined;
	if (values.xvfb) {
		xvfb = await startXvfb({executable: values.xvfb});
		cleanups.push(() => xvfb!.close());
	}
	const browser: BrowserOptions = {
		executable,
		userDataDir,
		proxy: values.proxy,
		headless: values.headless,
		extraArgs: values['chrome-arg'],
		env: xvfb?.env,
	};
	const searchcast = new Searchcast({browser, concurrency});
	cleanups.push(() => searchcast.close());

	if (command === 'query') {
		if (!values.recipe) fail('query needs --recipe <file>');
		const query = rest.join(' ').trim();
		if (!query) fail('query needs a query');
		try {
			const response = await searchcast.search(
				loadRecipeFile(values.recipe),
				query,
			);
			process.stdout.write(JSON.stringify(response, null, 2) + '\n');
		} finally {
			await cleanup();
		}
		return;
	}

	if (command === 'serve') {
		if (!values.recipes?.length) fail('serve needs --recipes <file|dir>');
		const recipes = loadRecipes(values.recipes);
		if (recipes.size === 0) fail('no recipes found');
		let stopping = false;
		const shutdown = async (reason: string) => {
			if (stopping) return;
			stopping = true;
			process.stderr.write(`searchcast: stopping (${reason})\n`);
			server.close();
			await cleanup();
			process.exit(0);
		};
		const server = createSearchcastServer(searchcast, recipes, {
			idleMs,
			onIdle: () => void shutdown('idle'),
		});
		process.once('SIGINT', () => void shutdown('SIGINT'));
		process.once('SIGTERM', () => void shutdown('SIGTERM'));
		await searchcast.warmup();
		if (listen === 'systemd') {
			server.listen({fd: 3});
		} else if (listen.startsWith('/')) {
			server.listen(listen);
		} else {
			const at = listen.lastIndexOf(':');
			const host = at > 0 ? listen.slice(0, at) : '127.0.0.1';
			const port = Number(at >= 0 ? listen.slice(at + 1) : listen);
			if (!Number.isInteger(port)) fail(`bad --listen ${listen}`);
			server.listen(port, host);
		}
		server.once('listening', () => {
			process.stderr.write(
				`searchcast: serving ${[...recipes.keys()].join(', ')} on ${listen}\n`,
			);
		});
		return;
	}

	fail(`unknown command ${command}\n\n${USAGE}`);
}

main(process.argv.slice(2)).catch((e: unknown) => {
	if (e instanceof RecipeError) fail(e.message);
	if (e instanceof SearchcastError) fail(`${e.code}: ${e.message}`);
	fail((e as Error).stack ?? String(e));
});
