// `searchcast doctor`, and `searchcast query` after `searchcast install-libcurl`. The
// first block needs no native library; the second runs only with
// SEARCHCAST_LIBCURL_PATH (see test/native-notice.ts). Every data directory is a
// temp dir, and the real one is checked untouched. The platform packages linked
// in this workspace (whose linux-x64 library CI builds) are hidden, in process
// and in CLI runs: the library is loaded once per process, so an in-process
// doctor that found the platform package's library would make the native tests'
// explicit LIB path refused. The platform-package lookup is tested in
// platform-package.test.ts and platform-package-native.test.ts.

import {execFile} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {doctor, formatReport, healthy} from '../src/doctor.js';
import {libraryFileName, oldDataDirHits} from '../src/index.js';
import {installLibcurl} from '../src/install.js';
import {item, recipe, resultsPage, startPageServer} from './pages.js';
import {
	LIBRARY,
	realDataDirs,
	release,
	sha256,
	startReleaseServer,
	tarGz,
	tree,
} from './release.js';
import {CA_PATH, startConnectProxy, startH2Server} from './servers.js';
import {HIDE_ARGS, hideEnv} from './platform-packages.js';

vi.mock('node:module', async (original) =>
	(await import('./hide-platform-packages.js')).hidingPlatformPackages(
		await original<typeof import('node:module')>(),
	),
);

const LIB = process.env.SEARCHCAST_LIBCURL_PATH;
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = promisify(execFile);

const snapshot = realDataDirs();
let before: unknown[];
let tmp: string;
/** No library configured anywhere; the data directory is a temp dir. */
let env: NodeJS.ProcessEnv;
beforeEach(() => {
	before = snapshot();
	tmp = mkdtempSync(join(tmpdir(), 'searchcast-doctor-'));
	env = {
		...process.env,
		SEARCHCAST_LIBCURL_PATH: '',
		SERPCAST_LIBCURL_PATH: '',
		LIBCURL_PATH: '',
		HOME: tmp,
		XDG_DATA_HOME: join(tmp, 'data'),
	};
});
afterEach(() => {
	rmSync(tmp, {recursive: true, force: true});
	expect(snapshot()).toEqual(before); // the real data directory is untouched
});

