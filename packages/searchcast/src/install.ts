// `searchcast install-libcurl`: the ONLY code in searchcast that downloads the
// native library, and it runs only when the user invokes that command or an
// embedder calls `installLibcurl` from `searchcast/install` (ADR 0002; imported
// by cli.ts and install-api.ts, never reachable from the main entry). On the
// pinned platforms npm normally installs the library with searchcast, as the
// platform package `@searchcast/libcurl-<platform>` (an optional dependency);
// this command is the fallback when optional dependencies were skipped. The
// release workflow builds those packages with this module's `fetchLibrary`
// (from scripts/libcurl-packages.mjs), so they are verified and unpacked
// exactly as an install is. It
// fetches the archive LIBCURL_IMPERSONATE pins for this platform (the same
// constant CI installs from), through the caller's proxy only, verifies its
// sha256 BEFORE writing anything, takes the one library file out of the
// archive and puts it in the data directory under `libraryFileName()`, where
// `resolveLibraryPath` finds it. It writes only to searchcast's data
// directory, never to serpcast's old one (which it does not even read: a
// library there is not "already installed"; ADR 0005). A file already there
// is left alone when it is identical, and replaced only with `force` when it
// differs. The write is a
// rename of a temporary file in the same directory, so a failure leaves either
// the old file or nothing, never a partial library.
//
// The size caps (MAX_ARCHIVE_BYTES, MAX_UNPACKED_BYTES) are safety ceilings:
// an embedder may LOWER them (`maxArchiveBytes`, `maxUnpackedBytes`), never
// raise them. The idle timeout stays internal. Exported to embedders through
// `searchcast/install` (install-api.ts), never from the main entry.

import {createHash} from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {describeProxy, download} from './download.js';
import {dataDir, libraryFileName} from './data-dir.js';
import {LIBCURL_IMPERSONATE} from './libcurl.js';
import {checkNumber} from './options.js';
import {readTarGz, type TarEntry} from './tar.js';

/** A pinned release: the shape of `LIBCURL_IMPERSONATE`. */
export interface Release {
	version: string;
	baseUrl: string;
	assets: Readonly<
		Record<string, {archive: string; sha256: string; library: string}>
	>;
}

export interface InstallOptions {
	/** Proxy for the download (`http://`, `socks5://`, `socks5h://`). */
	proxy?: string;
	/** Replace a differing library already in the data directory. */
	force?: boolean;
	/** Where `XDG_DATA_HOME` is read from. Default `process.env`. */
	env?: NodeJS.ProcessEnv;
	/** The release to install. Default `LIBCURL_IMPERSONATE` (tests pass a local one). */
	release?: Release;
	/** Progress lines (what is downloaded from where, where it went). */
	log?: (line: string) => void;
	/** Largest archive downloaded, in bytes. Default and ceiling `MAX_ARCHIVE_BYTES` (128 MiB): may only be lowered. */
	maxArchiveBytes?: number;
	/** Largest unpacked archive, in bytes. Default and ceiling `MAX_UNPACKED_BYTES` (512 MiB): may only be lowered. */
	maxUnpackedBytes?: number;
}

export interface InstallResult {
	/** The installed library. */
	path: string;
	/** Where the archive was downloaded from (after redirects). */
	url: string;
	/** `unchanged` when an identical file was already there. */
	status: 'installed' | 'replaced' | 'unchanged';
}

/**
 * A source to try instead, as data (`InstallError.suggestions`), so an
 * embedder can print its own command rather than searchcast's.
 */
export interface InstallSuggestion {
	/** The full `ipfs://` URL to install from, built from the verified listing. */
	source: string;
	/** What it may be: a release archive, or (a hint) a set directory. */
	kind: 'archive' | 'set-directory';
	/** The `--sha256` the user gave, kept on an archive suggestion only. */
	sha256?: string;
}

/** An install that did not happen; nothing was written. */
export class InstallError extends Error {
	override name = 'InstallError';
	/**
	 * Sources to try instead, in the order of the message's "Try:" list. Set
	 * only by install-recipes' refusal of an IPFS directory that is not a
	 * recipe set, and only when it has something to suggest (frozen).
	 */
	declare readonly suggestions?: readonly InstallSuggestion[];

	constructor(
		message: string,
		options?: ErrorOptions & {suggestions?: readonly InstallSuggestion[]},
	) {
		super(message, options);
		if (options?.suggestions?.length) {
			this.suggestions = Object.freeze(
				options.suggestions.map((s) => Object.freeze({...s})),
			);
		}
	}
}

/** The ceiling (and default) of `installLibcurl`'s `maxArchiveBytes`. */
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
/** The ceiling (and default) of `installLibcurl`'s `maxUnpackedBytes`. */
export const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;
const IDLE_TIMEOUT_MS = 60_000;

