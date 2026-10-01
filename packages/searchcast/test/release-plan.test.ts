// scripts/release-plan.mjs, the repo-wide guard run by the root `test` and by
// `release:ci`: no package at or planned at >= 1.0.0, no major bump planned.
// The fixtures are throwaway pnpm workspaces under the OS temp dir with their
// own `.changeset/`; the plan is computed by changesets itself.
import {spawnSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	checkReleasePlan,
	releasePlanProblems,
	// @ts-expect-error - plain .mjs script, no types
} from '../../../scripts/release-plan.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const script = join(repo, 'scripts', 'release-plan.mjs');
const config = (extra: object = {}) => ({
	changelog: false,
	commit: false,
	access: 'public',
	baseBranch: 'main',
	updateInternalDependencies: 'patch',
	...extra,
});

let dirs: string[] = [];
afterEach(() => {
	for (const d of dirs) rmSync(d, {recursive: true, force: true});
	dirs = [];
});

interface Fixture {
	packages: Record<string, object>;
	changesets: Record<string, string>;
	config?: object;
}

/** A pnpm workspace with `packages/<name>` for each manifest, and the given changesets. */
function workspace({packages, changesets, config: cfg}: Fixture): string {
	const root = mkdtempSync(join(tmpdir(), 'release-plan-'));
	dirs.push(root);
	writeFileSync(join(root, 'package.json'), '{"name":"root","private":true}');
	writeFileSync(
		join(root, 'pnpm-workspace.yaml'),
		"packages:\n  - 'packages/*'\n",
	);
	mkdirSync(join(root, '.changeset'));
	writeFileSync(
		join(root, '.changeset', 'config.json'),
		JSON.stringify(cfg ?? config()),
	);
	for (const [name, manifest] of Object.entries(packages)) {
		mkdirSync(join(root, 'packages', name), {recursive: true});
		writeFileSync(
			join(root, 'packages', name, 'package.json'),
			JSON.stringify({name, ...manifest}),
		);
	}
	for (const [id, body] of Object.entries(changesets))
		writeFileSync(join(root, '.changeset', `${id}.md`), body);
	return root;
}

const changeset = (bumps: Record<string, string>) =>
	`---\n${Object.entries(bumps)
		.map(([n, t]) => `'${n}': ${t}`)
		.join('\n')}\n---\n\nA change.\n`;

/** Runs the script as `release:ci` does, on `root`. */
function run(root: string) {
	return spawnSync(process.execPath, [script, root], {
		encoding: 'utf8',
		timeout: 60_000,
	});
}

