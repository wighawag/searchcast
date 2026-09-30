// scripts/no-skips.mjs, CI's "no silent skip" guard: after `pnpm test:ci`,
// every package must have a vitest JSON report in which every test ran.
// Fixture repos with hand-written reports under the OS temp dir.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
// @ts-expect-error - plain .mjs script, no types
import {checkReports} from '../../../scripts/no-skips.mjs';

let dirs: string[] = [];
afterEach(() => {
	for (const d of dirs) rmSync(d, {recursive: true, force: true});
	dirs = [];
});

type Status = 'passed' | 'failed' | 'skipped' | 'pending' | 'todo';

function report(tests: Record<string, Status>) {
	return {
		numTotalTests: Object.keys(tests).length,
		testResults: [
			{
				name: '/x/test/a.test.ts',
				assertionResults: Object.entries(tests).map(([fullName, status]) => ({
					fullName,
					status,
				})),
			},
		],
	};
}

/** A repo whose packages have these reports (null: the package has no report). */
function repoWith(reports: Record<string, object | null>): string {
	const root = mkdtempSync(join(tmpdir(), 'no-skips-'));
	dirs.push(root);
	for (const [name, r] of Object.entries(reports)) {
		const dir = join(root, 'packages', name);
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'package.json'), `{"name":"${name}"}`);
		if (r) writeFileSync(join(dir, 'vitest-report.json'), JSON.stringify(r));
	}
	return root;
}

describe('no-skips check', () => {
	it('passes when every test of every package ran', () => {
		const root = repoWith({
			a: report({one: 'passed', two: 'passed'}),
			b: report({three: 'passed'}),
		});
		expect(checkReports(root).ok).toBe(true);
	});

	it('fails on a skipped test, naming it', () => {
		const root = repoWith({
			a: report({'native works': 'skipped', other: 'passed', later: 'todo'}),
		});
		const {ok, lines} = checkReports(root);
		expect(ok).toBe(false);
		expect(lines).toEqual([
			'no-skips: not run in CI (skipped): native works [/x/test/a.test.ts]',
			'no-skips: not run in CI (todo): later [/x/test/a.test.ts]',
		]);
	});

	it('fails when a package has no report', () => {
		const root = repoWith({a: report({one: 'passed'}), b: null});
		const {ok, lines} = checkReports(root);
		expect(ok).toBe(false);
		expect(lines).toContain(
			`no-skips: no test report at ${join(root, 'packages', 'b', 'vitest-report.json')}`,
		);
	});

	it('lets a named exception through, and only that one', () => {
		const root = repoWith({
			a: report({'needs x': 'skipped', 'needs y': 'skipped'}),
		});
		const {ok, lines} = checkReports(root, ['needs x']);
		expect(ok).toBe(false);
		expect(lines).toEqual([
			'no-skips: not run in CI (skipped): needs y [/x/test/a.test.ts]',
		]);
		expect(checkReports(root, ['needs x', 'needs y']).ok).toBe(true);
	});
});
