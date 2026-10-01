// `searchcast install-recipes`: install a set of recipes from a release archive
// (a URL or a local file) or from IPFS (`ipfs://<cid>[/<path>]`, an archive or
// a set directory), only when the user types it (ADR 0002): imported by
// cli.ts and by `searchcast/install` (install-api.ts, for embedders), never by
// the main entry. Code recipes are code with
// full Node access, so what gets installed must be exactly what the user chose
// to trust: the archive's sha256 is REQUIRED for URLs and files and checked
// BEFORE anything is unpacked; for IPFS the CID is the pin (ipfs.ts verifies
// every block against it before anything is used), and a --sha256 given for
// an IPFS archive must match as well. The download reuses install-libcurl's
// (download.ts: the caller's proxy only, proxy environment ignored, no https
// to http redirect, a size cap) and the tar reader is tar.ts.
//
// The archive format is checked as a whole first (recipe-archive.ts), then
// the set is written to a temporary directory beside its destination and
// renamed into place, with a `.source.json` recording where it came from.
// The default base is `recipesDir()`, in searchcast's data directory: never
// serpcast's old one, whose sets are read but not written (ADR 0005).
//
// Decisions (task install-recipes-command, 2026-09-29):
// - `--name` wins over the manifest's name (the manifest only supplies the
//   default), so a set can be installed under another name; the manifest's
//   name stays recorded in `.source.json`. Alternative: refuse a mismatch.
// - `--proxy` with a local file is refused rather than ignored: the user
//   asked for an egress that would not be used. Alternative: ignore it.
// - A source is a URL only when it starts with `http://` or `https://` (or,
//   since install-recipes-from-ipfs, `ipfs://`); any other `scheme://` is
//   refused; everything else is a file path.
// - Hidden files (a leading '.', such as macOS `._x.js` AppleDouble files
//   and the reserved `.source.json`) are refused like other non-recipes.
// - Size caps: 16 MiB archive, 64 MiB unpacked (recipes are small text).
//   They are safety ceilings: `maxArchiveBytes` / `maxUnpackedBytes` may
//   lower them, never raise them (2026-09-30, tunables-and-install-api).
// - Replacing a set with `--force` is two renames (old set aside, new set in,
//   old set deleted), so there is an instant with no set, never a mixed one.
// - `manifest.json` is installed with the set (the set is a faithful copy of
//   the archive's recipe files), so a caller loading "every *.json" of a set
//   must skip it. Alternative: keep it only in `.source.json`.
// - An identical set already installed is left alone (`unchanged`), its
//   `.source.json` included, as install-libcurl leaves an identical library.
// - Set names are `[A-Za-z0-9][A-Za-z0-9._-]*` (at most 100), for --name and
//   the manifest alike, so a name is always one safe path segment.
// - In the CLI, a missing --sha256 is a usage error (exit 2), like any other
//   missing required option; installRecipes() itself also refuses it.
// - `recipes list` is the CLI's first `<noun> <verb>` command (the others are
//   single verbs); `recipes` takes only `list` today. It and install take
//   `--dir` to name another base directory (tests, or a caller's own layout).
//
// Decisions (task install-recipes-from-ipfs, 2026-10-01):
// - `ipfs://` is the one more source kind; other schemes stay refused. The
//   verified content decides the kind: a file is a release archive (same
//   checks), a directory is a set directory, held to an archive's file rules
//   (recipe-archive.ts `recipeDirectoryFiles`) and REQUIRED to hold a
//   `manifest.json` (the spec's "manifest.json and recipe files"), so a
//   folder of random JSON is not taken for a set; `--name` still overrides
//   its name. Alternative: a manifest only when there is no --name, as for
//   archives.
// - `--sha256` with an IPFS DIRECTORY is refused (before anything is
//   written, after the fetch, since only the content says it is a
//   directory; since ipfs-install-folder-hint, after the listing request,
//   before the files are fetched): there are no archive bytes to compare, and silently ignoring
//   a pin the user typed would let them believe it was checked.
//   Alternative: ignore it, or hash some canonical listing (a format of our
//   own that no publisher would ship).
// - `ipfsGateways` (CLI `--ipfs-gateway`) with a non-IPFS source is refused,
//   like `--proxy` with a file: the user asked for something that would not
//   be used. This holds for the API too (an embedder passing gateways for
//   every install must pass them for `ipfs://` sources only).
// - Caps: the CAR is held to `maxArchiveBytes` and the reassembled content
//   to `maxUnpackedBytes`; an IPFS archive file is also held to
//   `maxArchiveBytes` like a downloaded one. No new tunable.
// - `.source.json` for IPFS: `source` (the ipfs:// URL as given), `cid`
//   (the ROOT CID, as given; with the path in `source` it is the pin), and
//   `gateway` (whose CAR verified; a record, not a trust); `sha256` is the
//   archive's for an archive, absent for a directory (so `sha256` became
//   optional in `RecipeSetSource`), and there is no `url`.
// - `DEFAULT_IPFS_GATEWAYS` is exported from `searchcast/install`, so an
//   embedder can add its own gateway in front of the defaults.
//
// Decisions (task ipfs-install-folder-hint, 2026-10-01):
// - An IPFS directory is judged from its verified LISTING (ipfs.ts'
//   `checkListing`, after one `dag-scope=entity` request) before any file is
//   fetched: the name rules and the required `manifest.json`
//   (recipe-archive.ts `recipeDirectoryProblem`, the same rules
//   `recipeDirectoryFiles` still applies to the fetched files), then the
//   `--sha256` refusal. When both apply, the not-a-set refusal wins: it is
//   the more useful message, and its archive suggestion keeps the pin.
// - The not-a-set refusal lists the directory's entries (at most 20, each
//   JSON-quoted so no name can forge a line, then "and N more") and up to 6
//   commands to try, built from verified names only (percent-encoded in the
//   URL): `searchcast install-recipes ipfs://<cid>/<path>/<entry>` for each
//   `*.tar.gz` entry (with `--sha256 <hex>` when one was given), then for
//   each entry that may be a set directory. The commands name the CLI even
//   through the API (`searchcast/install`): an embedder shows the URL to
//   use; the other options the user gave (`--ipfs-gateway`, `--proxy`,
//   `--name`, `--dir`) are not repeated, so the command stays short.
//   Alternative: repeat every option given (long, and wrong for an API).
// - "May be a set directory" is a name that is not hidden, not `*.tar.gz`
//   and has no file extension (a '.' then a letter and up to 9 letters or
//   digits): `x` and `my-set-1.2.0` may be, `README.txt` and
//   `x.tar.gz.sha256` may not. The task's literal "no recipe file
//   extension" would also suggest `README.txt` and the `.sha256` file as set
//   directories; the listing cannot say which entries ARE directories (only
//   their own blocks, not fetched, would), so this is a hint and the
//   entries are listed anyway. Alternative: the literal reading.

