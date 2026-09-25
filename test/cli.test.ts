import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {request} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {findChrome} from '../src/browser.js';
import {startFixture} from './fixture.js';

// End-to-end tests of the CLI as a real process (the built dist/cli.js, which
// `pnpm test` builds first). Skipped without a browser, like the browser tests.
const chrome = findChrome();
const cli = resolve(import.meta.dirname, '..', 'dist', 'cli.js');
const chromeArgs = (process.env.SEARCHCAST_TEST_CHROME_ARGS ?? '')
	.split(' ')
	.filter(Boolean)
	.map((a) => `--chrome-arg=${a}`);

function onPath(name: string): string | undefined {
	const found = spawnSync('sh', ['-c', `command -v ${name}`], {
		encoding: 'utf8',
	});
	return found.status === 0 ? found.stdout.trim() : undefined;
}
const xvfb = process.env.SEARCHCAST_TEST_XVFB ?? onPath('Xvfb');
const socketActivate = onPath('systemd-socket-activate');
// Can we make a network namespace with no usable loopback, as our own uid?
const unshare = onPath('unshare');
const noLoopback =
	unshare &&
	spawnSync(unshare, ['-Un', '--map-current-user', 'true']).status === 0
		? unshare
		: undefined;
// A python that can `import searx` (e.g. PYTHONPATH pointing at a SearXNG install).
const searxPython = process.env.SEARCHCAST_TEST_SEARXNG_PYTHON;

/** GET over a unix socket. */
function getUnix(
	socketPath: string,
	path: string,
): Promise<{status: number; body: any}> {
	return new Promise((resolvePromise, reject) => {
		const req = request({socketPath, path, method: 'GET'}, (res) => {
			let data = '';
			res.on('data', (c) => (data += c));
			res.on('end', () =>
				resolvePromise({status: res.statusCode ?? 0, body: JSON.parse(data)}),
			);
		});
		req.on('error', reject);
		req.end();
	});
}

/** Wait until the process prints `searchcast: serving`, or fail with its output. */
function waitServing(child: ChildProcess): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		let out = '';
		const timer = setTimeout(
			() => reject(new Error(`not serving in time:\n${out}`)),
			30_000,
		);
		child.stderr!.on('data', (chunk) => {
			out += chunk;
			if (out.includes('searchcast: serving')) {
				clearTimeout(timer);
				resolvePromise();
			}
		});
		child.once('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`exited early (${code}):\n${out}`));
		});
	});
}

function exitCode(
	child: ChildProcess,
	timeoutMs: number,
): Promise<number | null> {
	if (child.exitCode !== null) return Promise.resolve(child.exitCode);
	return new Promise((resolvePromise, reject) => {
		const timer = setTimeout(
			() => reject(new Error('did not exit in time')),
			timeoutMs,
		);
		child.once('exit', (code) => {
			clearTimeout(timer);
			resolvePromise(code);
		});
	});
}

