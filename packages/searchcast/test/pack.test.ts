// What the published `searchcast` tarball contains, from a pack dry run (npm
// lists the files it would pack; nothing is written and `prepack` is skipped).
// The SearXNG engine must be at `integrations/searxng/searchcast.py`, the path
// it had in searchcast 0.1.x, because SearXNG settings and packagers name it.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const packageDir = resolve(import.meta.dirname, '..');

function packedFiles(): string[] {
	const out = execFileSync(
		'npm',
		['pack', '--dry-run', '--json', '--ignore-scripts'],
		{cwd: packageDir, encoding: 'utf8', timeout: 60_000},
	);
	const [pack] = JSON.parse(out) as Array<{files: Array<{path: string}>}>;
	return pack!.files.map((f) => f.path);
}

describe('the packed searchcast tarball', () => {
	it('has the SearXNG engine at integrations/searxng/searchcast.py, and the bin', () => {
		const files = packedFiles();
		expect(files).toContain('integrations/searxng/searchcast.py');
		expect(files).toContain('dist/cli.js');
		expect(files).toContain('dist/browser-cli.js');
		// Nothing else from integrations/ (no bytecode caches, no tests).
		expect(files.filter((f) => f.startsWith('integrations/'))).toEqual([
			'integrations/searxng/searchcast.py',
		]);
	}, 60_000);
});
