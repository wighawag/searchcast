// The last place searchcast looks for the library: the platform package
// `@searchcast/libcurl-<platform>` npm installed with it (an optional
// dependency), resolved the way Node resolves a dependency. No native library
// is needed: each test installs a fake package in a temp `node_modules` and
// resolves from a file next to it. Loading the real one is
// platform-package-native.test.ts.
//
// Resolution is confined to the temp dir: under pnpm, NODE_PATH also reaches
// this workspace's own platform packages (whose linux-x64 library CI builds),
// so anything the real resolution finds outside the temp dir is reported as
// not installed, as it would be for an app that only has the fake packages.

import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {formatReport, type DoctorReport} from '../src/doctor.js';
import {libraryFileName} from '../src/data-dir.js';
import {
	LIBCURL_IMPERSONATE,
	loadLibcurl,
	locateLibrary,
	platformPackageLibrary,
	platformPackageName,
} from '../src/libcurl.js';

const confined = vi.hoisted(() => ({root: ''}));
vi.mock('node:module', async (original) => {
	const mod = await original<typeof import('node:module')>();
	const createRequire = (from: string | URL) => {
		const require = mod.createRequire(from);
		const real = require.resolve;
		const resolve = (id: string, options?: {paths?: string[]}) => {
			const found = real(id, options);
			if (confined.root && !found.startsWith(confined.root))
				throw Object.assign(new Error(`Cannot find module '${id}'`), {
					code: 'MODULE_NOT_FOUND',
				});
			return found;
		};
		return Object.assign(require, {resolve});
	};
	const confining = {...mod, createRequire};
	return {...confining, default: confining};
});

const PLATFORM = `${process.platform}-${process.arch}`;
const PINNED = Object.hasOwn(LIBCURL_IMPERSONATE.assets, PLATFORM);
/** A pinned platform to test with: this one if it is pinned. */
const TESTED = PINNED ? PLATFORM : 'linux-x64';

let tmp: string;
/** Where the lookup resolves from: a file of an app next to `node_modules`. */
let from: string;
beforeEach(() => {
	tmp = realpathSync(mkdtempSync(join(tmpdir(), 'searchcast-platform-')));
	confined.root = tmp;
	from = join(tmp, 'app', 'index.js');
});
afterEach(() => {
	confined.root = '';
	rmSync(tmp, {recursive: true, force: true});
});

/** Installs a fake platform package under `<base>/node_modules`; returns its library path. */
function install(
	platform = TESTED,
	{
		base = tmp,
		version = '1.2.3',
		library = true,
	}: {base?: string; version?: string; library?: boolean} = {},
): string {
	const dir = join(base, 'node_modules', platformPackageName(platform));
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({name: platformPackageName(platform), version}),
	);
	const os = platform.slice(0, platform.indexOf('-')) as NodeJS.Platform;
	const path = join(dir, libraryFileName(os));
	if (library) writeFileSync(path, 'the library');
	return path;
}

describe('platformPackageLibrary', () => {
	it('finds the library of the installed package, with its name and version', () => {
		const path = install();
		expect(platformPackageLibrary(from, TESTED)).toEqual({
			path,
			package: {name: `@searchcast/libcurl-${TESTED}`, version: '1.2.3'},
		});
		// A file URL works as well as a path (the default is import.meta.url).
		expect(platformPackageLibrary(pathToFileURL(from), TESTED)?.path).toBe(
			path,
		);
	});

	it('resolves as Node does: from searchcast in node_modules, its own nested copy first, else the hoisted one', () => {
		// Two installs (Node caches a resolution per directory).
		const hoistedOnly = join(tmp, 'a');
		const inA = join(hoistedOnly, 'node_modules', 'searchcast', 'dist', 'x.js');
		const hoisted = install(TESTED, {base: hoistedOnly, version: '1.0.0'});
		expect(platformPackageLibrary(inA, TESTED)?.path).toBe(hoisted);

		const both = join(tmp, 'b');
		const searchcast = join(both, 'node_modules', 'searchcast');
		install(TESTED, {base: both, version: '1.0.0'});
		const nested = install(TESTED, {base: searchcast, version: '2.0.0'});
		expect(
			platformPackageLibrary(join(searchcast, 'dist', 'x.js'), TESTED),
		).toEqual({
			path: nested,
			package: {name: platformPackageName(TESTED), version: '2.0.0'},
		});
	});

	it('skips a package that is not installed, or that has no library file', () => {
		expect(platformPackageLibrary(from, TESTED)).toBeUndefined();
		install(TESTED, {library: false});
		expect(platformPackageLibrary(from, TESTED)).toBeUndefined();
	});

	it("skips a platform with no package, and never takes another platform's", () => {
		install('sunos-x64'); // even if something by that name is installed
		expect(platformPackageLibrary(from, 'sunos-x64')).toBeUndefined();
		const other = TESTED === 'linux-x64' ? 'darwin-arm64' : 'linux-x64';
		install(other);
		expect(platformPackageLibrary(from, TESTED)).toBeUndefined();
	});

	it('names the package after the platform key of the pins', () => {
		expect(platformPackageName('linux-x64')).toBe(
			'@searchcast/libcurl-linux-x64',
		);
	});
});

