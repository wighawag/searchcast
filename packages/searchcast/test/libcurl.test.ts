// Locating the library, and what happens when there is none. No native library
// is needed here. Tests that touch HOME or the data dir point them at a temp
// dir and check the real ones are untouched. The platform packages linked in
// this workspace (whose linux-x64 library CI builds) are hidden: the lookup
// through them is tested in platform-package.test.ts.

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	createTransport,
	dataDir,
	LIBCURL_IMPERSONATE,
	libraryFileName,
	oldDataDir,
	resolveLibraryPath,
} from '../src/index.js';
import {locateLibrary} from '../src/libcurl.js';
import {startH2Server} from './servers.js';

vi.mock('node:module', async (original) =>
	(await import('./hide-platform-packages.js')).hidingPlatformPackages(
		await original<typeof import('node:module')>(),
	),
);

const ENV_KEYS = [
	'HOME',
	'XDG_DATA_HOME',
	'XDG_CACHE_HOME',
	'SEARCHCAST_LIBCURL_PATH',
	'SERPCAST_LIBCURL_PATH',
	'LIBCURL_PATH',
];

describe('pinned libcurl-impersonate release', () => {
	it('names one version and a sha256 per platform archive of that version', () => {
		expect(LIBCURL_IMPERSONATE.version).toBe('2.1.1');
		expect(LIBCURL_IMPERSONATE.baseUrl).toContain(
			`/v${LIBCURL_IMPERSONATE.version}/`,
		);
		const assets = Object.entries(LIBCURL_IMPERSONATE.assets);
		expect(assets.map(([platform]) => platform)).toEqual(
			expect.arrayContaining([
				'linux-x64',
				'linux-arm64',
				'darwin-x64',
				'darwin-arm64',
			]),
		);
		for (const [, asset] of assets) {
			expect(asset.archive).toContain(`-v${LIBCURL_IMPERSONATE.version}.`);
			expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
	});
});

describe('resolveLibraryPath', () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'searchcast-resolve-'));
	});
	afterEach(() => rmSync(tmp, {recursive: true, force: true}));

	/** A library file in `$XDG_DATA_HOME/<name>` of the temp dir. */
	const install = (name: string) => {
		mkdirSync(join(tmp, name), {recursive: true});
		const path = join(tmp, name, libraryFileName());
		writeFileSync(path, '');
		return path;
	};

	it('tries the option, SEARCHCAST_LIBCURL_PATH, SERPCAST_LIBCURL_PATH, LIBCURL_PATH, the data dir, then the old one', () => {
		const newer = install('searchcast');
		const older = install('serpcast');
		const env = {
			XDG_DATA_HOME: tmp,
			SEARCHCAST_LIBCURL_PATH: '/new.so',
			SERPCAST_LIBCURL_PATH: '/old.so',
			LIBCURL_PATH: '/b.so',
		};
		const steps: [NodeJS.ProcessEnv, string | undefined, string, string][] = [
			[env, '/opt.so', '/opt.so', 'option'],
			[env, undefined, '/new.so', 'SEARCHCAST_LIBCURL_PATH'],
			[
				{...env, SEARCHCAST_LIBCURL_PATH: ''},
				undefined,
				'/old.so',
				'SERPCAST_LIBCURL_PATH',
			],
			[
				{XDG_DATA_HOME: tmp, LIBCURL_PATH: '/b.so'},
				undefined,
				'/b.so',
				'LIBCURL_PATH',
			],
			[{XDG_DATA_HOME: tmp}, undefined, newer, 'data directory'],
		];
		for (const [stepEnv, option, path, source] of steps) {
			expect(locateLibrary(option, stepEnv), source).toEqual({path, source});
			expect(resolveLibraryPath(option, stepEnv)).toBe(path);
		}
		rmSync(newer);
		expect(locateLibrary(undefined, {XDG_DATA_HOME: tmp})).toEqual({
			path: older,
			source: 'old data directory',
		});
		rmSync(older);
		expect(resolveLibraryPath(undefined, {XDG_DATA_HOME: tmp})).toBeUndefined();
	});

	it('reads the old SERPCAST_LIBCURL_PATH when it is the only one set', () => {
		expect(
			locateLibrary(undefined, {
				XDG_DATA_HOME: tmp,
				SERPCAST_LIBCURL_PATH: '/old.so',
			}),
		).toEqual({path: '/old.so', source: 'SERPCAST_LIBCURL_PATH'});
	});

	it('reads the old data directory only when the new one has no library', () => {
		const older = install('serpcast');
		expect(resolveLibraryPath(undefined, {XDG_DATA_HOME: tmp})).toBe(older);
		mkdirSync(join(tmp, 'searchcast')); // an empty new directory changes nothing
		expect(resolveLibraryPath(undefined, {XDG_DATA_HOME: tmp})).toBe(older);
		const newer = install('searchcast');
		expect(resolveLibraryPath(undefined, {XDG_DATA_HOME: tmp})).toBe(newer);
	});

	it('puts the data dir under XDG_DATA_HOME, else ~/.local/share, and the old one beside it', () => {
		expect(dataDir({XDG_DATA_HOME: '/x'})).toBe('/x/searchcast');
		expect(dataDir({})).toBe(join(homedir(), '.local', 'share', 'searchcast'));
		expect(oldDataDir({XDG_DATA_HOME: '/x'})).toBe('/x/serpcast');
		expect(oldDataDir({})).toBe(join(homedir(), '.local', 'share', 'serpcast'));
	});
});

