// The browser runner, published as `searchcast` 0.1.2, is now the library
// `@searchcast/browser` (ADR 0005): the same main entry, no bin, and its CLI as
// `runCli` on the `./cli` entry. The export list below is `searchcast` 0.1.2's;
// a change here is a change to the public API, not part of the rename.
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import * as entry from '../src/index.js';
import * as cliEntry from '../src/cli.js';

const manifest = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

describe('@searchcast/browser package', () => {
	it('is named @searchcast/browser and has no bin', () => {
		expect(manifest.name).toBe('@searchcast/browser');
		expect(manifest.bin).toBeUndefined();
	});

	it('is AGPL with its own LICENSE file, and depends on @searchcast/recipe only', () => {
		expect(manifest.license).toBe('AGPL-3.0-only');
		expect(
			readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'),
		).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
		expect(manifest.dependencies).toEqual({
			'@searchcast/recipe': 'workspace:^',
		});
	});

	it('leaves releasing to the root', () => {
		expect(manifest.packageManager).toBeUndefined();
		for (const script of ['release', 'release:ci', 'prepublishOnly'])
			expect(manifest.scripts[script]).toBeUndefined();
		expect(manifest.scripts['changeset:check']).toBeUndefined();
		expect(manifest.repository).toEqual({
			type: 'git',
			url: 'git+https://github.com/wighawag/searchcast.git',
			directory: 'packages/browser',
		});
	});

	it('has the main entry and the ./cli entry', () => {
		expect(Object.keys(manifest.exports)).toEqual(['.', './cli']);
	});

	it('exports the same names from the main entry as searchcast 0.1.2', () => {
		expect(Object.keys(entry).sort()).toEqual([
			'Browser',
			'CdpConnection',
			'CdpError',
			'Page',
			'RecipeError',
			'Searchcast',
			'SearchcastError',
			'createSearchcastServer',
			'findChrome',
			'loadRecipeFile',
			'loadRecipes',
			'parseRecipe',
			'probeExpression',
			'startXvfb',
		]);
	});

	it('exports runCli and browserCommand from the ./cli entry', () => {
		expect(Object.keys(cliEntry).sort()).toEqual(['browserCommand', 'runCli']);
		expect(typeof cliEntry.runCli).toBe('function');
		expect(typeof cliEntry.browserCommand).toBe('function');
	});

	it('runs nothing when the built ./cli entry is imported', () => {
		// Run as a script, 0.1.2's cli.js printed its usage with no arguments.
		const cli = resolve(import.meta.dirname, '..', 'dist', 'cli.js');
		expect(existsSync(cli)).toBe(true);
		const run = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`const m = await import(${JSON.stringify(cli)}); console.log(typeof m.runCli);`,
			],
			{encoding: 'utf8'},
		);
		expect(run.stderr).toBe('');
		expect(run.stdout).toBe('function\n');
		expect(run.status).toBe(0);
	});
});
