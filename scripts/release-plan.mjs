#!/usr/bin/env node
// Release-plan guard: nothing in this repo may reach 1.0.0 without an explicit
// decision (spec `searchcast-monorepo`, ADR 0005). Fails when
//   - a publishable package.json already has a version >= 1.0.0, or
//   - the pending changesets plan any package at a version >= 1.0.0, or
//   - the pending changesets plan a major bump for any package.
// A major on a 0.x package is exactly how 1.0.0 sneaks in: changesets plans a
// MAJOR for a package whose peer dependency gets a minor (the peer rule), so a
// minor of `@searchcast/browser` alone can plan `searchcast` 1.0.0.
//
// It prints the plan either way. Run by the root `test` (hence `verify`) and by
// `release:ci` before `changeset publish`.
//
// The plan is computed with `@changesets/get-release-plan`, the function
// `changeset status` calls, resolved through the root's `@changesets/cli` so it
// is the same version. Calling it directly (instead of the `changeset status`
// command) needs no git history and does not add status's "packages changed
// but no changesets" refusal to every PR: this check is only about versions.

import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isMain} from './is-main.mjs';

/** Major version of a semver string (`1.0.0-rc.1` is 1). */
function major(version) {
	const m = /^(\d+)\./.exec(String(version));
	if (!m) throw new Error(`release-plan: not a semver version: ${version}`);
	return Number(m[1]);
}

/**
 * The problems with a release plan, as messages (empty when it is fine).
 * `packages` are the publishable workspace packages `{name, version}`;
 * `releases` are the plan's `{name, type, oldVersion, newVersion}`.
 */
export function releasePlanProblems({packages, releases}) {
	const problems = [];
	for (const {name, version} of packages) {
		if (major(version) >= 1)
			problems.push(`${name} is at ${version} in its package.json (>= 1.0.0)`);
	}
	for (const r of releases) {
		if (r.type === 'none') continue;
		if (r.type === 'major')
			problems.push(
				`${r.name} is planned as a MAJOR bump (${r.oldVersion} to ${r.newVersion})`,
			);
		if (major(r.newVersion) >= 1)
			problems.push(`${r.name} is planned at ${r.newVersion} (>= 1.0.0)`);
	}
	return problems;
}

/** The plan as printable lines. */
export function formatPlan(releases) {
	const planned = releases.filter((r) => r.type !== 'none');
	if (planned.length === 0) return ['no release planned'];
	return planned
		.slice()
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((r) => `${r.name} ${r.oldVersion} -> ${r.newVersion} (${r.type})`);
}

// `@changesets/get-release-plan` and `@manypkg/get-packages` are dependencies
// of `@changesets/cli` (not of the root), so resolve them from there.
function changesetsRequire(root) {
	const fromRoot = createRequire(resolve(root, 'package.json'));
	let cli;
	try {
		cli = fromRoot.resolve('@changesets/cli/package.json');
	} catch {
		// A fixture workspace has no node_modules: use this repo's.
		cli = createRequire(import.meta.url).resolve(
			'@changesets/cli/package.json',
		);
	}
	return createRequire(cli);
}

function loadDefault(mod) {
	return mod.default ?? mod;
}

/**
 * Reads the workspace at `root`: its publishable packages and the release plan
 * of its pending changesets.
 */
export async function readReleasePlan(root) {
	const req = changesetsRequire(root);
	const getReleasePlan = loadDefault(req('@changesets/get-release-plan'));
	const {getPackages} = req('@manypkg/get-packages');
	const {packages} = await getPackages(root);
	const plan = await getReleasePlan(root);
	return {
		packages: packages
			.filter((p) => !p.packageJson.private)
			.map((p) => ({
				name: p.packageJson.name,
				version: p.packageJson.version,
			})),
		releases: plan.releases,
	};
}

/** Runs the check on `root`; returns `{ok, lines}` (the plan, then any problem). */
export async function checkReleasePlan(root) {
	const {packages, releases} = await readReleasePlan(root);
	const problems = releasePlanProblems({packages, releases});
	const lines = ['release plan:', ...formatPlan(releases).map((l) => `  ${l}`)];
	if (problems.length) {
		lines.push(
			'release-plan: refusing (no 1.0.0 and no major without an explicit decision):',
			...problems.map((p) => `  ${p}`),
		);
	}
	return {ok: problems.length === 0, lines, releases};
}

// Run directly, including through a symlink (scripts/is-main.mjs): a guard
// that silently did nothing would read as "passed".
if (isMain(import.meta.url)) {
	const root = process.argv[2]
		? resolve(process.argv[2])
		: dirname(dirname(fileURLToPath(import.meta.url)));
	const {ok, lines} = await checkReleasePlan(root);
	(ok ? console.log : console.error)(lines.join('\n'));
	process.exit(ok ? 0 : 1);
}