export async function installLibcurl(
	options: InstallOptions = {},
): Promise<InstallResult> {
	const release: Release = options.release ?? LIBCURL_IMPERSONATE;
	const platform = `${process.platform}-${process.arch}`;
	let fetched: FetchedLibrary;
	try {
		fetched = await fetchLibrary(platform, {
			release,
			proxy: options.proxy,
			log: options.log,
			maxArchiveBytes: options.maxArchiveBytes,
			maxUnpackedBytes: options.maxUnpackedBytes,
		});
	} catch (error) {
		if (!(error instanceof InstallError)) throw error; // a RangeError: a bad cap
		throw new InstallError(`${error.message} Nothing was installed.`, {
			cause: error.cause,
		});
	}
	const {library, url} = fetched;
	const log = options.log ?? (() => {});
	const dir = dataDir(options.env ?? process.env);
	const path = join(dir, libraryFileName());
	const existing = existsSync(path) ? readFileSync(path) : undefined;
	if (existing?.equals(library)) {
		log(`already installed: ${path}`);
		return {path, url, status: 'unchanged'};
	}
	if (existing && !options.force) {
		throw new InstallError(
			`${path} already exists and differs from libcurl-impersonate ${release.version}; rerun with --force to replace it. Nothing was installed.`,
		);
	}
	mkdirSync(dir, {recursive: true});
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(temporary, library, {mode: 0o644});
		renameSync(temporary, path);
	} catch (cause) {
		rmSync(temporary, {force: true});
		throw cause;
	}
	log(`installed ${path}`);
	return {path, url, status: existing ? 'replaced' : 'installed'};
}

/** What `fetchLibrary` got: the library's bytes and where they came from. */
export interface FetchedLibrary {
	/** The library file, taken unmodified out of the archive. */
	library: Buffer;
	/** Where the archive was downloaded from (after redirects). */
	url: string;
	/** The archive's file name and its verified sha256 (the pinned one). */
	archive: string;
	sha256: string;
}

export interface FetchOptions {
	/** The release. Default `LIBCURL_IMPERSONATE`. */
	release?: Release;
	proxy?: string;
	log?: (line: string) => void;
	/** Size caps; each at most (and by default) the ceiling. */
	maxArchiveBytes?: number;
	maxUnpackedBytes?: number;
}

/**
 * The download half of `installLibcurl`, for one pinned `platform`: download
 * its archive (through `proxy` only), verify its sha256 against the pin BEFORE
 * unpacking anything, and take the pinned `library` entry (a regular file,
 * never a symlink) out of it, within the size caps. Writes nothing. Shared by
 * `installLibcurl` and the release workflow's build of the platform packages
 * (scripts/libcurl-packages.mjs), so both verify and unpack the same way.
 * Throws an `InstallError` (after which nothing has been written anywhere).
 */
export async function fetchLibrary(
	platform: string,
	options: FetchOptions = {},
): Promise<FetchedLibrary> {
	const maxArchiveBytes =
		checkNumber('maxArchiveBytes', options.maxArchiveBytes, {
			integer: true,
			max: MAX_ARCHIVE_BYTES,
		}) ?? MAX_ARCHIVE_BYTES;
	const maxUnpackedBytes =
		checkNumber('maxUnpackedBytes', options.maxUnpackedBytes, {
			integer: true,
			max: MAX_UNPACKED_BYTES,
		}) ?? MAX_UNPACKED_BYTES;
	const release: Release = options.release ?? LIBCURL_IMPERSONATE;
	const log = options.log ?? (() => {});
	const asset = Object.hasOwn(release.assets, platform)
		? release.assets[platform]
		: undefined;
	if (!asset) {
		throw new InstallError(
			`no pinned libcurl-impersonate ${release.version} archive for ${platform} (pinned: ${Object.keys(release.assets).join(', ')}), so there is no platform package for it either. Install libcurl-impersonate yourself and set SEARCHCAST_LIBCURL_PATH to it.`,
		);
	}
	const url = release.baseUrl + asset.archive;
	let via = '';
	let archive: {url: string; body: Buffer};
	try {
		if (options.proxy) via = ` via ${describeProxy(options.proxy)}`;
		log(`downloading ${url}${via}`);
		archive = await download(url, {
			proxy: options.proxy,
			maxBytes: maxArchiveBytes,
			idleTimeoutMs: IDLE_TIMEOUT_MS,
		});
	} catch (cause) {
		throw new InstallError(
			`downloading ${url}${via} failed: ${(cause as Error).message}.`,
			{cause},
		);
	}
	const sha256 = createHash('sha256').update(archive.body).digest('hex');
	if (sha256 !== asset.sha256) {
		throw new InstallError(
			`checksum mismatch for ${asset.archive} (from ${archive.url}): got sha256 ${sha256}, pinned ${asset.sha256}.`,
		);
	}
	log(
		`verified sha256 ${sha256} (pinned for libcurl-impersonate ${release.version} ${platform})`,
	);
	const library = extract(archive.body, asset.library, maxUnpackedBytes);
	if (!library) {
		throw new InstallError(`${asset.archive} has no file ${asset.library}.`);
	}
	return {library, url: archive.url, archive: asset.archive, sha256};
}

/** The regular file `name` in a .tar.gz, or undefined. */
export function extract(
	targz: Buffer,
	name: string,
	maxUnpackedBytes = MAX_UNPACKED_BYTES,
): Buffer | undefined {
	let entries: TarEntry[];
	try {
		entries = readTarGz(targz, maxUnpackedBytes);
	} catch (cause) {
		throw new InstallError((cause as Error).message, {cause});
	}
	return entries.find(
		(entry) => entry.type === '0' && entry.path.replace(/^\.\//, '') === name,
	)?.body;
}