describe('release-plan check', () => {
	it('passes and prints the plan when every planned version stays below 1.0.0', () => {
		const root = workspace({
			packages: {a: {version: '0.1.2'}, b: {version: '0.0.0'}},
			changesets: {one: changeset({a: 'minor', b: 'minor'})},
		});
		const r = run(root);
		expect(r.stderr).toBe('');
		expect(r.stdout).toBe(
			'release plan:\n  a 0.1.2 -> 0.2.0 (minor)\n  b 0.0.0 -> 0.1.0 (minor)\n',
		);
		expect(r.status).toBe(0);
	}, 60_000);

	it('fails on a package.json version >= 1.0.0', () => {
		const root = workspace({
			packages: {a: {version: '1.0.0'}, b: {version: '0.1.0'}},
			changesets: {},
		});
		const r = run(root);
		expect(r.stderr).toContain('a is at 1.0.0 in its package.json (>= 1.0.0)');
		expect(r.status).toBe(1);
	}, 60_000);

	it('fails on a planned major (a 0.x package planned at 1.0.0)', () => {
		const root = workspace({
			packages: {a: {version: '0.2.0'}},
			changesets: {one: changeset({a: 'major'})},
		});
		const r = run(root);
		expect(r.stderr).toContain('a 0.2.0 -> 1.0.0 (major)');
		expect(r.stderr).toContain('a is planned as a MAJOR bump (0.2.0 to 1.0.0)');
		expect(r.stderr).toContain('a is planned at 1.0.0 (>= 1.0.0)');
		expect(r.status).toBe(1);
	}, 60_000);

	// The peer hazard: `searchcast` has `@searchcast/browser` as an optional
	// peer (`>=0.1.0 <0.2.0`). A minor of the peer leaves that range, and
	// changesets then plans a MAJOR for the dependent.
	const peer = (range: string) => ({
		a: {
			version: '0.2.0',
			peerDependencies: {b: range},
			devDependencies: {b: 'workspace:^'},
		},
		b: {version: '0.1.0'},
	});

	it('fails when a minor of a peer dependency plans a major for its dependent', () => {
		const root = workspace({
			packages: peer('>=0.1.0 <0.2.0'),
			changesets: {one: changeset({b: 'minor'})},
			config: config({
				___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: {
					onlyUpdatePeerDependentsWhenOutOfRange: true,
				},
			}),
		});
		const r = run(root);
		expect(r.stderr).toContain('a is planned as a MAJOR bump (0.2.0 to 1.0.0)');
		expect(r.status).toBe(1);
	}, 60_000);

	it('passes when the peer range is widened in the same release (with the repo config)', () => {
		const root = workspace({
			packages: peer('>=0.1.0 <0.3.0'),
			changesets: {one: changeset({b: 'minor', a: 'minor'})},
			config: config({
				___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: {
					onlyUpdatePeerDependentsWhenOutOfRange: true,
				},
			}),
		});
		const r = run(root);
		expect(r.stdout).toContain('a 0.2.0 -> 0.3.0 (minor)');
		expect(r.status).toBe(0);
	}, 60_000);

	it('without onlyUpdatePeerDependentsWhenOutOfRange, even a widened peer range plans a major', () => {
		// Why .changeset/config.json sets that option: without it there is no
		// way to release a minor of @searchcast/browser without searchcast 1.0.0.
		const root = workspace({
			packages: peer('>=0.1.0 <0.3.0'),
			changesets: {one: changeset({b: 'minor', a: 'minor'})},
		});
		const r = run(root);
		expect(r.stderr).toContain('a is planned as a MAJOR bump (0.2.0 to 1.0.0)');
		expect(r.status).toBe(1);
	}, 60_000);

	it('ignores private packages and releases of type none', () => {
		expect(
			releasePlanProblems({
				packages: [{name: 'a', version: '0.3.0'}],
				releases: [
					{name: 'a', type: 'none', oldVersion: '0.3.0', newVersion: '0.3.0'},
				],
			}),
		).toEqual([]);
		const root = workspace({
			packages: {
				a: {version: '0.1.0'},
				tools: {version: '2.0.0', private: true},
			},
			changesets: {},
		});
		expect(run(root).status).toBe(0);
	}, 60_000);

	it('passes on this repo', async () => {
		const {ok, lines, releases} = await checkReleasePlan(repo);
		expect(lines.join('\n')).not.toContain('refusing');
		expect(ok).toBe(true);
		// Until the first Version Packages PR consumes them, the pending
		// changesets of spec `searchcast-monorepo` plan exactly this.
		if (
			existsSync(join(repo, '.changeset', 'rename-serpcast-to-searchcast.md'))
		) {
			expect(
				releases
					.filter((r: {type: string}) => r.type !== 'none')
					.map((r: {name: string; newVersion: string}) => [
						r.name,
						r.newVersion,
					])
					.sort(),
			).toEqual([
				['@searchcast/browser', '0.1.0'],
				['@searchcast/libcurl-darwin-arm64', '0.1.0'],
				['@searchcast/libcurl-darwin-x64', '0.1.0'],
				['@searchcast/libcurl-linux-arm64', '0.1.0'],
				['@searchcast/libcurl-linux-x64', '0.1.0'],
				['@searchcast/libcurl-win32-x64', '0.1.0'],
				['@searchcast/recipe', '0.1.0'],
				['searchcast', '0.2.0'],
			]);
		}
	}, 60_000);
});
