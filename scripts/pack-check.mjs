#!/usr/bin/env node
// Pack guard: what each publishable package would put in its npm tarball, and
// the manifest fields a publish depends on, checked before npm sees them.
// For every package in PUBLISHABLE:
//   - the file list of a pack dry run has exactly the expected shape: README.md,
//     LICENSE, CHANGELOG.md, package.json, the package's `extraFiles`, and
//     otherwise only files matching its `allow` patterns (by default the
//     compiled `dist/` output), each pattern matching at least one file;
//   - `publishConfig.access` is `public`, `repository.url` is this repo and
//     `repository.directory` the package's directory;
//   - `license` is the expected one and the packed LICENSE file is that
//     license's text (MIT for `@searchcast/recipe`, AGPL-3.0-only for the
//     other code packages, the combined notices for the platform packages);
//   - no `install`, `preinstall` or `postinstall` script: installing a package
//     never runs anything.
// Every non-private workspace package must be listed, so a new package cannot
// be published unchecked: add it to PUBLISHABLE with its `extraFiles`/`allow`.
//
// The per-platform `@searchcast/libcurl-<platform>` packages
// (scripts/libcurl-packages.mjs) carry no code: their tarball is exactly the
// library (`payload`), LICENSE, README.md, CHANGELOG.md and package.json. The
// library is built only in CI, so it is absent from a plain checkout (and from
// CI's test job for every platform but linux-x64): the check accepts the
// tarball with or without it, and packs them without running `prepack`, which
// is each platform package's refusal to pack without a verified library. With
// `--require-payloads` (the release, after building every one) the library
// must be there too.
//
// The dry run is `pnpm pack --dry-run --json`: the release publishes with pnpm
// (`changeset publish` in a pnpm workspace), and pnpm runs `prepack`, which is
// what puts the root README.md and LICENSE into `searchcast` (see
// scripts/copy-publish-assets.mjs). Needs the packages built (`dist/`).
// Run by the root `test` (hence `verify`) and by `release:ci` (with
// `--require-payloads`).

import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	LIBCURL_PLATFORMS,
	packageName,
	payloadFile,
} from './libcurl-packages.mjs';

/**
 * The compiled output: JavaScript and declarations. No source or declaration
 * maps: packages ship only dist/, not src/, so a map would point at files the
 * tarball does not contain (see tsconfig.base.json).
 */
export const DIST_FILES = /^dist\/.+\.(js|d\.ts)$/;

/** Files every tarball has. */
export const ALWAYS = ['CHANGELOG.md', 'LICENSE', 'README.md', 'package.json'];

export const REPOSITORY_URL = 'git+https://github.com/wighawag/searchcast.git';

/**
 * The `license` of the platform packages: every component the library links
 * statically, plus libidn2 (with its included libunistring and Unicode data)
 * in the Linux builds only (see each package's LICENSE).
 */
export const LIBCURL_LICENSE =
	'MIT AND curl AND Apache-2.0 AND BSD-3-Clause AND Zlib';
export const LIBCURL_LINUX_LICENSE = `${LIBCURL_LICENSE} AND (LGPL-3.0-or-later OR GPL-2.0-or-later) AND Unicode-DFS-2016`;

const LIBCURL_NOTICES =
	/^Licenses of the libcurl-impersonate library in this package\n/;

/** What the LICENSE text of each accepted license starts with or contains. */
export const LICENSE_TEXTS = {
	MIT: /^MIT License\b/,
	'AGPL-3.0-only': /^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/,
	[LIBCURL_LICENSE]: LIBCURL_NOTICES,
	[LIBCURL_LINUX_LICENSE]: LIBCURL_NOTICES,
};

/** Scripts that would run when the package is installed. */
export const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

/**
 * The publishable packages: `dir` relative to the repo root, the npm `name`,
 * the `license`, `extraFiles` (exact paths that must be packed besides ALWAYS),
 * `allow` (patterns any other packed file must match; default DIST_FILES),
 * and for the platform packages `payload` (the library: packed when built,
 * required with `requirePayloads`) and `ignoreScripts` (pack without
 * `prepack`).
 */
export const PUBLISHABLE = [
	{dir: 'packages/recipe', name: '@searchcast/recipe', license: 'MIT'},
	{
		dir: 'packages/browser',
		name: '@searchcast/browser',
		license: 'AGPL-3.0-only',
	},
	{
		dir: 'packages/searchcast',
		name: 'searchcast',
		license: 'AGPL-3.0-only',
		// SearXNG settings name this path (it was there in searchcast 0.1.x).
		extraFiles: ['integrations/searxng/searchcast.py'],
	},
	...LIBCURL_PLATFORMS.map((platform) => ({
		dir: `packages/libcurl-${platform}`,
		name: packageName(platform),
		license: platform.startsWith('linux-')
			? LIBCURL_LINUX_LICENSE
			: LIBCURL_LICENSE,
		allow: [],
		payload: payloadFile(platform),
		ignoreScripts: true,
	})),
];

/**
 * The problems with one package, as messages (empty when it is fine).
 * `files` is the packed file list, `licenseText` the packed LICENSE's content
 * (undefined when there is none).
 */
