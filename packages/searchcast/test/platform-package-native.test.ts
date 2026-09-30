// The library as `npm install searchcast` provides it: from the platform
// package `@searchcast/libcurl-<platform>`, found with no setting (no option,
// no environment variable) and no data directory, loaded and checked by strict
// mode like any other. Runs only when this workspace's platform package has
// its library, which CI builds for linux-x64 with
// `node scripts/libcurl-packages.mjs build linux-x64` (see
// test/native-notice.ts); skipped otherwise.

import {execFile} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {platformPackageLibrary} from '../src/libcurl.js';
import {item, recipe, resultsPage, startPageServer} from './pages.js';
import {realDataDirs} from './release.js';

const PACKAGED = platformPackageLibrary();
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = promisify(execFile);

const snapshot = realDataDirs();
let before: unknown[];
let tmp: string;
/** No library configured anywhere, and an empty data directory. */
let env: NodeJS.ProcessEnv;
beforeEach(() => {
	before = snapshot();
	tmp = mkdtempSync(join(tmpdir(), 'searchcast-packaged-'));
	env = {
		...process.env,
		SEARCHCAST_LIBCURL_PATH: '',
		SERPCAST_LIBCURL_PATH: '',
		LIBCURL_PATH: '',
		HOME: tmp,
		XDG_DATA_HOME: join(tmp, 'data'),
	};
});
afterEach(() => {
	rmSync(tmp, {recursive: true, force: true});
	expect(snapshot()).toEqual(before); // the real data directory is untouched
});

describe.skipIf(!PACKAGED)(
	'the platform package (native libcurl-impersonate)',
	() => {
		it('is the library doctor finds with nothing configured, with impersonation active', async () => {
			const {stdout} = await run(process.execPath, [cli, 'doctor'], {env});
			const {name, version} = PACKAGED!.package;
			expect(stdout).toContain(`library:       ${PACKAGED!.path}`);
			expect(stdout).toMatch(
				new RegExp(
					`^from: +the platform package ${name.replace('/', '\\/')} ${version.replace(/\./g, '\\.')} \\(installed with searchcast\\)$`,
					'm',
				),
			);
			expect(stdout).toMatch(/^version: +libcurl\/\S+ BoringSSL/m);
			expect(stdout).toMatch(/^impersonation: +active \(chrome\d+\)$/m);
		});

		it('answers a query with nothing configured', async () => {
			const pages = await startPageServer({
				'/search': {body: resultsPage(item('One', 'one', 'snip'))},
			});
			try {
				const file = join(tmp, 'r.json');
				writeFileSync(file, JSON.stringify(recipe(pages.origin)));
				const {stdout} = await run(
					process.execPath,
					[cli, 'query', '--recipe', file, 'hello'],
					{env},
				);
				expect(JSON.parse(stdout).results).toEqual([
					{
						title: 'One',
						url: `${pages.origin}/one`,
						content: 'snip',
						snippet: 'snip',
					},
				]);
				expect(pages.hits).toEqual(['/search?q=hello']);
			} finally {
				await pages.close();
			}
		});
	},
);
