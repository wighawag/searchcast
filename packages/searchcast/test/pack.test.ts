// What the published `searchcast` tarball contains, from a pack dry run with
// the repo-wide pack check's helper (scripts/pack-check.mjs, which also checks
// the tarball's overall shape and manifest for every package; nothing is
// written but the gitignored README.md and LICENSE that `prepack` copies).
// The SearXNG engine must be at `integrations/searxng/searchcast.py`, the path
// it had in searchcast 0.1.x, because SearXNG settings and packagers name it.
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
// @ts-expect-error - plain .mjs script, no types
import {packedFiles} from '../../../scripts/pack-check.mjs';

const packageDir = resolve(import.meta.dirname, '..');

describe('the packed searchcast tarball', () => {
	it('has the SearXNG engine at integrations/searxng/searchcast.py, and the bin', () => {
		const files: string[] = packedFiles(packageDir);
		expect(files).toContain('integrations/searxng/searchcast.py');
		expect(files).toContain('dist/cli.js');
		expect(files).toContain('dist/browser-cli.js');
		// Nothing else from integrations/ (no bytecode caches, no tests).
		expect(files.filter((f) => f.startsWith('integrations/'))).toEqual([
			'integrations/searxng/searchcast.py',
		]);
	}, 60_000);
});
