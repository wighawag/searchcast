// scripts/pack-check.mjs, the repo-wide tarball guard run by the root `test`
// (on this repo's packages) and by `release:ci`. Here it runs on throwaway
// packages under the OS temp dir, packed for real with `pnpm pack --dry-run`.
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	checkAll,
	LIBCURL_LICENSE,
	packProblems,
	unlistedPackages,
	// @ts-expect-error - plain .mjs script, no types
} from '../../../scripts/pack-check.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const MIT = readFileSync(join(repo, 'packages', 'recipe', 'LICENSE'), 'utf8');
const AGPL = readFileSync(join(repo, 'LICENSE'), 'utf8');
const NOTICES = readFileSync(
	join(repo, 'packages', 'libcurl-darwin-x64', 'LICENSE'),
	'utf8',
);

let dirs: string[] = [];
afterEach(() => {
	for (const d of dirs) rmSync(d, {recursive: true, force: true});
	dirs = [];
});

const manifest = (name: string, extra: object = {}) => ({
	name,
	version: '0.0.0',
	license: 'MIT',
	repository: {
		type: 'git',
		url: 'git+https://github.com/wighawag/searchcast.git',
		directory: `packages/${name}`,
	},
	publishConfig: {access: 'public'},
	files: ['dist', 'CHANGELOG.md'],
	...extra,
});

/** A repo with one package `packages/<name>`: `files` maps paths to contents (null: absent). */
function repoWith(
	name: string,
	files: Record<string, string | null> = {},
	extra: object = {},
): string {
	const root = mkdtempSync(join(tmpdir(), 'pack-check-'));
	dirs.push(root);
	const dir = join(root, 'packages', name);
	const all: Record<string, string | null> = {
		'package.json': JSON.stringify(manifest(name, extra)),
		'README.md': `# ${name}\n`,
		LICENSE: MIT,
		'CHANGELOG.md': `# ${name}\n`,
		'dist/index.js': 'export {};\n',
		'dist/index.d.ts': 'export {};\n',
		...files,
	};
	for (const [path, content] of Object.entries(all)) {
		if (content === null) continue;
		mkdirSync(join(dir, path, '..'), {recursive: true});
		writeFileSync(join(dir, path), content);
	}
	return root;
}

const entry = (name: string, extra: object = {}) => ({
	dir: `packages/${name}`,
	name,
	license: 'MIT',
	...extra,
});

