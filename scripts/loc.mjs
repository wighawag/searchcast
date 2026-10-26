#!/usr/bin/env node
// The README's "Size discipline (per-module LOC)" table, generated. `pnpm loc`
// rewrites it; `pnpm check:loc` (`--check`, run by the root `test`, hence the
// verify gate) fails when it is out of date.
//
// LOC is what the table's header says: the actual line count of the source
// file (its newline-terminated lines, plus a last line without one; `wc -l`
// for a file that ends with a newline). Nothing is excluded: blank lines and
// comments count.
//
// Each row names its file by its path from the repo root
// (`packages/<pkg>/src/<file>`), so no row is ambiguous across packages. The
// script keeps the rows' order and their `target` as authored, and only
// rewrites the LOC cells. It refuses a row whose file does not exist (remove
// or rename the row by hand). A source file under `packages/*/src` without a
// row gets one, appended to the table of the subsection whose heading names
// its package (`packages/<pkg>` in backticks), or to a new subsection when
// there is none; its target is `-` (no ceiling yet: set one by hand). The
// "Total own source" line is the sum over every row.
//
// Decisions (task `loc-table-generated`):
// - Rows hold repo-root paths rather than `src/...` under a package heading:
//   a row then names its file on its own, and the script needs no heading
//   parsing to find it (headings only place new rows).
// - The total now covers every package (it covered `packages/searchcast/src`
//   only), since every package's files now have rows.
// - New rows (here, all of `packages/browser`) get target `-`: a ceiling is a
//   human judgement, not something to derive from today's size.
// - The check runs first in the root `test` (and `test:ci`), next to the other
//   repo guards, rather than in `format:check`, which stays prettier only.

import {
	existsSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isMain} from './is-main.mjs';

const SECTION = '## Size discipline (per-module LOC)';
const ROW = /^\|\s*`([^`]+)`\s*\|\s*[^|]*\|\s*([^|]*?)\s*\|\s*$/;
const TOTAL = /^\*\*Total own source: \d+ LOC\*\*.*$/;

/** The actual line count of `text`. */
export function lineCount(text) {
	if (text === '') return 0;
	const newlines = text.split('\n').length - 1;
	return text.endsWith('\n') ? newlines : newlines + 1;
}

/** Every file under `packages/*\/src` of `root`, as sorted root-relative paths. */
export function sourceFiles(root) {
	const files = [];
	const walk = (rel) => {
		for (const name of readdirSync(join(root, rel)).sort()) {
			const path = `${rel}/${name}`;
			if (statSync(join(root, path)).isDirectory()) walk(path);
			else files.push(path);
		}
	};
	const packages = join(root, 'packages');
	if (!existsSync(packages)) return files;
	for (const pkg of readdirSync(packages).sort()) {
		const src = `packages/${pkg}/src`;
		if (existsSync(join(root, src)) && statSync(join(root, src)).isDirectory())
			walk(src);
	}
	return files.sort();
}

/** The package directory name of a `packages/<pkg>/...` path. */
function packageOf(path) {
	return path.split('/')[1];
}

/**
 * The README text `readme` with its LOC table regenerated from the files under
 * `root`. Throws when the section is missing or a row names a missing file.
 */
export function updateLocTable(readme, root) {
	const lines = readme.split('\n');
	const start = lines.indexOf(SECTION);
	if (start < 0) throw new Error(`loc: no "${SECTION}" section in the README`);
	let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
	if (end < 0) end = lines.length;
	const section = lines.slice(start, end);

	const loc = (path) => lineCount(readFileSync(join(root, path), 'utf8'));
	const row = (path, target) => `| \`${path}\` | ${loc(path)} | ${target} |`;

	// Rewrite the existing rows, noting which package each table belongs to
	// (from its subsection heading) and where each table ends.
	const listed = new Set();
	const missing = [];
	const tableEnd = new Map(); // package -> index in `section` after its last row
	let heading = null;
	let total = 0;
	for (let i = 0; i < section.length; i++) {
		const line = section[i];
		if (/^### /.test(line)) {
			const m = /`packages\/([^`/]+)`/.exec(line);
			heading = m ? m[1] : null;
			continue;
		}
		// Any table line (header and separator included) extends its table.
		if (heading !== null && line.startsWith('|')) tableEnd.set(heading, i + 1);
		const m = ROW.exec(line);
		if (!m) continue;
		const [, path, target] = m;
		if (!existsSync(join(root, path)) || !statSync(join(root, path)).isFile()) {
			missing.push(path);
			continue;
		}
		listed.add(path);
		section[i] = row(path, target);
		total += loc(path);
	}
	if (missing.length) {
		throw new Error(
			`loc: rows name files that do not exist (paths are from the repo root): ${missing.join(', ')}`,
		);
	}

	// Add a row for every unlisted source file.
	const added = new Map(); // package -> rows
	for (const path of sourceFiles(root)) {
		if (listed.has(path)) continue;
		const pkg = packageOf(path);
		if (!added.has(pkg)) added.set(pkg, []);
		added.get(pkg).push(row(path, '-'));
		total += loc(path);
	}
	const inserts = [];
	for (const [pkg, rows] of added) {
		if (tableEnd.has(pkg)) inserts.push({at: tableEnd.get(pkg), rows});
		else {
			// A new subsection goes after the last content, before the total.
			const totalAt = section.findIndex((l) => TOTAL.test(l));
			let at = totalAt >= 0 ? totalAt : section.length;
			while (at > 0 && section[at - 1] === '') at--;
			inserts.push({
				at,
				rows: [
					'',
					`### \`packages/${pkg}\``,
					'',
					'| module | LOC | target |',
					'| ------ | --: | -----: |',
					...rows,
				],
			});
		}
	}
	// Insert from the bottom so earlier indices stay valid (stable for ties).
	inserts
		.map((ins, order) => ({...ins, order}))
		.sort((a, b) => b.at - a.at || b.order - a.order)
		.forEach(({at, rows}) => section.splice(at, 0, ...rows));

	const totalLine = `**Total own source: ${total} LOC** (every file under \`packages/*/src\`, excluding deps).`;
	const totalAt = section.findIndex((l) => TOTAL.test(l));
	if (totalAt >= 0) section[totalAt] = totalLine;
	else {
		let at = section.length;
		while (at > 0 && section[at - 1] === '') at--;
		section.splice(at, 0, '', totalLine);
	}

	return [...lines.slice(0, start), ...section, ...lines.slice(end)].join('\n');
}

/**
 * Regenerates `<root>/README.md` (or, with `check`, only compares). Returns
 * `{ok, message}`: with `check`, `ok` is false when the table is stale.
 */
export function runLoc(root, {check = false} = {}) {
	const file = join(root, 'README.md');
	const before = readFileSync(file, 'utf8');
	const after = updateLocTable(before, root);
	if (before === after)
		return {ok: true, message: 'loc: the README LOC table is up to date'};
	if (check)
		return {
			ok: false,
			message: 'loc: the README LOC table is out of date: run `pnpm loc`',
		};
	writeFileSync(file, after);
	return {ok: true, message: 'loc: rewrote the README LOC table'};
}

if (isMain(import.meta.url)) {
	let check = false;
	let root = dirname(dirname(fileURLToPath(import.meta.url)));
	for (const arg of process.argv.slice(2)) {
		if (arg === '--check') check = true;
		else if (arg.startsWith('-')) {
			console.error(`loc: unknown argument ${arg}`);
			process.exit(2);
		} else root = resolve(arg);
	}
	try {
		const {ok, message} = runLoc(root, {check});
		(ok ? console.log : console.error)(message);
		process.exit(ok ? 0 : 1);
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}
