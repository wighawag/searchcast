// scripts/libcurl-packages.mjs, which builds the per-platform packages
// `@searchcast/libcurl-<platform>` in CI, and the packages themselves. The
// build runs here against a local release server and fixture archives (no
// network), into throwaway repos under the OS temp dir, with searchcast's own
// `fetchLibrary` from the build (dist/), as in CI.

import {execFile} from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import {libraryFileName} from '../src/data-dir.js';
import {LIBCURL_IMPERSONATE} from '../src/libcurl.js';
import type {Release} from '../src/install.js';
import {
	LIBRARY,
	sha256,
	startReleaseServer,
	tarGz,
	tree,
	type ReleaseServer,
} from './release.js';
import {
	buildLibcurlPackages,
	LIBCURL_PLATFORMS,
	packageName,
	payloadFile,
	payloadProblems,
	STAMP,
	// @ts-expect-error - plain .mjs script, no types
} from '../../../scripts/libcurl-packages.mjs';
import {
	LIBCURL_LICENSE,
	LIBCURL_LINUX_LICENSE,
	PUBLISHABLE,
	// @ts-expect-error - plain .mjs script, no types
} from '../../../scripts/pack-check.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const run = promisify(execFile);
const manifestOf = (dir: string) =>
	JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

describe('the platform packages', () => {
	it('are one per pinned platform, each a dependency of searchcast pinned to its exact version', () => {
		expect(LIBCURL_PLATFORMS).toEqual(Object.keys(LIBCURL_IMPERSONATE.assets));
		const searchcast = manifestOf(join(repo, 'packages', 'searchcast'));
		expect(searchcast.optionalDependencies).toEqual(
			Object.fromEntries(
				LIBCURL_PLATFORMS.map((p: string) => [packageName(p), 'workspace:*']),
			),
		);
		for (const platform of LIBCURL_PLATFORMS) {
			expect(
				PUBLISHABLE.some(
					(e: {name: string}) => e.name === packageName(platform),
				),
			).toBe(true);
		}
	});

	it.each(LIBCURL_PLATFORMS as string[])(
		'%s: installs only on its platform, runs nothing on install, and packs only the library and its notices',
		(platform) => {
			const [os, cpu] = platform.split('-');
			const dir = join(repo, 'packages', `libcurl-${platform}`);
			const manifest = manifestOf(dir);
			const linux = os === 'linux';
			expect(manifest.name).toBe(`@searchcast/libcurl-${platform}`);
			expect(manifest.os).toEqual([os]);
			expect(manifest.cpu).toEqual([cpu]);
			// The pinned Linux archives are *-linux-gnu builds.
			expect(manifest.libc).toEqual(linux ? ['glibc'] : undefined);
			expect(manifest.scripts).toEqual({
				prepack: 'node ../../scripts/libcurl-packages.mjs check',
			});
			expect(manifest.files).toEqual([
				payloadFile(platform),
				'LICENSE',
				'CHANGELOG.md',
			]);
			// Nothing to import: `<name>/package.json` must stay resolvable.
			expect(manifest.main).toBeUndefined();
			expect(manifest.exports).toBeUndefined();
			expect(manifest.dependencies).toBeUndefined();
			expect(manifest.publishConfig).toEqual({access: 'public'});
			expect(manifest.repository).toEqual({
				type: 'git',
				url: 'git+https://github.com/wighawag/searchcast.git',
				directory: `packages/libcurl-${platform}`,
			});
			expect(manifest.license).toBe(
				linux ? LIBCURL_LINUX_LICENSE : LIBCURL_LICENSE,
			);
			// Under the name searchcast looks for.
			expect(payloadFile(platform)).toBe(
				libraryFileName(os as NodeJS.Platform),
			);
		},
	);

	it('carry the upstream license texts, the same in every package of one kind', () => {
		const text = (p: string) =>
			readFileSync(join(repo, 'packages', `libcurl-${p}`, 'LICENSE'), 'utf8');
		const linux = text('linux-x64');
		const others = text('darwin-x64');
		for (const p of LIBCURL_PLATFORMS)
			expect(text(p)).toBe(p.startsWith('linux-') ? linux : others);
		for (const license of [linux, others]) {
			for (const heading of [
				'curl-impersonate 2.1.1 (MIT)',
				'curl 8.21.0 (curl)',
				'BoringSSL (commit 156c7b75ae9b8c3b3f847acf264f17594c3859fb) (Apache-2.0)',
			])
				expect(license).toContain(`\n${heading}\n`);
			expect(license).toContain(
				`https://github.com/lexiforest/curl-impersonate/releases/tag/v${LIBCURL_IMPERSONATE.version}`,
			);
		}
		// Only the Linux builds link libidn2 (curl-impersonate's USE_LIBIDN2).
		expect(linux).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
		expect(others).not.toContain('libidn2');
	});
});