import {createHash} from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {join, resolve} from 'node:path';
import {describeProxy, download} from './download.js';
import {InstallError} from './install.js';
import {fetchIpfs, ipfsUrl, type IpfsListing} from './ipfs.js';
import {checkNumber} from './options.js';
import {recipesDir, SOURCE_FILE, type RecipeSetSource} from './recipes.js';
import {
	MAX_ARCHIVE_BYTES,
	MAX_UNPACKED_BYTES,
	readManifest,
	recipeDirectoryFiles,
	recipeDirectoryProblem,
	recipeFiles,
	setName,
} from './recipe-archive.js';

export interface InstallRecipesOptions {
	/** The archive's expected sha256 (hex). Required, except for an `ipfs://` source (the CID pins it; if given for an IPFS archive it must match too, and it is refused for an IPFS directory). */
	sha256?: string;
	/** The set's name; default the archive's `manifest.json` name. */
	name?: string;
	/** The base directory; default `recipesDir(env)`. */
	dir?: string;
	/** Proxy for a URL or IPFS download (`http://`, `socks5://`, `socks5h://`). */
	proxy?: string;
	/** Trustless gateways (base URLs) for an `ipfs://` source, tried in order. Default `DEFAULT_IPFS_GATEWAYS`; refused for other sources. */
	ipfsGateways?: readonly string[];
	/** Replace a differing set already installed under the same name. */
	force?: boolean;
	/** Where `XDG_DATA_HOME` is read from. Default `process.env`. */
	env?: NodeJS.ProcessEnv;
	/** Progress lines (what is read from where, each file installed). */
	log?: (line: string) => void;
	/** Largest archive, in bytes. Default and ceiling `MAX_ARCHIVE_BYTES` (16 MiB): may only be lowered. */
	maxArchiveBytes?: number;
	/** Largest unpacked archive, in bytes. Default and ceiling `MAX_UNPACKED_BYTES` (64 MiB): may only be lowered. */
	maxUnpackedBytes?: number;
}