describe('with no library available', () => {
	const saved: Record<string, string | undefined> = {};
	const realHome = homedir();
	const realDirs = [
		join(realHome, '.local', 'share', 'searchcast'),
		join(realHome, '.local', 'share', 'serpcast'),
		join(realHome, '.cache', 'impers'),
		...(process.env.XDG_DATA_HOME
			? [
					join(process.env.XDG_DATA_HOME, 'searchcast'),
					join(process.env.XDG_DATA_HOME, 'serpcast'),
				]
			: []),
		...(process.env.XDG_CACHE_HOME
			? [join(process.env.XDG_CACHE_HOME, 'impers')]
			: []),
	];
	const snapshot = () =>
		realDirs.map((d) => (existsSync(d) ? statSync(d).mtimeMs : 'absent'));
	let tmp: string;
	let before: unknown[];

	beforeEach(() => {
		before = snapshot();
		tmp = mkdtempSync(join(tmpdir(), 'searchcast-home-'));
		for (const key of ENV_KEYS) saved[key] = process.env[key];
		delete process.env.SEARCHCAST_LIBCURL_PATH;
		delete process.env.SERPCAST_LIBCURL_PATH;
		delete process.env.LIBCURL_PATH;
		process.env.HOME = tmp;
		process.env.XDG_DATA_HOME = join(tmp, 'data');
		process.env.XDG_CACHE_HOME = join(tmp, 'cache');
	});
	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
		rmSync(tmp, {recursive: true, force: true});
		expect(snapshot()).toEqual(before); // the real HOME and data dir are untouched
	});

	it('fails the first request with an impersonation error, makes no network call and writes nothing', async () => {
		const server = await startH2Server((_req, res) =>
			res.end('should not be reached'),
		);
		try {
			const error = await createTransport()
				.session()
				.request(`https://localhost:${server.port}/`, {kind: 'document'})
				.catch((e: unknown) => e);
			expect(error).toMatchObject({kind: 'impersonation'});
			expect((error as Error).message).toMatch(/searchcast install-libcurl/);
			expect((error as Error).message).toMatch(/SEARCHCAST_LIBCURL_PATH/);
			expect(server.connections).toBe(0);
		} finally {
			await server.close();
		}
		expect(readdirSync(tmp)).toEqual([]); // no download, no cache, no data dir
	});

	it('fails in non-strict mode too: there is nothing to send with', async () => {
		await expect(
			createTransport({strict: false}).check(),
		).rejects.toMatchObject({kind: 'impersonation'});
		expect(readdirSync(tmp)).toEqual([]);
	});

	it('names the missing file when the configured path does not exist', async () => {
		const missing = join(tmp, 'nope.so');
		await expect(
			createTransport({libcurlPath: missing}).check(),
		).rejects.toMatchObject({
			kind: 'impersonation',
			message: expect.stringContaining(missing),
		});
	});
});

describe('no runtime download path', () => {
	it('does not depend on impers (whose first import downloads the library)', () => {
		const manifest = JSON.parse(
			readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
		);
		expect(
			Object.keys({...manifest.dependencies, ...manifest.optionalDependencies}),
		).not.toContain('impers');
	});
});