describe('pack check', () => {
	it('passes a package with the expected tarball and manifest', () => {
		const root = repoWith('good');
		const {ok, lines} = checkAll(root, [entry('good')]);
		expect(lines).toEqual(['pack-check: good ok (6 files)']);
		expect(ok).toBe(true);
	}, 60_000);

	it('fails on a missing LICENSE', () => {
		const root = repoWith('nolicense', {LICENSE: null});
		const {ok, lines} = checkAll(root, [entry('nolicense')]);
		expect(lines).toEqual([
			'pack-check: nolicense (packages/nolicense):',
			'  LICENSE is not in the tarball',
		]);
		expect(ok).toBe(false);
	}, 60_000);

	it('fails on a stray file in the tarball', () => {
		const root = repoWith(
			'junk',
			{'dist/.env': 'TOKEN=x\n', 'notes.txt': 'todo\n'},
			{files: ['dist', 'CHANGELOG.md', 'notes.txt']},
		);
		const {ok, lines} = checkAll(root, [entry('junk')]);
		expect(lines).toEqual([
			'pack-check: junk (packages/junk):',
			'  unexpected file in the tarball: dist/.env',
			'  unexpected file in the tarball: notes.txt',
		]);
		expect(ok).toBe(false);
	}, 60_000);

	it('fails on a missing extra file, and on no dist output', () => {
		const root = repoWith('bare', {
			'dist/index.js': null,
			'dist/index.d.ts': null,
		});
		const {ok, lines} = checkAll(root, [
			entry('bare', {extraFiles: ['integrations/searxng/searchcast.py']}),
		]);
		expect(lines).toEqual([
			'pack-check: bare (packages/bare):',
			'  integrations/searxng/searchcast.py is not in the tarball',
			'  no packed file matches /^dist\\/.+\\.(js|d\\.ts)(\\.map)?$/',
		]);
		expect(ok).toBe(false);
	}, 60_000);

	it('fails on the wrong license, in the manifest or in the LICENSE text', () => {
		const good = {
			entry: entry('p'),
			manifest: manifest('p'),
			files: [
				'CHANGELOG.md',
				'LICENSE',
				'README.md',
				'dist/a.js',
				'package.json',
			],
		};
		expect(packProblems({...good, licenseText: MIT})).toEqual([]);
		expect(packProblems({...good, licenseText: AGPL})).toEqual([
			'LICENSE is not the MIT text',
		]);
		expect(
			packProblems({
				...good,
				manifest: manifest('p', {license: 'AGPL-3.0-only'}),
				licenseText: MIT,
			}),
		).toEqual(['license is AGPL-3.0-only, expected MIT']);
		expect(
			packProblems({
				...good,
				entry: entry('p', {license: 'AGPL-3.0-only'}),
				manifest: manifest('p', {license: 'AGPL-3.0-only'}),
				licenseText: AGPL,
			}),
		).toEqual([]);
	});

	it('fails on a manifest that would not publish publicly from this repo', () => {
		const problems = packProblems({
			entry: entry('p'),
			manifest: manifest('p', {
				publishConfig: undefined,
				repository: {
					type: 'git',
					url: 'git+https://github.com/wighawag/serpcast.git',
					directory: 'packages/q',
				},
			}),
			files: [
				'CHANGELOG.md',
				'LICENSE',
				'README.md',
				'dist/a.js',
				'package.json',
			],
			licenseText: MIT,
		});
		expect(problems).toEqual([
			'publishConfig.access is not "public"',
			'repository.url is git+https://github.com/wighawag/serpcast.git, expected git+https://github.com/wighawag/searchcast.git',
			'repository.directory is packages/q, expected packages/p',
		]);
	});

	it('fails on a publishable package it does not list', () => {
		const root = repoWith('listed');
		mkdirSync(join(root, 'packages', 'new'));
		writeFileSync(
			join(root, 'packages', 'new', 'package.json'),
			'{"name":"new","version":"0.0.0"}',
		);
		mkdirSync(join(root, 'packages', 'internal'));
		writeFileSync(
			join(root, 'packages', 'internal', 'package.json'),
			'{"name":"internal","private":true}',
		);
		expect(unlistedPackages(root, [entry('listed')])).toEqual(['packages/new']);
		const {ok, lines} = checkAll(root, [entry('listed')]);
		expect(lines[0]).toBe(
			'pack-check: packages/new is publishable but not listed in scripts/pack-check.mjs PUBLISHABLE',
		);
		expect(ok).toBe(false);
	}, 60_000);

	it('takes a platform package with or without its library, and requires it with requirePayloads', () => {
		const platform = entry('libcurl-x', {
			license: LIBCURL_LICENSE,
			allow: [],
			payload: 'libcurl-impersonate.so',
		});
		const base = {
			entry: platform,
			manifest: manifest('libcurl-x', {license: LIBCURL_LICENSE}),
			licenseText: NOTICES,
		};
		const without = ['CHANGELOG.md', 'LICENSE', 'README.md', 'package.json'];
		const withLibrary = [...without, 'libcurl-impersonate.so'];
		expect(packProblems({...base, files: without})).toEqual([]);
		expect(packProblems({...base, files: withLibrary})).toEqual([]);
		expect(
			packProblems({...base, files: without, requirePayloads: true}),
		).toEqual(['libcurl-impersonate.so is not in the tarball']);
		expect(
			packProblems({...base, files: withLibrary, requirePayloads: true}),
		).toEqual([]);
		expect(
			packProblems({...base, files: [...withLibrary, 'libcurl-impersonate.a']}),
		).toEqual(['unexpected file in the tarball: libcurl-impersonate.a']);
		expect(packProblems({...base, files: without, licenseText: MIT})).toEqual([
			`LICENSE is not the ${LIBCURL_LICENSE} text`,
		]);
	});

	it('packs a platform package without running its prepack, which refuses without the library', () => {
		const root = repoWith(
			'libcurl-x',
			{
				LICENSE: NOTICES,
				'dist/index.js': null,
				'dist/index.d.ts': null,
			},
			{
				license: LIBCURL_LICENSE,
				files: ['libcurl-impersonate.so', 'LICENSE', 'CHANGELOG.md'],
				scripts: {prepack: 'exit 1'},
			},
		);
		const platform = entry('libcurl-x', {
			license: LIBCURL_LICENSE,
			allow: [],
			payload: 'libcurl-impersonate.so',
			ignoreScripts: true,
		});
		expect(checkAll(root, [platform])).toEqual({
			ok: true,
			lines: ['pack-check: libcurl-x ok (4 files)'],
		});
		const required = checkAll(root, [platform], {requirePayloads: true});
		expect(required.ok).toBe(false);
		expect(required.lines).toContain(
			'  libcurl-impersonate.so is not in the tarball',
		);
	}, 60_000);

	it('fails on a script that would run on install', () => {
		for (const script of ['preinstall', 'install', 'postinstall']) {
			expect(
				packProblems({
					entry: entry('p'),
					manifest: manifest('p', {scripts: {[script]: 'node x.js'}}),
					files: [
						'CHANGELOG.md',
						'LICENSE',
						'README.md',
						'dist/a.js',
						'package.json',
					],
					licenseText: MIT,
				}),
			).toEqual([`has an ${script} script (nothing may run on install)`]);
		}
	});

	it('lists every publishable package of this repo', () => {
		expect(unlistedPackages(repo)).toEqual([]);
	});
});