const lib = Buffer.from('the pinned library, as bytes');
const good = tarGz([
	{name: 'include/', type: '5'},
	{name: 'libcurl-impersonate.so', type: '2', link: LIBRARY},
	{name: LIBRARY, body: lib},
]);
const symlinkOnly = tarGz([
	{name: 'real.so', body: lib},
	{name: LIBRARY, type: '2', link: 'real.so'},
]);
const notAnArchive = Buffer.from('not a .tar.gz at all');

let server: ReleaseServer;
beforeAll(async () => {
	server = await startReleaseServer({
		'/rel/good.tar.gz': {status: 302, location: '/blob/good.tar.gz'},
		'/blob/good.tar.gz': good,
		'/rel/symlink.tar.gz': symlinkOnly,
		'/rel/junk.tar.gz': notAnArchive,
	});
});
afterAll(() => server.close());

/** A release pinning `archive` (with `checksum`) for each of `platforms`. */
function pinned(
	archive: string,
	checksum: string,
	platforms = ['linux-x64'],
): Release {
	return {
		version: '9.9.9',
		baseUrl: `${server.origin}/rel/`,
		assets: Object.fromEntries(
			platforms.map((p) => [p, {archive, sha256: checksum, library: LIBRARY}]),
		),
	};
}

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'libcurl-packages-'));
	server.hits.length = 0;
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

/** A copy of this repo's package for `platform` (manifest and notices) under `root`. */
function copyPackage(platform: string): string {
	const dir = join(root, 'packages', `libcurl-${platform}`);
	mkdirSync(dir, {recursive: true});
	for (const file of ['package.json', 'LICENSE', 'README.md', 'CHANGELOG.md'])
		copyFileSync(
			join(repo, 'packages', `libcurl-${platform}`, file),
			join(dir, file),
		);
	return dir;
}

describe('building a platform package', () => {
	it('verifies the pinned archive, then writes its library under the fixed name with a stamp', async () => {
		const dir = copyPackage('linux-x64');
		const release = pinned('good.tar.gz', sha256(good));
		const log: string[] = [];
		const written = await buildLibcurlPackages({
			root,
			release,
			log: (line: string) => log.push(line),
		});
		const path = join(dir, 'libcurl-impersonate.so');
		expect(readFileSync(path)).toEqual(lib);
		const stamp = {
			version: '9.9.9',
			archive: 'good.tar.gz',
			url: `${server.origin}/rel/good.tar.gz`,
			archiveSha256: sha256(good),
			library: 'libcurl-impersonate.so',
			librarySha256: sha256(lib),
		};
		expect(JSON.parse(readFileSync(join(dir, STAMP), 'utf8'))).toEqual(stamp);
		expect(written).toEqual([{platform: 'linux-x64', path, ...stamp}]);
		expect(log.slice(0, 2)).toEqual([
			`downloading ${server.origin}/rel/good.tar.gz`,
			`verified sha256 ${sha256(good)} (pinned for libcurl-impersonate 9.9.9 linux-x64)`,
		]);
		expect(await payloadProblems(dir, {release})).toEqual([]);
	});

	it('rejects an archive whose sha256 is not the pin before unpacking it, and writes nothing', async () => {
		const dir = copyPackage('linux-x64');
		const before = tree(root);
		for (const [archive, body] of [
			['good.tar.gz', good],
			['junk.tar.gz', notAnArchive], // unreadable: it is never even unpacked
		] as const) {
			const error = await buildLibcurlPackages({
				root,
				release: pinned(archive, '0'.repeat(64)),
			}).catch((e: Error) => e);
			expect(error.name).toBe('InstallError');
			expect(error.message).toBe(
				`checksum mismatch for ${archive} (from ${server.origin}/${archive === 'good.tar.gz' ? 'blob' : 'rel'}/${archive}): got sha256 ${sha256(body)}, pinned ${'0'.repeat(64)}.`,
			);
		}
		expect(tree(root)).toEqual(before);
		expect(existsSync(join(dir, 'libcurl-impersonate.so'))).toBe(false);
	});

	it('takes only a regular file: a symlink named like the library is refused', async () => {
		copyPackage('linux-x64');
		const before = tree(root);
		await expect(
			buildLibcurlPackages({
				root,
				release: pinned('symlink.tar.gz', sha256(symlinkOnly)),
			}),
		).rejects.toThrow(`symlink.tar.gz has no file ${LIBRARY}.`);
		expect(tree(root)).toEqual(before);
	});

	it('writes nothing unless every platform verifies', async () => {
		copyPackage('linux-x64');
		copyPackage('darwin-arm64');
		const before = tree(root);
		const verified = pinned('good.tar.gz', sha256(good), [
			'linux-x64',
			'darwin-arm64',
		]);
		const release = {
			...verified,
			assets: {
				...verified.assets,
				'darwin-arm64': {
					archive: 'junk.tar.gz',
					sha256: sha256(good),
					library: LIBRARY,
				},
			},
		};
		await expect(buildLibcurlPackages({root, release})).rejects.toThrow(
			/checksum mismatch for junk\.tar\.gz/,
		);
		expect(tree(root)).toEqual(before);
	});

	it('refuses a missing or mismatched package before any download', async () => {
		const release = pinned('good.tar.gz', sha256(good));
		await expect(buildLibcurlPackages({root, release})).rejects.toThrow(
			`libcurl-packages: no package at ${join(root, 'packages', 'libcurl-linux-x64')}`,
		);
		const dir = copyPackage('linux-x64');
		writeFileSync(
			join(dir, 'package.json'),
			JSON.stringify({...manifestOf(dir), name: '@searchcast/libcurl-other'}),
		);
		await expect(buildLibcurlPackages({root, release})).rejects.toThrow(
			/is @searchcast\/libcurl-other, expected @searchcast\/libcurl-linux-x64/,
		);
		expect(server.hits).toEqual([]);
	});

	it("reuses searchcast install-libcurl's fetchLibrary: no downloader or archive reader of its own", () => {
		const source = readFileSync(
			join(repo, 'scripts', 'libcurl-packages.mjs'),
			'utf8',
		);
		expect(source).toContain("load('install.js')");
		expect(source).toMatch(/fetchLibrary\(item\.platform, \{release, log\}\)/);
		for (const own of [
			'zlib',
			'gunzip',
			'readTarGz',
			'node:http',
			'node:https',
			'fetch(',
		])
			expect(source).not.toContain(own);
	});
});