export interface InstallRecipesResult {
	/** The set's name. */
	name: string;
	/** The set's directory. */
	dir: string;
	/** Each installed file with its sha256. */
	files: Record<string, string>;
	/** `unchanged` when an identical set was already there. */
	status: 'installed' | 'replaced' | 'unchanged';
}

export {MAX_ARCHIVE_BYTES} from './recipe-archive.js';
const IDLE_TIMEOUT_MS = 60_000;
const NOTHING = 'Nothing was installed.';

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export async function installRecipes(
	source: string,
	options: InstallRecipesOptions,
): Promise<InstallRecipesResult> {
	const log = options.log ?? (() => {});
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
	const ipfs = IPFS.test(source);
	const pinned =
		options.sha256 === undefined && ipfs
			? undefined
			: (options.sha256 ?? '').toLowerCase();
	if (pinned !== undefined && !/^[0-9a-f]{64}$/.test(pinned)) {
		throw new InstallError(
			ipfs
				? `--sha256 must be 64 hex digits (or left out: the CID pins ${source}). ${NOTHING}`
				: `--sha256 <hex> is required: the archive's sha256 is the trust decision (recipes are code). ${NOTHING}`,
		);
	}
	if (options.ipfsGateways !== undefined && !ipfs) {
		throw new InstallError(
			`--ipfs-gateway applies to an ipfs:// source only, and ${source} is not one. ${NOTHING}`,
		);
	}
	if (options.name !== undefined) setName(options.name, '--name');
	const limits = {maxArchiveBytes, maxUnpackedBytes};
	const got: Fetched = ipfs
		? await fetchFromIpfs(source, options, limits, pinned, log)
		: {archive: await fetchArchive(source, options, maxArchiveBytes, log)};
	let files: Map<string, Buffer>;
	let sha256: string | undefined;
	if (got.archive) {
		sha256 = hash(got.archive.body);
		if (pinned !== undefined && sha256 !== pinned) {
			throw new InstallError(
				`checksum mismatch for ${got.archive.url ?? source}: got sha256 ${sha256}, pinned ${pinned}. ${NOTHING}`,
			);
		}
		log(
			pinned !== undefined
				? `verified sha256 ${sha256} (pinned with --sha256)`
				: `archive sha256 ${sha256} (not pinned: the CID pins it)`,
		);
		files = recipeFiles(got.archive.body, maxUnpackedBytes);
	} else {
		if (pinned !== undefined) {
			throw new InstallError(
				`--sha256 pins an archive's bytes, and ${source} is a directory (the CID pins it): leave --sha256 out. ${NOTHING}`,
			);
		}
		files = recipeDirectoryFiles(got.directory!, source, maxUnpackedBytes);
	}
	const manifest = readManifest(files.get('manifest.json'));
	const name = options.name ?? manifest?.name;
	if (name === undefined) {
		throw new InstallError(
			`the ${got.archive ? 'archive' : 'directory'} has no manifest.json name; give the set a name with --name. ${NOTHING}`,
		);
	}
	const base = options.dir ?? recipesDir(options.env ?? process.env);
	const dir = join(base, name);
	const hashes = Object.fromEntries(
		[...files].map(([file, body]) => [file, hash(body)]),
	);
	const report = (status: InstallRecipesResult['status']) => {
		for (const [file, digest] of Object.entries(hashes)) {
			log(`  ${file}  sha256 ${digest}`);
		}
		return {name, dir, files: hashes, status};
	};
	const existing = existsSync(dir);
	if (existing && sameSet(dir, files)) {
		log(`already installed: ${dir}`);
		return report('unchanged');
	}
	if (existing && !options.force) {
		throw new InstallError(
			`${dir} already exists and differs from this archive; rerun with --force to replace it. ${NOTHING}`,
		);
	}
	const local = !ipfs && !got.archive?.url;
	const record: RecipeSetSource = {
		source: local ? resolve(source) : source,
		...(got.archive?.url ? {url: got.archive.url} : {}),
		...(got.ipfs ?? {}),
		...(sha256 !== undefined ? {sha256} : {}),
		...(manifest ? {manifest} : {}),
		files: hashes,
		installedAt: new Date().toISOString(),
	};
	mkdirSync(base, {recursive: true});
	const temporary = join(base, `.${name}.${process.pid}.tmp`);
	const aside = join(base, `.${name}.${process.pid}.old`);
	let moved = false;
	try {
		rmSync(temporary, {recursive: true, force: true});
		mkdirSync(temporary);
		for (const [file, body] of files) {
			writeFileSync(join(temporary, file), body, {mode: 0o644});
		}
		writeFileSync(
			join(temporary, SOURCE_FILE),
			JSON.stringify(record, null, '\t') + '\n',
		);
		if (existing) {
			renameSync(dir, aside);
			moved = true;
		}
		renameSync(temporary, dir);
		moved = false;
	} catch (cause) {
		rmSync(temporary, {recursive: true, force: true});
		if (moved) renameSync(aside, dir);
		throw cause;
	}
	rmSync(aside, {recursive: true, force: true});
	log(`installed recipe set ${name} in ${dir}:`);
	return report(existing ? 'replaced' : 'installed');
}

