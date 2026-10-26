// scripts/loc.mjs, the README's generated "Size discipline (per-module LOC)"
// table: `pnpm loc` rewrites the LOC column, `--check` (in the verify gate)
// fails on a stale table. Fixture repos under the OS temp dir.
import {spawnSync} from 'node:child_process';
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
// @ts-expect-error - plain .mjs script, no types
import {lineCount, runLoc, updateLocTable} from '../../../scripts/loc.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const script = join(repo, 'scripts', 'loc.mjs');

let dirs: string[] = [];
afterEach(() => {
	for (const d of dirs) rmSync(d, {recursive: true, force: true});
	dirs = [];
});

const lines = (n: number) => 'x\n'.repeat(n);

function readme(rows: string, total = 0) {
	return [
		'# x',
		'',
		'## Size discipline (per-module LOC)',
		'',
		'Intro.',
		'',
		'### `packages/a` (the a package)',
		'',
		'| module | LOC | target |',
		'| ------ | --: | -----: |',
		rows,
		'',
		`**Total own source: ${total} LOC** (old).`,
		'',
		'## Develop',
		'',
		'| `not/a/row.ts` | 1 | 2 |',
		'',
	].join('\n');
}

/** A repo with these files (path to text) and README. */
function repoWith(files: Record<string, string>, text: string) {
	const root = mkdtempSync(join(tmpdir(), 'loc-'));
	dirs.push(root);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(resolve(root, path, '..'), {recursive: true});
		writeFileSync(join(root, path), content);
	}
	writeFileSync(join(root, 'README.md'), text);
	return root;
}

function run(root: string, ...args: string[]) {
	const r = spawnSync(process.execPath, [script, ...args, root], {
		encoding: 'utf8',
		timeout: 60_000,
	});
	return {status: r.status, output: `${r.stdout}${r.stderr}`};
}

describe('lineCount', () => {
	it('counts lines, with or without a final newline', () => {
		expect(lineCount('')).toBe(0);
		expect(lineCount('a\n')).toBe(1);
		expect(lineCount('a\nb')).toBe(2);
		expect(lineCount('a\n\nb\n')).toBe(3);
	});
});

describe('the LOC table', () => {
	it('--check fails on a stale table, and passes after a rewrite', () => {
		const root = repoWith(
			{'packages/a/src/x.ts': lines(5)},
			readme('| `packages/a/src/x.ts` | 3 | 10 |', 3),
		);
		const stale = run(root, '--check');
		expect(stale.output).toContain('loc: the README LOC table is out of date');
		expect(stale.status).toBe(1);
		expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain(
			'| 3 | 10 |',
		);

		const fix = run(root);
		expect(fix.status).toBe(0);
		const text = readFileSync(join(root, 'README.md'), 'utf8');
		expect(text).toContain('| `packages/a/src/x.ts` | 5 | 10 |');
		expect(text).toContain('**Total own source: 5 LOC**');
		// A row-shaped line outside the section is not touched.
		expect(text).toContain('| `not/a/row.ts` | 1 | 2 |');

		const fresh = run(root, '--check');
		expect(fresh.output).toContain('loc: the README LOC table is up to date');
		expect(fresh.status).toBe(0);
	});

	it('leaves a fresh table untouched, keeping row order, targets and the rest', () => {
		const rows =
			'| `packages/a/src/y.ts` | 2 | 9 |\n| `packages/a/src/x.ts` | 4 | - |';
		const total =
			'**Total own source: 6 LOC** (every file under `packages/*/src`, excluding deps).';
		const text = readme(rows).replace(/\*\*Total own source.*/, total);
		const root = repoWith(
			{'packages/a/src/y.ts': lines(2), 'packages/a/src/x.ts': lines(4)},
			text,
		);
		expect(updateLocTable(text, root)).toBe(text);
		expect(runLoc(root, {check: true})).toEqual({
			ok: true,
			message: 'loc: the README LOC table is up to date',
		});
		expect(runLoc(root).ok).toBe(true);
		expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(text);
	});

	it('refuses a row whose file does not exist', () => {
		const root = repoWith(
			{'packages/a/src/x.ts': lines(1)},
			readme('| `packages/a/src/x.ts` | 1 | 2 |\n| `src/gone.ts` | 7 | 9 |', 8),
		);
		const r = run(root, '--check');
		expect(r.output).toContain(
			'loc: rows name files that do not exist (paths are from the repo root): src/gone.ts',
		);
		expect(r.status).toBe(1);
		expect(() => runLoc(root)).toThrow('src/gone.ts');
	});

	it('adds a row for a new source file, to its package table or a new one', () => {
		const root = repoWith(
			{
				'packages/a/src/x.ts': lines(1),
				'packages/a/src/sub/new.ts': lines(3),
				'packages/b/src/b.ts': 'one\ntwo',
				'packages/c/test/t.ts': lines(50),
			},
			readme('| `packages/a/src/x.ts` | 1 | 2 |', 1),
		);
		expect(run(root, '--check').status).toBe(1);
		expect(run(root).status).toBe(0);
		const text = readFileSync(join(root, 'README.md'), 'utf8');
		expect(text).toContain(
			[
				'| `packages/a/src/x.ts` | 1 | 2 |',
				'| `packages/a/src/sub/new.ts` | 3 | - |',
				'',
				'### `packages/b`',
				'',
				'| module | LOC | target |',
				'| ------ | --: | -----: |',
				'| `packages/b/src/b.ts` | 2 | - |',
				'',
				'**Total own source: 6 LOC** (every file under `packages/*/src`, excluding deps).',
				'',
				'## Develop',
			].join('\n'),
		);
		expect(text).not.toContain('t.ts');
		expect(run(root, '--check').status).toBe(0);
	});

	it('fills an empty table under its package heading', () => {
		const text = readme('| `packages/a/src/x.ts` | 1 | 2 |', 1).replace(
			'\n**Total',
			'\n### `packages/b`\n\n| module | LOC | target |\n| --- | --: | --: |\n\n**Total',
		);
		const root = repoWith(
			{'packages/a/src/x.ts': lines(1), 'packages/b/src/b.ts': lines(2)},
			text,
		);
		expect(updateLocTable(text, root)).toContain(
			'| --- | --: | --: |\n| `packages/b/src/b.ts` | 2 | - |\n\n**Total own source: 3 LOC**',
		);
	});
});
