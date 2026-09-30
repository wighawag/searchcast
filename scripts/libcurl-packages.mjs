#!/usr/bin/env node
// Builds and checks the per-platform packages `@searchcast/libcurl-<platform>`
// (packages/libcurl-<platform>), which carry the pinned libcurl-impersonate
// library to npm as optional dependencies of `searchcast` (ADR 0005).
//
//   node scripts/libcurl-packages.mjs build [<platform>...]
//     For each platform (default: every one pinned), download the archive
//     named in LIBCURL_IMPERSONATE (packages/searchcast/src/libcurl.ts, the one
//     source of the pins: they are read from searchcast's build, never copied
//     here), verify its sha256 against the pin BEFORE unpacking, take the
//     pinned library entry (a regular file, not a symlink) and write it into
//     the package directory under the fixed name searchcast looks for
//     (`payloadFile`: libcurl-impersonate.so, .dylib or .dll), with a
//     `.payload.json` stamp of what it was built from. The download, the
//     verification, the archive validation and the size caps are
//     `fetchLibrary` of packages/searchcast/src/install.ts, the code
//     `searchcast install-libcurl` runs: there is no second downloader or tar
//     reader here. Every archive is fetched and verified before anything is
//     written, so a failure writes nothing. Run by the release workflow before
//     publishing (all platforms) and by CI (linux-x64); needs searchcast built.
//     The payload is gitignored: it is never committed.
//
//   node ../../scripts/libcurl-packages.mjs check
//     Each platform package's `prepack` (NOT an install script: it runs when
//     the package is packed or published, never when it is installed). Refuses
//     unless the package directory holds a payload built by `build` from the
//     current pin (the stamp names the pinned archive and its sha256, and the
//     payload's sha256 matches the stamp), so publishing a platform package
//     without its library, or with a stale one, fails.
//
// This script is the only place, besides `searchcast install-libcurl`, that
// downloads the library, and it runs only in CI (ADR 0002: nothing downloads
// at install or at run time).