const IPFS = /^ipfs:\/\//i;

/** What a source gave: an archive (with its final URL for a download) or, from IPFS only, a directory's files. */
interface Fetched {
	archive?: {body: Buffer; url?: string};
	directory?: Map<string, Buffer>;
	/** For an `ipfs://` source: the root CID and the gateway whose CAR verified. */
	ipfs?: {cid: string; gateway: string};
}

/** An `ipfs://` source's verified content: an archive file or a set directory, and where it came from. */
async function fetchFromIpfs(
	source: string,
	options: InstallRecipesOptions,
	limits: {maxArchiveBytes: number; maxUnpackedBytes: number},
	pinned: string | undefined,
	log: (line: string) => void,
): Promise<Fetched> {
	let fetched;
	try {
		fetched = await fetchIpfs(source, {
			ipfsGateways: options.ipfsGateways,
			proxy: options.proxy,
			maxCarBytes: limits.maxArchiveBytes,
			maxBytes: limits.maxUnpackedBytes,
			log,
			checkListing: (listing) => checkSetListing(listing, pinned),
		});
	} catch (cause) {
		if (!(cause instanceof InstallError)) throw cause;
		throw new InstallError(`${cause.message}. ${NOTHING}`, {cause});
	}
	const {content, cid, gateway} = fetched;
	const ipfs = {cid, gateway};
	if (content.type === 'directory') return {directory: content.files, ipfs};
	if (content.bytes.length > limits.maxArchiveBytes) {
		throw new InstallError(
			`${source} is larger than ${limits.maxArchiveBytes} bytes. ${NOTHING}`,
		);
	}
	return {archive: {body: content.bytes}, ipfs};
}

const LISTED_ENTRIES = 20;
const SUGGESTED_COMMANDS = 6;

/**
 * Refuse an IPFS directory from its verified listing, before its files are
 * fetched: one that cannot be a recipe set (naming its entries and the
 * commands to try instead), or any directory when --sha256 was given.
 */
