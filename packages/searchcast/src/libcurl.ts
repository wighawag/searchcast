// Locating, loading and checking libcurl-impersonate. searchcast binds it
// directly with koffi (ADR 0001 fallback; impers is NOT used, see
// work/notes/findings/impers-fingerprint-vs-curl-cffi.md), so loading has no
// download path at all: the library is only ever loaded from an explicit path,
// the data directory, or the platform package npm installed with searchcast
// (`@searchcast/libcurl-<platform>`, an optional dependency built in the release
// workflow from the pinned archive; ADR 0002, ADR 0005). The one thing in
// searchcast that downloads it is the user-invoked `searchcast install-libcurl`
// (src/install.ts). The library is loaded once per process, so its path is
// process-global.
//
// Linux and FreeBSD load it with RTLD_DEEPBIND (koffi `deep`), so its calls to
// nghttp2 and zlib bind to its own statically linked copies instead of Node's.
// Without that, Node's newer nghttp2 drops the PRIORITY flag Chrome sets on the
// HTTP/2 HEADERS frame. Other platforms have no RTLD_DEEPBIND; the library is
// loaded plainly there and HTTP/2 HEADERS parity is NOT claimed (unmeasured).

import {existsSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {IMPERSONATE_TARGET} from './chrome.js';
import {dataDir, libraryFileName, oldDataDir} from './data-dir.js';
import {SearchcastError} from './errors.js';

/**
 * The pinned libcurl-impersonate release and the sha256 of each platform's
 * release archive (lexiforest/curl-impersonate `libcurl-impersonate-*`
 * assets), keyed by `${process.platform}-${process.arch}`. `searchcast
 * install-libcurl` (src/install.ts; CI installs with it too) downloads from
 * here and verifies against these checksums; nothing else downloads. Checksums:
 * the `digest` field of the GitHub release API for tag v2.1.1, cross-checked
 * by downloading the linux-x64 archive (2026-09-28). Re-checked the same day
 * for `searchcast install-libcurl`: every digest matches the API again, the
 * linux-x64 download hashes to it, and `library` is a regular file (not a
 * symlink) in the linux-x64, linux-arm64, darwin-x64, darwin-arm64 and
 * win32-x64 archives. The platform packages (`@searchcast/libcurl-<platform>`,
 * one per key below) are built from these same pins by
 * `scripts/libcurl-packages.mjs` in the release workflow.
 */
export const LIBCURL_IMPERSONATE = {
	version: '2.1.1',
	baseUrl:
		'https://github.com/lexiforest/curl-impersonate/releases/download/v2.1.1/',
	assets: {
		'linux-x64': {
			archive: 'libcurl-impersonate-v2.1.1.x86_64-linux-gnu.tar.gz',
			sha256:
				'18b22585da3d6a58926086c65b1e662a87768ccca646e8c2a6ed03137bf948f1',
			library: 'libcurl-impersonate.so.4.8.0',
		},
		'linux-arm64': {
			archive: 'libcurl-impersonate-v2.1.1.aarch64-linux-gnu.tar.gz',
			sha256:
				'db437a38f5c694f43ae08619cb53e3ad5061b05f720f9e56ee68688c91442805',
			library: 'libcurl-impersonate.so.4.8.0',
		},
		'darwin-x64': {
			archive: 'libcurl-impersonate-v2.1.1.x86_64-macos.tar.gz',
			sha256:
				'5d3e3ab29416d52292331fd830c7cb0faa570cf606f3b38900cac844d6dc4f26',
			library: 'libcurl-impersonate.4.8.0.dylib',
		},
		'darwin-arm64': {
			archive: 'libcurl-impersonate-v2.1.1.arm64-macos.tar.gz',
			sha256:
				'747ad70d1e6d302528aecd59fdf64d5c29412ec64f6217d0c7180feff1cad633',
			library: 'libcurl-impersonate.4.8.0.dylib',
		},
		'win32-x64': {
			archive: 'libcurl-impersonate-v2.1.1.x86_64-win32.tar.gz',
			sha256:
				'656ef0fe16393e2718d66112c7d0fcb230adfb4b0de42b0884ade598f6aea617',
			library: 'lib/libcurl-impersonate.dll',
		},
	},
} as const;

/** Where a library path came from, in the order they are tried. */
export type LibrarySource =
	| 'option'
	| 'SEARCHCAST_LIBCURL_PATH'
	/** serpcast's name, read for one release after the new one (ADR 0005). */
	| 'SERPCAST_LIBCURL_PATH'
	| 'LIBCURL_PATH'
	| 'data directory'
	/** serpcast's data directory, read when the new one has no library (ADR 0005). */
	| 'old data directory'
	/** `@searchcast/libcurl-<platform>`, the optional dependency npm installed with searchcast. */
	| 'platform package';

/** The name of the platform package carrying the pinned library for `platform` (`${process.platform}-${process.arch}`). */
export function platformPackageName(platform: string): string {
	return `@searchcast/libcurl-${platform}`;
}

/** An installed platform package: its name and version (from its package.json). */
export interface PlatformPackage {
	name: string;
	version: string;
}

/**
 * The library of the platform package for `platform`, resolved from `from`
 * (a file path or URL; default this module, i.e. where npm installed
 * searchcast's optional dependencies) the way Node resolves a dependency.
 * Undefined when the platform has no package (none is pinned for it), the
 * package is not installed (npm skipped it: another platform, or optional
 * dependencies turned off), or it has no library file. Only reads.
 */
export function platformPackageLibrary(
	from: string | URL = import.meta.url,
	platform = `${process.platform}-${process.arch}`,
): {path: string; package: PlatformPackage} | undefined {
	if (!Object.hasOwn(LIBCURL_IMPERSONATE.assets, platform)) return undefined;
	const name = platformPackageName(platform);
	let manifest: string;
	try {
		manifest = createRequire(from).resolve(`${name}/package.json`);
	} catch {
		return undefined; // not installed
	}
	const os = platform.slice(0, platform.indexOf('-')) as NodeJS.Platform;
	const path = join(dirname(manifest), libraryFileName(os));
	if (!existsSync(path) || !statSync(path).isFile()) return undefined;
	let version = 'unknown';
	try {
		version = String(JSON.parse(readFileSync(manifest, 'utf8')).version);
	} catch {
		// the library is there; a broken manifest only loses the version
	}
	return {path, package: {name, version}};
}

/** Where the library was found (`locateLibrary`). */
export interface LocatedLibrary {
	path: string;
	source: LibrarySource;
	/** The platform package, when `source` is `platform package`. */
	package?: PlatformPackage;
}

/**
 * `resolveLibraryPath`, also saying which setting named the path (for
 * `doctor`). `from` is where the platform package is resolved from (tests).
 */
export function locateLibrary(
	option?: string,
	env: NodeJS.ProcessEnv = process.env,
	from?: string | URL,
): LocatedLibrary | undefined {
	const explicit: [string | undefined, LibrarySource][] = [
		[option, 'option'],
		[env.SEARCHCAST_LIBCURL_PATH, 'SEARCHCAST_LIBCURL_PATH'],
		[env.SERPCAST_LIBCURL_PATH, 'SERPCAST_LIBCURL_PATH'],
		[env.LIBCURL_PATH, 'LIBCURL_PATH'],
	];
	for (const [path, source] of explicit) {
		if (path) return {path: resolve(path), source};
	}
	const installed: [string, LibrarySource][] = [
		[dataDir(env), 'data directory'],
		[oldDataDir(env), 'old data directory'],
	];
	for (const [dir, source] of installed) {
		const path = join(dir, libraryFileName());
		if (existsSync(path)) return {path, source};
	}
	const packaged = platformPackageLibrary(from);
	if (packaged) return {...packaged, source: 'platform package'};
	return undefined;
}

/**
 * Where the library is: the explicit option, then `SEARCHCAST_LIBCURL_PATH`,
 * then `SERPCAST_LIBCURL_PATH` (the old name), then `LIBCURL_PATH`, then the
 * data directory, then serpcast's old data directory, then the platform
 * package installed with searchcast. Undefined when none of these names an
 * existing file. Never searches system paths, never downloads.
 */
export function resolveLibraryPath(
	option?: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	return locateLibrary(option, env)?.path;
}

const thisPlatform = `${process.platform}-${process.arch}`;
const HOW_TO_FIX = Object.hasOwn(LIBCURL_IMPERSONATE.assets, thisPlatform)
	? `On ${thisPlatform}, npm installs it with searchcast as the optional dependency ${platformPackageName(thisPlatform)}; if optional dependencies were skipped, install it with \`searchcast install-libcurl\`, or set SEARCHCAST_LIBCURL_PATH (or the libcurlPath option) to a libcurl-impersonate shared library.`
	: `There is no pinned libcurl-impersonate for ${thisPlatform} (no platform package, no \`searchcast install-libcurl\`): set SEARCHCAST_LIBCURL_PATH (or the libcurlPath option) to a libcurl-impersonate shared library.`;

type Fn = (...args: any[]) => any;

/**
 * The loaded library and the functions searchcast calls. Every call is
 * synchronous, on the main thread: requests are driven through the multi
 * interface (see `Connections` in transport.ts), never with `curl_easy_perform` on a
 * worker thread, whose JS callbacks deadlocked `process.exit()`.
 */
export interface Libcurl {
	path: string;
	koffi: typeof import('koffi').default;
	version: string;
	init: Fn;
	cleanup: Fn;
	setopt: Fn;
	strerror: Fn;
	multiInit: Fn;
	multiCleanup: Fn;
	multiAdd: Fn;
	multiRemove: Fn;
	/** `curl_multi_perform(multi, [running])`. */
	multiPerform: Fn;
	/** `curl_multi_poll(multi, null, 0, timeoutMs, [numfds])`. */
	multiPoll: Fn;
	/** `curl_multi_timeout(multi, [ms])`. */
	multiTimeout: Fn;
	/** `curl_multi_info_read(multi, [queued])`: a pointer to decode as `multiMessage`, or null. */
	multiInfoRead: Fn;
	/** The `CURLMsg` struct type. */
	multiMessage: unknown;
	multiStrerror: Fn;
	slistAppend: Fn;
	slistFree: Fn;
	/** Undefined when the symbol is missing (plain libcurl). */
	impersonate?: Fn;
}

let loaded: {path: string; library: Promise<Libcurl>} | undefined;

/** Load the library at `path` (once per process); an `impersonation` error otherwise. */
export function loadLibcurl(path: string | undefined): Promise<Libcurl> {
	if (!path) {
		return Promise.reject(
			new SearchcastError(
				'impersonation',
				`libcurl-impersonate not found. ${HOW_TO_FIX}`,
			),
		);
	}
	const real = existsSync(path) ? realpathSync(path) : path;
	if (loaded) {
		if (loaded.path === real) return loaded.library;
		return Promise.reject(
			new SearchcastError(
				'impersonation',
				`libcurl is already loaded from ${loaded.path} in this process; cannot also load ${real}. The library path is process-global: use one path for every searchcast instance.`,
			),
		);
	}
	// Claimed synchronously, so two concurrent first uses cannot load two libraries.
	const claim = {path: real, library: bind(real)};
	loaded = claim;
	claim.library.catch(() => {
		if (loaded === claim) loaded = undefined; // a failed load claims nothing
	});
	return claim.library;
}

async function bind(real: string): Promise<Libcurl> {
	if (!existsSync(real)) {
		throw new SearchcastError(
			'impersonation',
			`libcurl-impersonate not found at ${real}. ${HOW_TO_FIX}`,
		);
	}
	const koffi = (await import('koffi')).default;
	let lib;
	try {
		const deep = process.platform === 'linux' || process.platform === 'freebsd';
		lib = koffi.load(real, deep ? {deep: true} : {});
		pin(koffi, real);
	} catch (cause) {
		throw new SearchcastError(
			'impersonation',
			`cannot load ${real} as libcurl. ${HOW_TO_FIX}`,
			{cause},
		);
	}
	let impersonate: Fn | undefined;
	try {
		impersonate = lib.func(
			'int curl_easy_impersonate(void *curl, const char *target, int default_headers)',
		) as Fn;
	} catch {
		impersonate = undefined;
	}
	try {
		const f = (decl: string) => lib.func(decl) as Fn;
		return {
			path: real,
			koffi,
			version: f('const char *curl_version()')(),
			init: f('void *curl_easy_init()'),
			cleanup: f('void curl_easy_cleanup(void *curl)'),
			setopt: f('int curl_easy_setopt(void *curl, int option, ...)'),
			strerror: f('const char *curl_easy_strerror(int code)'),
			multiInit: f('void *curl_multi_init()'),
			multiCleanup: f('int curl_multi_cleanup(void *multi)'),
			multiAdd: f('int curl_multi_add_handle(void *multi, void *curl)'),
			multiRemove: f('int curl_multi_remove_handle(void *multi, void *curl)'),
			multiPerform: f(
				'int curl_multi_perform(void *multi, _Out_ int *running)',
			),
			multiPoll: f(
				'int curl_multi_poll(void *multi, void *extra, unsigned int n, int timeout, _Out_ int *numfds)',
			),
			multiTimeout: f('int curl_multi_timeout(void *multi, _Out_ long *ms)'),
			multiInfoRead: f(
				'void *curl_multi_info_read(void *multi, _Out_ int *queued)',
			),
			multiMessage: koffi.struct({
				msg: 'int',
				easy: 'void *',
				data: koffi.union({whatever: 'void *', result: 'int'}),
			}),
			multiStrerror: f('const char *curl_multi_strerror(int code)'),
			slistAppend: f('void *curl_slist_append(void *list, const char *value)'),
			slistFree: f('void curl_slist_free_all(void *list)'),
			impersonate,
		};
	} catch (cause) {
		throw new SearchcastError(
			'impersonation',
			`${real} is not a libcurl library. ${HOW_TO_FIX}`,
			{cause},
		);
	}
}

/**
 * Keep the library mapped until the process ends. Requests used to run on
 * libuv worker threads; BoringSSL left thread-local destructors on them, which
 * ran when the workers exited at process exit, after koffi had already
 * unloaded the library: a SIGSEGV on every exit (measured on Linux). Requests
 * now run on the main thread (transport.ts); the pin is kept anyway (ADR
 * 0004; the library still starts threads of its own for DNS, and exit without
 * the pin has not been re-measured). Re-opening it
 * with RTLD_NOLOAD | RTLD_NODELETE (the handle is deliberately leaked)
 * prevents the unload. Best effort, POSIX only; Windows is unmeasured.
 */
function pin(koffi: Libcurl['koffi'], path: string): void {
	const flags = {linux: 0x1006, freebsd: 0x3002, darwin: 0x92} as Partial<
		Record<NodeJS.Platform, number>
	>;
	const flag = flags[process.platform]; // RTLD_NOW | RTLD_NOLOAD | RTLD_NODELETE
	if (flag === undefined) return;
	koffi.load(null).func('void *dlopen(const char *path, int flags)')(
		path,
		flag,
	);
}

/**
 * Strict mode's check: the library exports `curl_easy_impersonate` and accepts
 * the pinned target. A plain libcurl loads silently, so loading alone proves
 * nothing. Makes no network call.
 */
export function assertImpersonation(curl: Libcurl): void {
	if (!curl.impersonate) {
		throw new SearchcastError(
			'impersonation',
			`${curl.path} is plain libcurl (${curl.version}), not libcurl-impersonate. ${HOW_TO_FIX}`,
		);
	}
	const handle = curl.init();
	try {
		const code: number = curl.impersonate(handle, IMPERSONATE_TARGET, 0);
		if (code !== 0) {
			throw new SearchcastError(
				'impersonation',
				`${curl.path} (${curl.version}) does not support the impersonation target ${IMPERSONATE_TARGET}: ${curl.strerror(code)}. Use libcurl-impersonate ${LIBCURL_IMPERSONATE.version} or later.`,
			);
		}
	} finally {
		curl.cleanup(handle);
	}
}