describe('packing a platform package', () => {
	it('names what is wrong: no library, no stamp, another pin, a changed library', async () => {
		const dir = copyPackage('linux-x64');
		const release = pinned('good.tar.gz', sha256(good));
		const path = join(dir, 'libcurl-impersonate.so');
		const build = 'node scripts/libcurl-packages.mjs build linux-x64';
		expect(await payloadProblems(dir, {release})).toEqual([
			`no library at ${path}: build it with \`${build}\``,
		]);
		await buildLibcurlPackages({root, release});
		const otherPin = pinned('good.tar.gz', '1'.repeat(64));
		expect(await payloadProblems(dir, {release: otherPin})).toEqual([
			`${path} was built from good.tar.gz (sha256 ${sha256(good)}), not the pinned good.tar.gz (sha256 ${'1'.repeat(64)}): rebuild it with \`${build}\``,
		]);
		writeFileSync(path, 'something else');
		expect(await payloadProblems(dir, {release})).toEqual([
			`${path} is not the library ${STAMP} records: rebuild it with \`${build}\``,
		]);
		rmSync(join(dir, STAMP));
		expect(await payloadProblems(dir, {release})).toEqual([
			`no ${STAMP} next to ${path}: rebuild it with \`${build}\``,
		]);
	});

	it('fails through prepack without a library built from the real pin', async () => {
		const dir = copyPackage('linux-x64');
		// `node ../../scripts/...` from the package: this repo's script (and so
		// its searchcast build and its pins).
		symlinkSync(join(repo, 'scripts'), join(root, 'scripts'));
		const pack = () =>
			run('pnpm', ['pack', '--dry-run', '--json'], {cwd: dir, timeout: 60_000});
		const missing = await pack().catch(
			(e: {stdout: string; stderr: string}) => e,
		);
		expect(`${missing.stdout}${missing.stderr}`).toContain(
			`refusing to pack ${dir}: no library at ${join(dir, 'libcurl-impersonate.so')}`,
		);
		// Built from a fixture: not the pinned archive, so still refused.
		await buildLibcurlPackages({
			root,
			release: pinned('good.tar.gz', sha256(good)),
		});
		const stale = await pack().catch(
			(e: {stdout: string; stderr: string}) => e,
		);
		expect(`${stale.stdout}${stale.stderr}`).toContain(
			`was built from good.tar.gz (sha256 ${sha256(good)}), not the pinned ${LIBCURL_IMPERSONATE.assets['linux-x64'].archive}`,
		);
	}, 60_000);
});