function checkSetListing(listing: IpfsListing, pinned: string | undefined) {
	const {source, cid, segments, names} = listing;
	const problem = recipeDirectoryProblem(names, source);
	if (problem) {
		const shown = names
			.slice(0, LISTED_ENTRIES)
			.map((name) => JSON.stringify(name))
			.join(', ');
		const more =
			names.length > LISTED_ENTRIES
				? ` and ${names.length - LISTED_ENTRIES} more`
				: '';
		const command = (name: string) =>
			`searchcast install-recipes ${ipfsUrl(cid, [...segments, name])}`;
		const commands = [
			...names
				.filter((name) => name.endsWith('.tar.gz') && !name.startsWith('.'))
				.map(
					(name) =>
						`${command(name)}${pinned !== undefined ? ` --sha256 ${pinned}` : ''} (a release archive)`,
				),
			...names
				.filter(maybeSetDirectory)
				.map((name) => `${command(name)} (may be a set directory)`),
		].slice(0, SUGGESTED_COMMANDS);
		throw new InstallError(
			`${problem}; it holds ${names.length ? `${shown}${more}` : 'nothing'}${commands.length ? `. Try: ${commands.join('; or ')}` : ''}`,
		);
	}
	if (pinned !== undefined) {
		throw new InstallError(
			`--sha256 pins an archive's bytes, and ${source} is a directory (the CID pins it): leave --sha256 out`,
		);
	}
}

/**
 * Whether a directory entry's name may be a set directory's: not hidden, not
 * a recipe file or an archive, and no file extension (a '.' then a letter
 * and up to 9 letters or digits), so `my-set-1.2.0` may be and `README.txt`
 * or `x.tar.gz.sha256` may not. The listing does not say which entries are
 * directories (only their own blocks would), so this is a hint.
 */
function maybeSetDirectory(name: string): boolean {
	return (
		!name.startsWith('.') &&
		!name.endsWith('.tar.gz') &&
		!/\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(name)
	);
}

/** The archive's bytes, and the final URL for a download. */
async function fetchArchive(
	source: string,
	options: InstallRecipesOptions,
	maxArchiveBytes: number,
	log: (line: string) => void,
): Promise<{body: Buffer; url?: string}> {
	if (/^https?:\/\//i.test(source)) {
		let via = '';
		try {
			if (options.proxy) via = ` via ${describeProxy(options.proxy)}`;
			log(`downloading ${source}${via}`);
			return await download(source, {
				proxy: options.proxy,
				maxBytes: maxArchiveBytes,
				idleTimeoutMs: IDLE_TIMEOUT_MS,
			});
		} catch (cause) {
			throw new InstallError(
				`downloading ${source}${via} failed: ${(cause as Error).message}. ${NOTHING}`,
				{cause},
			);
		}
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
		throw new InstallError(
			`${source} is neither an http(s) URL nor a file path (nor an ipfs:// URL). ${NOTHING}`,
		);
	}
	if (options.proxy) {
		throw new InstallError(
			`--proxy applies to a download only, and ${source} is a local file. ${NOTHING}`,
		);
	}
	log(`reading ${resolve(source)}`);
	try {
		if (statSync(source).size > maxArchiveBytes) {
			throw new Error(`larger than ${maxArchiveBytes} bytes`);
		}
		return {body: readFileSync(source)};
	} catch (cause) {
		throw new InstallError(
			`reading ${source} failed: ${(cause as Error).message}. ${NOTHING}`,
			{cause},
		);
	}
}

/** Whether `dir` holds exactly `files` (besides `.source.json`). */
function sameSet(dir: string, files: Map<string, Buffer>): boolean {
	try {
		const present = readdirSync(dir).filter((f) => f !== SOURCE_FILE);
		return (
			present.length === files.size &&
			present.every((f) => files.get(f)?.equals(readFileSync(join(dir, f))))
		);
	} catch {
		return false;
	}
}