describe.runIf(PINNED)('locateLibrary and the platform package', () => {
	it('tries it after every other source: the option, the env names, the data directory and the old one', () => {
		const packaged = install();
		const data = join(tmp, 'data');
		const env = {XDG_DATA_HOME: data};
		const fromPackage = {
			path: packaged,
			source: 'platform package',
			package: {name: platformPackageName(PLATFORM), version: '1.2.3'},
		};
		expect(locateLibrary(undefined, env, from)).toEqual(fromPackage);
		for (const [name, source] of [
			['serpcast', 'old data directory'],
			['searchcast', 'data directory'],
		]) {
			mkdirSync(join(data, name), {recursive: true});
			const path = join(data, name, libraryFileName());
			writeFileSync(path, '');
			expect(locateLibrary(undefined, env, from)).toEqual({path, source});
		}
		for (const [key, source] of [
			['LIBCURL_PATH', 'LIBCURL_PATH'],
			['SERPCAST_LIBCURL_PATH', 'SERPCAST_LIBCURL_PATH'],
			['SEARCHCAST_LIBCURL_PATH', 'SEARCHCAST_LIBCURL_PATH'],
		]) {
			expect(locateLibrary(undefined, {...env, [key]: '/x.so'}, from)).toEqual({
				path: '/x.so',
				source,
			});
		}
		expect(locateLibrary('/opt.so', env, from)).toEqual({
			path: '/opt.so',
			source: 'option',
		});
		rmSync(data, {recursive: true});
		expect(locateLibrary(undefined, env, from)).toEqual(fromPackage);
	});

	it('finds nothing when the package is not installed and nothing else names a library', () => {
		expect(
			locateLibrary(undefined, {XDG_DATA_HOME: join(tmp, 'data')}, from),
		).toBeUndefined();
	});

	it('names the platform package and install-libcurl when there is no library', async () => {
		const error = await loadLibcurl(undefined).catch((e: Error) => e);
		expect(error.message).toContain(
			`npm installs it with searchcast as the optional dependency ${platformPackageName(PLATFORM)}`,
		);
		expect(error.message).toContain(
			'if optional dependencies were skipped, install it with `searchcast install-libcurl`',
		);
		expect(error.message).toContain('SEARCHCAST_LIBCURL_PATH');
	});
});

describe('searchcast doctor and the platform package', () => {
	it('names the package and its version as the source', () => {
		const report: DoctorReport = {
			pinned: 'libcurl-impersonate 2.1.1',
			target: 'chrome146',
			impersonating: true,
			library: {
				path: '/n/libcurl-impersonate.so',
				source: 'platform package',
				package: {name: '@searchcast/libcurl-linux-x64', version: '0.1.0'},
				version: 'libcurl/8.21.0-IMPERSONATE',
			},
		};
		expect(formatReport(report)).toMatch(
			/^from: +the platform package @searchcast\/libcurl-linux-x64 0\.1\.0 \(installed with searchcast\)$/m,
		);
	});
});
