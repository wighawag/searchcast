// The root scripts run their CLI when invoked through a symlink. Node reports
// `import.meta.url` as the real path, so a script that compared it with the
// unresolved `process.argv[1]` would exit 0 having done nothing, which for a
// guard reads as "passed". Each script is run here from a symlinked `scripts/`
// directory on an input it must refuse: it has to fail, naming why. All the
// fixtures, and the symlink, live under the OS temp dir.
import {spawnSync} from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

const repo = resolve(import.meta.dirname, '..', '..', '..');

/** The scripts with a CLI; each decides it was run directly with scripts/is-main.mjs. */
const SCRIPTS = [
	'copy-publish-assets.mjs',
	'libcurl-packages.mjs',
	'no-skips.mjs',
	'pack-check.mjs',
	'release-plan.mjs',
];

let tmp: string;
/** `<tmp>/scripts`, a symlink to this repo's scripts/. */
let linked: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), 'scripts-symlink-'));
	linked = join(tmp, 'scripts');
	symlinkSync(join(repo, 'scripts'), linked);
});
afterEach(() => {
	rmSync(tmp, {recursive: true, force: true});
});

/** A directory under `tmp` holding these files (path to JSON or text). */
function fixture(name: string, files: Record<string, object | string>) {
	const root = join(tmp, name);
	for (const [path, content] of Object.entries(files)) {
		const file = join(root, path);
		mkdirSync(resolve(file, '..'), {recursive: true});
		writeFileSync(
			file,
			typeof content === 'string' ? content : JSON.stringify(content),
		);
	}
	return root;
}

/** Runs `<tmp>/scripts/<script>` with `args`, from `cwd`. */
function runLinked(script: string, args: string[], cwd = tmp) {
	const r = spawnSync(process.execPath, [join(linked, script), ...args], {
		cwd,
		encoding: 'utf8',
		timeout: 60_000,
	});
	return {status: r.status, output: `${r.stdout}${r.stderr}`};
}

describe('a root script run through a symlinked scripts/ directory', () => {
	it('no-skips fails a package without a test report', () => {
		const root = fixture('repo', {
			'packages/a/package.json': {name: 'a', scripts: {test: 'vitest run'}},
		});
		const r = runLinked('no-skips.mjs', [root]);
		expect(r.output).toContain(
			`no-skips: no test report at ${join(root, 'packages', 'a', 'vitest-report.json')}`,
		);
		expect(r.status).toBe(1);
	});

	it('release-plan fails a package at 1.0.0', () => {
		const root = fixture('workspace', {
			'package.json': {name: 'root', private: true},
			'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
			'.changeset/config.json': {
				changelog: false,
				commit: false,
				access: 'public',
				baseBranch: 'main',
				updateInternalDependencies: 'patch',
			},
			'packages/a/package.json': {name: 'a', version: '1.0.0'},
		});
		const r = runLinked('release-plan.mjs', [root]);
		expect(r.output).toContain('a is at 1.0.0 in its package.json (>= 1.0.0)');
		expect(r.status).toBe(1);
	}, 60_000);

	// Its root is the repo holding the real script, so no fixture can stand in
	// for it: an argument it must refuse shows its CLI ran, without packing.
	it('pack-check refuses an unknown argument', () => {
		const r = runLinked('pack-check.mjs', ['--not-an-option']);
		expect(r.output).toContain('pack-check: unknown argument --not-an-option');
		expect(r.status).toBe(2);
	});

	it('libcurl-packages check refuses to pack a platform package without its library', () => {
		const dir = fixture('libcurl-linux-x64', {
			'package.json': {name: '@searchcast/libcurl-linux-x64'},
		});
		const r = runLinked('libcurl-packages.mjs', ['check'], dir);
		expect(r.output).toContain(`refusing to pack ${dir}: no library at`);
		expect(r.status).toBe(1);
	});

	// Run from a directory outside the repo holding the real script: it must
	// refuse (and so write nothing) rather than skip.
	it('copy-publish-assets refuses to write outside the repo', () => {
		const dir = fixture('package', {'package.json': {name: 'x'}});
		const r = runLinked('copy-publish-assets.mjs', [], dir);
		expect(r.output).toContain(
			'copy-publish-assets: refusing to write outside the repo.',
		);
		expect(r.status).not.toBe(0);
	});

	it('every script with a CLI decides it was run directly with the one helper', () => {
		for (const script of SCRIPTS) {
			const source = readFileSync(join(repo, 'scripts', script), 'utf8');
			expect(source, script).toContain("import {isMain} from './is-main.mjs';");
			expect(source, script).toContain('if (isMain(import.meta.url))');
			expect(source, script).not.toMatch(/process\.argv\[1\]/);
		}
	});
});