describe.skipIf(!chrome)('the CLI', () => {
	let site: Awaited<ReturnType<typeof startFixture>>;
	let work: string;
	let recipesDir: string;
	const children: ChildProcess[] = [];

	beforeAll(async () => {
		site = await startFixture();
		work = mkdtempSync(join(tmpdir(), 'searchcast-cli-'));
		recipesDir = join(work, 'recipes');
		spawnSync('mkdir', ['-p', recipesDir]);
		writeFileSync(
			join(recipesDir, 'web.json'),
			JSON.stringify({
				navigate: {url: `${site.url}/search?q={query}`},
				ready: 'article.r a.t',
				blocked: ['#captcha', '.challenge'],
				blockedUrl: ['/challenge$'],
				results: {
					item: 'article.r',
					fields: {
						title: {selector: 'h2'},
						url: {selector: 'a.t', attr: 'href'},
					},
				},
			}),
		);
		writeFileSync(
			join(recipesDir, 'webdriver.json'),
			JSON.stringify({
				navigate: {url: `${site.url}/webdriver?q={query}`},
				ready: '#webdriver',
				results: {
					item: '#webdriver',
					fields: {title: {attr: 'data-value'}, url: {attr: 'data-url'}},
				},
			}),
		);
	});

	afterAll(async () => {
		// SIGTERM first and WAIT: searchcast closes its browser and deletes its
		// ephemeral profile on SIGTERM; a SIGKILL would orphan both.
		await Promise.all(
			children.map(async (child) => {
				if (child.exitCode !== null || child.signalCode !== null) return;
				child.kill('SIGTERM');
				await exitCode(child, 10_000).catch(() => child.kill('SIGKILL'));
			}),
		);
		site?.server.close();
		if (work) rmSync(work, {recursive: true, force: true});
	});

	function serve(args: string[], env: NodeJS.ProcessEnv = {}): ChildProcess {
		const child = spawn(
			process.execPath,
			[
				cli,
				'serve',
				'--recipes',
				recipesDir,
				'--chrome',
				chrome!,
				...chromeArgs,
				...args,
			],
			{
				stdio: ['ignore', 'ignore', 'pipe'],
				env: {...process.env, ...env},
			},
		);
		children.push(child);
		return child;
	}

	it('serves a unix socket with an ephemeral profile, then exits when idle and deletes the profile', async () => {
		const tmp = mkdtempSync(join(work, 'tmp-'));
		const socketPath = join(work, 'a.sock');
		const child = serve(
			['--headless', '--ephemeral', '--idle-exit', '2', '--listen', socketPath],
			{TMPDIR: tmp},
		);
		await waitServing(child);

		const profiles = () =>
			readdirSync(tmp).filter((f) => f.startsWith('searchcast-profile-'));
		expect(profiles()).toHaveLength(1);
		const {status, body} = await getUnix(
			socketPath,
			'/search?recipe=web&q=over%20a%20socket',
		);
		expect(status).toBe(200);
		expect(body.results[0].title).toBe('over a socket result 1');

		expect(await exitCode(child, 15_000)).toBe(0);
		expect(profiles()).toEqual([]);
		expect(existsSync(socketPath)).toBe(false);
	}, 60_000);

	// The regression that took searchcast down in a Tor-forced account: it used
	// to reach the browser over a loopback TCP DevTools port, which such an
	// account cannot use. A fresh network namespace has loopback down, so any
	// loopback TCP fails here just as it does there.
	it.skipIf(!noLoopback)(
		'needs no loopback networking (DevTools over a pipe, not a port)',
		async () => {
			const dir = mkdtempSync(join(work, 'noloop-'));
			writeFileSync(
				join(dir, 'page.html'),
				`<!doctype html><div id="app"></div><script>
				const q = new URLSearchParams(location.search).get('q');
				setTimeout(() => { document.getElementById('app').innerHTML =
					'<article class="r"><h2><a class="t" href="https://example.test/1">' + q + ' result 1</a></h2></article>'; }, 100);
				</script>`,
			);
			const recipe = join(dir, 'local.json');
			writeFileSync(
				recipe,
				JSON.stringify({
					navigate: {url: `file://${dir}/page.html?q={query}`},
					ready: 'article.r a.t',
					results: {
						item: 'article.r',
						fields: {
							title: {selector: 'h2'},
							url: {selector: 'a.t', attr: 'href'},
						},
					},
				}),
			);
			const child = spawn(
				noLoopback!,
				[
					'-Un',
					'--map-current-user',
					process.execPath,
					cli,
					'query',
					'--recipe',
					recipe,
					'--chrome',
					chrome!,
					...chromeArgs,
					'--headless',
					'--ephemeral',
					'offline',
				],
				{stdio: ['ignore', 'pipe', 'pipe']},
			);
			children.push(child);
			let stdout = '';
			let stderr = '';
			child.stdout!.on('data', (c) => (stdout += c));
			child.stderr!.on('data', (c) => (stderr += c));
			expect(await exitCode(child, 30_000), stderr).toBe(0);
			expect(JSON.parse(stdout).results[0].title).toBe('offline result 1');
		},
		40_000,
	);

	it('refuses --listen systemd without a socket from systemd', async () => {
		const child = serve(['--headless', '--ephemeral', '--listen', 'systemd']);
		expect(await exitCode(child, 30_000)).toBe(2);
	}, 40_000);

	it.skipIf(!socketActivate)(
		'accepts a socket from systemd socket activation',
		async () => {
			const socketPath = join(work, 'activated.sock');
			const child = spawn(
				socketActivate!,
				[
					'-l',
					socketPath,
					...['PATH', 'HOME', 'TMPDIR']
						.filter((v) => process.env[v])
						.flatMap((v) => ['-E', v]),
					process.execPath,
					cli,
					'serve',
					'--recipes',
					recipesDir,
					'--chrome',
					chrome!,
					...chromeArgs,
					'--headless',
					'--ephemeral',
					'--listen',
					'systemd',
				],
				{stdio: ['ignore', 'ignore', 'pipe']},
			);
			children.push(child);
			// The listener exists before the service does: connecting is what starts it.
			for (let i = 0; i < 50 && !existsSync(socketPath); i++)
				await new Promise((r) => setTimeout(r, 100));
			const {status, body} = await getUnix(
				socketPath,
				'/search?recipe=web&q=activated',
			);
			expect(status).toBe(200);
			expect(body.results[0].title).toBe('activated result 1');
			child.kill('SIGTERM');
			expect(await exitCode(child, 15_000)).toBe(0);
		},
		60_000,
	);

	it.skipIf(!xvfb)(
		'runs headful on its own Xvfb, and does not look automated',
		async () => {
			const socketPath = join(work, 'x.sock');
			const child = serve(
				['--xvfb', xvfb!, '--ephemeral', '--listen', socketPath],
				{DISPLAY: ''},
			);
			await waitServing(child);
			const {status, body} = await getUnix(
				socketPath,
				'/search?recipe=webdriver&q=probe',
			);
			expect(status).toBe(200);
			expect(body.results[0].title).toBe('false');
			child.kill('SIGTERM');
			expect(await exitCode(child, 15_000)).toBe(0);
		},
		60_000,
	);

	it.skipIf(!searxPython)(
		'is queried by the SearXNG socket engine, which raises on a block',
		async () => {
			const socketPath = join(work, 'engine.sock');
			const child = serve([
				'--headless',
				'--ephemeral',
				'--listen',
				socketPath,
			]);
			await waitServing(child);
			const engine = resolve(
				import.meta.dirname,
				'..',
				'integrations',
				'searxng',
				'searchcast.py',
			);
			const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("searchcast_engine", ${JSON.stringify(engine)})
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)
import os
e.socket_path = "$SC_TEST_SOCKET"; e.recipe = "web"
try:
    e.init(); unset = None
except ValueError:
    unset = "refused"
os.environ["SC_TEST_SOCKET"] = ${JSON.stringify(socketPath)}; e.init()
out = {"unset": unset, "ok": e.search("from searxng", {})}
try:
    e.search("blockme", {})
    out["blocked"] = None
except Exception as ex:
    out["blocked"] = type(ex).__name__
print(json.dumps(out))
`;
			// Async on purpose: this process also serves the fixture site the
			// browser is loading, so a synchronous spawn would deadlock it.
			const py = spawn(searxPython!, ['-c', script], {
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			children.push(py);
			let stdout = '';
			let stderr = '';
			py.stdout!.on('data', (c) => (stdout += c));
			py.stderr!.on('data', (c) => (stderr += c));
			await exitCode(py, 60_000);
			expect(stderr).toBe('');
			const out = JSON.parse(stdout);
			expect(out.ok[0]).toMatchObject({title: 'from searxng result 1'});
			expect(out.ok[0].url).toContain('/doc/1');
			expect(out.blocked).toBe('SearxEngineCaptchaException');
			expect(out.unset).toBe('refused');
			child.kill('SIGTERM');
			expect(await exitCode(child, 15_000)).toBe(0);
		},
		90_000,
	);
});
