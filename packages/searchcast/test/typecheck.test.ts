// The type check of the tests in the gate: vitest strips types without
// checking them, so each package with tests has a tsconfig.test.json (its
// src/ and test/, no emit) run by its `typecheck` script, which the root
// `test` and `test:ci` run before vitest. These cases prove it bites: every
// test file is in it, the root scripts run it, and a wrong `expectTypeOf`
// fails it (with a right one, as a control, passing).
import {spawnSync} from 'node:child_process';
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const pkg = resolve(import.meta.dirname, '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

/** The packages with a test/ directory: each must type-check its tests. */
const tested = readdirSync(join(repo, 'packages')).filter((name) =>
	readdirSync(join(repo, 'packages', name)).includes('test'),
);

function json(path: string) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function runTsc(cwd: string, ...args: string[]) {
	const run = spawnSync(process.execPath, [tsc, ...args], {
		cwd,
		encoding: 'utf8',
		timeout: 120_000,
	});
	return {status: run.status, output: run.stdout + run.stderr};
}

let dirs: string[] = [];
afterEach(() => {
	for (const d of dirs) rmSync(d, {recursive: true, force: true});
	dirs = [];
});

describe('the type check of the tests', () => {
	it('covers the packages with tests', () => {
		expect(tested.sort()).toEqual(['browser', 'recipe', 'searchcast']);
	});

	it('is run by the root test and test:ci, before vitest', () => {
		const {scripts} = json(join(repo, 'package.json'));
		expect(scripts.typecheck).toBe("pnpm --filter './packages/*' typecheck");
		for (const script of [scripts.test, scripts['test:ci']]) {
			const steps: string[] = script.split(' && ');
			const typecheck = steps.indexOf('pnpm typecheck');
			expect(typecheck).toBeGreaterThanOrEqual(0);
			const vitest = steps.findIndex((s) =>
				s.startsWith("pnpm --filter './packages/*' test"),
			);
			expect(typecheck).toBeLessThan(vitest);
		}
	});

	it.each(tested)(
		'includes every test file of %s',
		(name) => {
			const dir = join(repo, 'packages', name);
			expect(json(join(dir, 'package.json')).scripts.typecheck).toBe(
				'tsc -p tsconfig.test.json',
			);
			const {status, output} = runTsc(
				dir,
				'-p',
				'tsconfig.test.json',
				'--listFilesOnly',
			);
			expect(status, output).toBe(0);
			const listed = new Set(output.split('\n').map((l) => resolve(l.trim())));
			const files = readdirSync(join(dir, 'test')).filter((f) =>
				f.endsWith('.ts'),
			);
			expect(files.length).toBeGreaterThan(0);
			for (const f of files) expect(listed).toContain(join(dir, 'test', f));
		},
		120_000,
	);

	it('fails on a wrong expectTypeOf and passes on a right one', () => {
		// Inside the package (so `vitest` and ../src resolve as in test/), but
		// outside test/: it extends the real tsconfig.test.json with only the
		// fixture. Ignored by git (`.typecheck-bite-*`) if a run is cut short.
		const dir = mkdtempSync(join(pkg, '.typecheck-bite-'));
		dirs.push(dir);
		writeFileSync(
			join(dir, 'tsconfig.json'),
			JSON.stringify({
				extends: '../tsconfig.test.json',
				include: ['*.ts'],
			}),
		);
		const fixture = (right: string) =>
			[
				"import {expectTypeOf} from 'vitest';",
				"import type {SearchcastError, SerpcastError, SearchcastErrorKind} from '../src/index.js';",
				`expectTypeOf<SerpcastError>().toEqualTypeOf<${right}>();`,
				'',
			].join('\n');

		writeFileSync(join(dir, 'alias.ts'), fixture('SearchcastErrorKind'));
		const wrong = runTsc(dir, '-p', 'tsconfig.json');
		expect(wrong.status).not.toBe(0);
		expect(wrong.output).toContain('alias.ts(3,');

		writeFileSync(join(dir, 'alias.ts'), fixture('SearchcastError'));
		const right = runTsc(dir, '-p', 'tsconfig.json');
		expect(right.status, right.output).toBe(0);
	}, 120_000);
});