export function packProblems({
	entry,
	manifest,
	files,
	licenseText,
	requirePayloads = false,
}) {
	const problems = [];
	const allow = entry.allow ?? [DIST_FILES];
	const payload = entry.payload ? [entry.payload] : [];
	const required = [
		...ALWAYS,
		...(entry.extraFiles ?? []),
		...(requirePayloads ? payload : []),
	];
	const optional = requirePayloads ? [] : payload;
	const packed = new Set(files);

	if (manifest.name !== entry.name)
		problems.push(`name is ${manifest.name}, expected ${entry.name}`);
	for (const file of required)
		if (!packed.has(file)) problems.push(`${file} is not in the tarball`);
	for (const pattern of allow)
		if (!files.some((f) => pattern.test(f)))
			problems.push(`no packed file matches ${pattern}`);
	for (const file of files)
		if (
			!required.includes(file) &&
			!optional.includes(file) &&
			!allow.some((p) => p.test(file))
		)
			problems.push(`unexpected file in the tarball: ${file}`);
	for (const script of INSTALL_SCRIPTS)
		if (manifest.scripts?.[script] !== undefined)
			problems.push(`has an ${script} script (nothing may run on install)`);

	if (manifest.publishConfig?.access !== 'public')
		problems.push('publishConfig.access is not "public"');
	if (manifest.repository?.url !== REPOSITORY_URL)
		problems.push(
			`repository.url is ${manifest.repository?.url}, expected ${REPOSITORY_URL}`,
		);
	if (manifest.repository?.directory !== entry.dir)
		problems.push(
			`repository.directory is ${manifest.repository?.directory}, expected ${entry.dir}`,
		);
	if (manifest.license !== entry.license)
		problems.push(`license is ${manifest.license}, expected ${entry.license}`);
	const text = LICENSE_TEXTS[entry.license];
	if (!text) problems.push(`no known LICENSE text for ${entry.license}`);
	else if (licenseText !== undefined && !text.test(licenseText))
		problems.push(`LICENSE is not the ${entry.license} text`);
	return problems;
}

/**
 * The files `pnpm pack` would put in the tarball of the package at `dir`
 * (with `ignoreScripts`, without running its `prepack`).
 */
export function packedFiles(dir, {ignoreScripts = false} = {}) {
	const args = ['pack', '--dry-run', '--json'];
	if (ignoreScripts) args.push('--config.ignore-scripts=true');
	const out = execFileSync('pnpm', args, {
		cwd: dir,
		encoding: 'utf8',
		timeout: 120_000,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	// Lifecycle scripts (prepack) print before the JSON, on the same stream.
	const start = out.search(/^\{$/m);
	if (start === -1)
		throw new Error(`pack-check: no JSON from pnpm pack in ${dir}:\n${out}`);
	const {files} = JSON.parse(out.slice(start));
	return files.map((f) => f.path).sort();
}

/** Packs the package `entry` of the repo at `root` and checks it. */
export function checkPackage(root, entry, {requirePayloads = false} = {}) {
	const dir = join(root, entry.dir);
	const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	const files = packedFiles(dir, {ignoreScripts: entry.ignoreScripts});
	const license = join(dir, 'LICENSE');
	const licenseText =
		files.includes('LICENSE') && existsSync(license)
			? readFileSync(license, 'utf8')
			: undefined;
	return {
		files,
		problems: packProblems({
			entry,
			manifest,
			files,
			licenseText,
			requirePayloads,
		}),
	};
}

/** Non-private packages under `root`/packages that PUBLISHABLE does not list. */
export function unlistedPackages(root, publishable = PUBLISHABLE) {
	const base = join(root, 'packages');
	const listed = new Set(publishable.map((e) => e.dir));
	return readdirSync(base, {withFileTypes: true})
		.filter((d) => d.isDirectory())
		.map((d) => `packages/${d.name}`)
		.filter((dir) => {
			const pkg = join(root, dir, 'package.json');
			if (!existsSync(pkg)) return false;
			return !JSON.parse(readFileSync(pkg, 'utf8')).private;
		})
		.filter((dir) => !listed.has(dir));
}

/**
 * Runs the check on every package; returns `{ok, lines}`. With
 * `requirePayloads`, every platform package must have its library.
 */
export function checkAll(
	root,
	publishable = PUBLISHABLE,
	{requirePayloads = false} = {},
) {
	const lines = [];
	let ok = true;
	for (const dir of unlistedPackages(root, publishable)) {
		ok = false;
		lines.push(
			`pack-check: ${dir} is publishable but not listed in scripts/pack-check.mjs PUBLISHABLE`,
		);
	}
	for (const entry of publishable) {
		const {files, problems} = checkPackage(root, entry, {requirePayloads});
		if (problems.length) {
			ok = false;
			lines.push(`pack-check: ${entry.name} (${entry.dir}):`);
			lines.push(...problems.map((p) => `  ${p}`));
		} else {
			lines.push(`pack-check: ${entry.name} ok (${files.length} files)`);
		}
	}
	return {ok, lines};
}

const invokedDirectly =
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	const root = dirname(dirname(fileURLToPath(import.meta.url)));
	const args = process.argv.slice(2);
	const unknown = args.filter((a) => a !== '--require-payloads');
	if (unknown.length) {
		console.error(`pack-check: unknown argument ${unknown[0]}`);
		process.exit(2);
	}
	const {ok, lines} = checkAll(root, PUBLISHABLE, {
		requirePayloads: args.includes('--require-payloads'),
	});
	(ok ? console.log : console.error)(lines.join('\n'));
	process.exit(ok ? 0 : 1);
}