import {createHash} from 'node:crypto';
import {
	existsSync,
	lstatSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

/**
 * The platforms with a package, `${process.platform}-${process.arch}` as keyed
 * in LIBCURL_IMPERSONATE.assets (a test keeps the two equal, and equal to
 * searchcast's optionalDependencies and to the package directories).
 */
export const LIBCURL_PLATFORMS = [
	'linux-x64',
	'linux-arm64',
	'darwin-x64',
	'darwin-arm64',
	'win32-x64',
];

/**
 * The payload's file name for `platform`: the name searchcast looks for
 * (`libraryFileName` of packages/searchcast/src/data-dir.ts, which a test
 * keeps equal to this), so the platform package holds the library under the
 * same name as the data directory does.
 */
export function payloadFile(platform) {
	const os = platform.slice(0, platform.indexOf('-'));
	if (os === 'darwin') return 'libcurl-impersonate.dylib';
	if (os === 'win32') return 'libcurl-impersonate.dll';
	return 'libcurl-impersonate.so';
}

/** The stamp `build` writes next to the payload (not packed). */
export const STAMP = '.payload.json';

/** The repo root: the parent of the `scripts/` directory holding this file. */
export function repoRoot() {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** The npm name of the platform package for `platform`. */
export function packageName(platform) {
	return `@searchcast/libcurl-${platform}`;
}

/** The directory of the platform package for `platform` in the repo at `root`. */
export function packageDir(root, platform) {
	return join(root, 'packages', `libcurl-${platform}`);
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * searchcast's compiled modules this script reuses: the pins and
 * `fetchLibrary`. From this repo's build (`pnpm build`).
 */
export async function searchcastModules() {
	const dist = join(repoRoot(), 'packages', 'searchcast', 'dist');
	if (!existsSync(join(dist, 'install.js'))) {
		throw new Error(
			`libcurl-packages: ${dist} is not built; run \`pnpm build\` first`,
		);
	}
	const load = (file) => import(pathToFileURL(join(dist, file)).href);
	const [{fetchLibrary}, {LIBCURL_IMPERSONATE}] = await Promise.all([
		load('install.js'),
		load('libcurl.js'),
	]);
	return {fetchLibrary, LIBCURL_IMPERSONATE};
}

/** The platform package's manifest at `dir`, checked to be the one for `platform`. */
function readManifest(dir, platform, payload) {
	const file = join(dir, 'package.json');
	if (!existsSync(file))
		throw new Error(`libcurl-packages: no package at ${dir}`);
	const manifest = JSON.parse(readFileSync(file, 'utf8'));
	if (manifest.name !== packageName(platform))
		throw new Error(
			`libcurl-packages: ${file} is ${manifest.name}, expected ${packageName(platform)}`,
		);
	if (!manifest.files?.includes(payload))
		throw new Error(
			`libcurl-packages: ${file} does not list ${payload} in its files`,
		);
	return manifest;
}

/**
 * Builds the platform packages of the repo at `root` for `platforms`
 * (default: every platform of the release). `release` defaults to
 * LIBCURL_IMPERSONATE (tests pass a local one). Resolves to what was written.
 */
export async function buildLibcurlPackages({
	root = repoRoot(),
	platforms,
	release,
	log = () => {},
	modules,
} = {}) {
	const {fetchLibrary, LIBCURL_IMPERSONATE} =
		modules ?? (await searchcastModules());
	release ??= LIBCURL_IMPERSONATE;
	platforms ??= Object.keys(release.assets);
	const planned = platforms.map((platform) => {
		const dir = packageDir(root, platform);
		const payload = payloadFile(platform);
		readManifest(dir, platform, payload);
		return {platform, dir, payload};
	});
	// Fetch and verify every archive first: a failure writes nothing.
	const fetched = [];
	for (const item of planned) {
		const got = await fetchLibrary(item.platform, {release, log});
		fetched.push({...item, ...got});
	}
	const written = [];
	for (const {
		platform,
		dir,
		payload,
		library,
		archive,
		sha256: hash,
	} of fetched) {
		const path = join(dir, payload);
		const temporary = `${path}.${process.pid}.tmp`;
		try {
			writeFileSync(temporary, library, {mode: 0o644});
			renameSync(temporary, path);
		} catch (cause) {
			rmSync(temporary, {force: true});
			throw cause;
		}
		const stamp = {
			version: release.version,
			archive,
			url: release.baseUrl + archive,
			archiveSha256: hash,
			library: payload,
			librarySha256: sha256(library),
		};
		writeFileSync(join(dir, STAMP), JSON.stringify(stamp, null, '\t') + '\n');
		log(`wrote ${path} (${library.length} bytes) from ${archive}`);
		written.push({platform, path, ...stamp});
	}
	return written;
}

/**
 * Why the platform package at `dir` must not be packed, as messages (empty
 * when it may be): no payload, no stamp, a stamp from another pin, or a
 * payload that is not the stamped one.
 */
export async function payloadProblems(dir, {release, modules} = {}) {
	const {LIBCURL_IMPERSONATE} = modules ?? (await searchcastModules());
	release ??= LIBCURL_IMPERSONATE;
	const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	const platform = String(manifest.name).replace(/^@searchcast\/libcurl-/, '');
	const asset = Object.hasOwn(release.assets, platform)
		? release.assets[platform]
		: undefined;
	if (!asset) return [`${manifest.name} is not a pinned platform package`];
	const path = join(dir, payloadFile(platform));
	const build = `node scripts/libcurl-packages.mjs build ${platform}`;
	if (!existsSync(path) || !lstatSync(path).isFile())
		return [`no library at ${path}: build it with \`${build}\``];
	const stampPath = join(dir, STAMP);
	if (!existsSync(stampPath))
		return [`no ${STAMP} next to ${path}: rebuild it with \`${build}\``];
	const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
	const problems = [];
	if (
		stamp.version !== release.version ||
		stamp.archive !== asset.archive ||
		stamp.archiveSha256 !== asset.sha256
	)
		problems.push(
			`${path} was built from ${stamp.archive} (sha256 ${stamp.archiveSha256}), not the pinned ${asset.archive} (sha256 ${asset.sha256}): rebuild it with \`${build}\``,
		);
	if (sha256(readFileSync(path)) !== stamp.librarySha256)
		problems.push(
			`${path} is not the library ${STAMP} records: rebuild it with \`${build}\``,
		);
	return problems;
}

// Compared through realpath: run through a symlink, the check must still run
// (a guard that silently does nothing would let a pack through).
const invokedDirectly =
	process.argv[1] &&
	realpathSync(resolve(process.argv[1])) ===
		realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	const [command, ...args] = process.argv.slice(2);
	const log = (line) => console.error(`libcurl-packages: ${line}`);
	try {
		if (command === 'build') {
			await buildLibcurlPackages({
				platforms: args.length ? args : undefined,
				log,
			});
		} else if (command === 'check' && args.length === 0) {
			const problems = await payloadProblems(process.cwd());
			if (problems.length) {
				for (const p of problems)
					log(`refusing to pack ${process.cwd()}: ${p}`);
				process.exit(1);
			}
		} else {
			console.error(
				'usage: libcurl-packages.mjs build [<platform>...] | check',
			);
			process.exit(2);
		}
	} catch (error) {
		log(error.message);
		process.exit(1);
	}
}