/** A TCP server that only counts connections: any network request would show. */
async function listener() {
	const server = net.createServer((socket) => socket.destroy());
	let connections = 0;
	server.on('connection', () => connections++);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return {
		url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
		connections: () => connections,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

const failed = (promise: Promise<unknown>) =>
	promise.then(
		() => expect.fail('expected exit 1'),
		(e: {code: number; stdout: string; stderr: string}) => e,
	);

describe('searchcast doctor (no native library needed)', () => {
	it('reports a missing library and how to fix it (exit 1), with no network request', async () => {
		const proxy = await listener();
		try {
			for (const extra of [[], ['--remote']]) {
				// No platform package either (CI builds linux-x64's).
				const {code, stdout} = await failed(
					run(
						process.execPath,
						[...HIDE_ARGS, cli, 'doctor', '--proxy', proxy.url, ...extra],
						{env: hideEnv(env)},
					),
				);
				expect(code).toBe(1);
				expect(stdout).toMatch(/^library: +not found$/m);
				expect(stdout).toMatch(/^pinned: +libcurl-impersonate 2\.1\.1$/m);
				expect(stdout).toMatch(/^impersonation: +NOT active$/m);
				expect(stdout).toMatch(/^problem: .*searchcast install-libcurl/m);
			}
			expect(proxy.connections()).toBe(0);
		} finally {
			await proxy.close();
		}
	});

	it('names a data-directory file that is not a library, and skips --remote', async () => {
		mkdirSync(join(tmp, 'data', 'searchcast'), {recursive: true});
		const path = join(tmp, 'data', 'searchcast', libraryFileName());
		writeFileSync(path, 'not a library');
		const report = await doctor({env, remote: true});
		expect(report).toMatchObject({
			library: {path, source: 'data directory'},
			impersonating: false,
			problem: expect.stringContaining(`cannot load ${path}`),
			remote: {error: 'skipped: impersonation is not active'},
		});
		expect(healthy(report)).toBe(false);
		expect(formatReport(report)).toMatch(
			/^from: +the data directory \(searchcast install-libcurl\)$/m,
		);
	});
});

describe('searchcast doctor and the old serpcast names (no native library needed)', () => {
	it('names SERPCAST_LIBCURL_PATH as the old name and says which to use', async () => {
		const path = join(tmp, 'lib.so');
		writeFileSync(path, 'not a library');
		const report = await doctor({env: {...env, SERPCAST_LIBCURL_PATH: path}});
		expect(report.library).toMatchObject({
			path,
			source: 'SERPCAST_LIBCURL_PATH',
		});
		expect(formatReport(report)).toMatch(
			/^from: +SERPCAST_LIBCURL_PATH \(serpcast's old name, read for one release: rename it SEARCHCAST_LIBCURL_PATH\)$/m,
		);
		const newer = await doctor({
			env: {...env, SEARCHCAST_LIBCURL_PATH: path, SERPCAST_LIBCURL_PATH: '/x'},
		});
		expect(newer.library?.source).toBe('SEARCHCAST_LIBCURL_PATH');
		expect(formatReport(newer)).toMatch(/^from: +SEARCHCAST_LIBCURL_PATH$/m);
	});

	it("reports a library read from serpcast's old data directory, with the exact mv command, and moves nothing", async () => {
		const old = join(tmp, 'data', 'serpcast');
		mkdirSync(join(old, 'recipes', 'my-set'), {recursive: true});
		writeFileSync(join(old, libraryFileName()), 'not a library');
		const newDir = join(tmp, 'data', 'searchcast');
		const before = tree(join(tmp, 'data'));
		const {code, stdout} = await failed(
			run(process.execPath, [cli, 'doctor'], {env}),
		);
		expect(code).toBe(1); // not a library; the fallback itself is no failure
		expect(stdout).toContain(`library:       ${join(old, libraryFileName())}`);
		expect(stdout).toMatch(
			/^from: +serpcast's old data directory \(read for one release/m,
		);
		expect(stdout).toContain(
			`old data dir:  ${old}: ${libraryFileName()}, recipes/my-set (read because ${newDir} lacks them; nothing is moved for you)`,
		);
		// The new directory does not exist: one mv moves the whole directory.
		expect(stdout).toContain(`move with:     mv '${old}' '${newDir}'`);
		expect(tree(join(tmp, 'data'))).toEqual(before);
	});

	it('lists only what the new directory lacks, and moves each item when the new directory exists', async () => {
		const old = join(tmp, 'data', 'serpcast');
		const newDir = join(tmp, 'data', 'searchcast');
		for (const set of ['a', 'b'])
			mkdirSync(join(old, 'recipes', set), {recursive: true});
		writeFileSync(join(old, libraryFileName()), 'old');
		mkdirSync(join(newDir, 'recipes', 'a'), {recursive: true});
		writeFileSync(join(newDir, libraryFileName()), 'new');
		const hits = oldDataDirHits(env);
		expect(hits).toEqual({
			dir: old,
			newDir,
			items: ['recipes/b'],
			command: `mkdir -p '${join(newDir, 'recipes')}' && mv '${join(old, 'recipes', 'b')}' '${join(newDir, 'recipes', 'b')}'`,
		});
		const report = await doctor({env});
		expect(report.library).toMatchObject({source: 'data directory'});
		expect(report.oldDataDir).toEqual(hits);
		expect(formatReport(report)).toMatch(/^move with: +mkdir -p /m);
		rmSync(join(newDir, libraryFileName()));
		expect(oldDataDirHits(env)?.command).toBe(
			`mkdir -p '${join(newDir, 'recipes')}' && mv '${join(old, libraryFileName())}' '${join(newDir, libraryFileName())}' && mv '${join(old, 'recipes', 'b')}' '${join(newDir, 'recipes', 'b')}'`,
		);
		// The command really moves them: run it and nothing is left to report.
		await run('sh', ['-c', oldDataDirHits(env)!.command]);
		expect(oldDataDirHits(env)).toBeUndefined();
		expect(existsSync(join(newDir, 'recipes', 'b'))).toBe(true);
	});

	it('quotes paths for the shell', () => {
		const data = join(tmp, "it's here");
		mkdirSync(join(data, 'serpcast'), {recursive: true});
		writeFileSync(join(data, 'serpcast', libraryFileName()), 'x');
		expect(oldDataDirHits({XDG_DATA_HOME: data})?.command).toBe(
			`mv '${join(tmp, "it'\\''s here", 'serpcast')}' '${join(tmp, "it'\\''s here", 'searchcast')}'`,
		);
	});

	it('says nothing about the old directory when it is absent or has nothing the new one lacks', async () => {
		expect(oldDataDirHits(env)).toBeUndefined();
		const report = await doctor({env});
		// Nothing found, so nothing loaded (the native tests below load LIB).
		expect(report.library).toBeUndefined();
		expect(report.oldDataDir).toBeUndefined();
		expect(formatReport(report)).not.toMatch(/old data dir|move with/);
	});
});

describe.skipIf(!LIB)('searchcast doctor (native libcurl-impersonate)', () => {
	it('reports the library, where it came from and that impersonation is active, without any request', async () => {
		const proxy = await startConnectProxy();
		try {
			const {stdout} = await run(
				process.execPath,
				[
					cli,
					'doctor',
					'--libcurl',
					LIB!,
					'--proxy',
					`http://127.0.0.1:${proxy.port}`,
				],
				{env},
			);
			expect(stdout).toMatch(/^from: +--libcurl$/m);
			expect(stdout).toMatch(/^version: +libcurl\/\S+ BoringSSL/m);
			expect(stdout).toMatch(/^impersonation: +active \(chrome\d+\)$/m);
			expect(stdout).not.toMatch(/^echo:/m);
			expect(proxy.requests).toEqual([]);
		} finally {
			await proxy.close();
		}
	});

	it('with remote, asks the echo service through the transport and the proxy and reports what it saw', async () => {
		const echo = await startH2Server((_req, res) => {
			res.setHeader('content-type', 'application/json');
			res.end(
				JSON.stringify({
					ja3_hash: 'j3',
					ja3n_hash: 'j3n',
					ja4: 't13d1516h2_x_y',
					akamai_text: '1:65536|15663105|0|m,a,s,p',
					akamai_hash: 'ak',
				}),
			);
		});
		const proxy = await startConnectProxy();
		try {
			const report = await doctor({
				libcurlPath: LIB,
				proxy: `http://127.0.0.1:${proxy.port}`,
				remote: true,
				echoUrl: `https://localhost:${echo.port}/json`,
				caPath: CA_PATH,
			});
			expect(report.impersonating, report.problem).toBe(true);
			expect(report.remote).toEqual({
				url: `https://localhost:${echo.port}/json`,
				seen: {
					ja3: 'j3',
					ja3n: 'j3n',
					ja4: 't13d1516h2_x_y',
					http2: '1:65536|15663105|0|m,a,s,p',
					'http2 hash': 'ak',
				},
			});
			expect(healthy(report)).toBe(true);
			expect(proxy.requests).toEqual([{host: 'localhost', port: echo.port}]);
			expect(echo.connections).toBe(1);
		} finally {
			await proxy.close();
			await echo.close();
		}
	});
});

describe.skipIf(!LIB)('searchcast query after install-libcurl (native)', () => {
	it('finds the installed library with no path configured', async () => {
		const archive = tarGz([{name: LIBRARY, body: readFileSync(LIB!)}]);
		const releases = await startReleaseServer({'/rel/lib.tar.gz': archive});
		const pages = await startPageServer({
			'/search': {body: resultsPage(item('One', 'one', 'snip'))},
		});
		try {
			const {path} = await installLibcurl({
				env,
				release: release(`${releases.origin}/rel/`, sha256(archive)),
			});
			expect(path).toBe(join(tmp, 'data', 'searchcast', libraryFileName()));
			const file = join(tmp, 'r.json');
			writeFileSync(file, JSON.stringify(recipe(pages.origin)));
			const {stdout} = await run(
				process.execPath,
				[cli, 'query', '--recipe', file, 'hello'],
				{env},
			);
			expect(JSON.parse(stdout).results).toEqual([
				{
					title: 'One',
					url: `${pages.origin}/one`,
					content: 'snip',
					snippet: 'snip',
				},
			]);
			const doctored = await run(process.execPath, [cli, 'doctor'], {env});
			expect(doctored.stdout).toContain(`library:       ${path}`);
			expect(doctored.stdout).toMatch(/^from: +the data directory/m);
		} finally {
			await releases.close();
			await pages.close();
		}
	});
});
