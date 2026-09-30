#!/usr/bin/env node
// "No silent skip" guard for CI: locally, the native tests (no
// libcurl-impersonate), the browser tests (no Chrome) and a few CLI cases (no
// Xvfb, no SearXNG, ...) skip themselves with a message; in CI every one of
// them must run. After `pnpm test:ci`, each package under packages/ that has a
// `test` script has a vitest JSON report (`vitest-report.json`; the platform
// packages `@searchcast/libcurl-<platform>` carry no code and have no tests:
// their library is tested from searchcast); this fails when such a package has
// no report, or when any test in a report did not run, unless it is one of the
// ALLOWED_SKIPS below (none today: each exception is a named, commented,
// recorded decision, also mentioned in .github/workflows/test.yml).

import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPORT = 'vitest-report.json';

/** Full test names (vitest's `fullName`) allowed not to run in CI. */
export const ALLOWED_SKIPS = [];

/** The tests of a vitest JSON report that did not run (skipped, todo, ...). */
export function notRun(report) {
	return report.testResults.flatMap((file) =>
		file.assertionResults
			.filter((t) => t.status !== 'passed' && t.status !== 'failed')
			.map((t) => ({file: file.name, name: t.fullName, status: t.status})),
	);
}

/** Checks the reports of every package under `root`/packages; returns `{ok, lines}`. */
export function checkReports(root, allowed = ALLOWED_SKIPS) {
	const lines = [];
	let ok = true;
	const base = join(root, 'packages');
	const dirs = readdirSync(base, {withFileTypes: true})
		.filter((d) => d.isDirectory())
		.map((d) => join(base, d.name))
		.filter((dir) => existsSync(join(dir, 'package.json')))
		.filter(
			(dir) =>
				JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts
					?.test !== undefined,
		);
	for (const dir of dirs) {
		const path = join(dir, REPORT);
		if (!existsSync(path)) {
			ok = false;
			lines.push(`no-skips: no test report at ${path}`);
			continue;
		}
		const report = JSON.parse(readFileSync(path, 'utf8'));
		const skipped = notRun(report).filter((t) => !allowed.includes(t.name));
		if (report.numTotalTests === 0) {
			ok = false;
			lines.push(`no-skips: ${path} has no tests`);
		}
		for (const t of skipped) {
			ok = false;
			lines.push(
				`no-skips: not run in CI (${t.status}): ${t.name} [${t.file}]`,
			);
		}
		if (skipped.length === 0)
			lines.push(`no-skips: ${path}: all ${report.numTotalTests} tests ran`);
	}
	return {ok, lines};
}

const invokedDirectly =
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	const root = process.argv[2]
		? resolve(process.argv[2])
		: dirname(dirname(fileURLToPath(import.meta.url)));
	const {ok, lines} = checkReports(root);
	(ok ? console.log : console.error)(lines.join('\n'));
	process.exit(ok ? 0 : 1);
}
