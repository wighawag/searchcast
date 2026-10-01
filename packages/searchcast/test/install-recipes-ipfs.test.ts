// `searchcast install-recipes ipfs://<cid>[/<path>]` (installRecipes and the
// bin) against local fake trustless gateways (ipfs-gateway.ts): a release
// archive and a set directory inside one UnixFS DAG, served as CARs. Every
// test installs into a temp XDG_DATA_HOME and checks the real data directory
// is untouched. No network.

import {execFile} from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import type {CID} from 'multiformats/cid';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import {InstallError} from '../src/install.js';
import {installRecipes} from '../src/install-recipes.js';
import {listRecipeSets} from '../src/recipes.js';
import {
	car,
	Dag,
	startGateway,
	trustTestCertificate,
	type Gateway,
} from './ipfs-gateway.js';
import {realDataDirs, sha256, tarGz} from './release.js';
import {startConnectProxy} from './servers.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = promisify(execFile);
const query = '?format=car&dag-scope=all';

const RECIPE = Buffer.from('{"name": "web"}\n');
const CODE = Buffer.from(
	'export default {name: "api", search() { return []; }};\n',
);
const manifest = (name: string, version = '1.2.0') =>
	Buffer.from(JSON.stringify({name, version}));
const ARCHIVE = tarGz([
	{name: 'my-set-1.2.0/', type: '5'},
	{name: 'my-set-1.2.0/manifest.json', body: manifest('my-set')},
	{name: 'my-set-1.2.0/web.json', body: RECIPE},
	{name: 'my-set-1.2.0/api.mjs', body: CODE},
]);

// root/ {
//   my-set-1.2.0.tar.gz          the release archive
//   set/ {manifest.json (dir-set 2.0.0), web.json, api.mjs}
//   v3/ {manifest.json (dir-set 3.0.0), web.json}
//   bare/ {web.json}             no manifest
//   docs/ {manifest.json, README.txt}
//   hidden/ {manifest.json, ._web.json}
// }
let root: CID;
let all: Buffer;
let a: Gateway;
let b: Gateway;
let local: Gateway;

beforeAll(async () => {
	trustTestCertificate();
	const dag = new Dag();
	const dirManifest = await dag.file(manifest('dir-set', '2.0.0'));
	const web = await dag.file(RECIPE);
	const api = await dag.file(CODE);
	root = await dag.dir({
		'my-set-1.2.0.tar.gz': await dag.file(ARCHIVE),
		set: await dag.dir({
			'manifest.json': dirManifest,
			'web.json': web,
			'api.mjs': api,
		}),
		v3: await dag.dir({
			'manifest.json': await dag.file(manifest('dir-set', '3.0.0')),
			'web.json': web,
		}),
		bare: await dag.dir({'web.json': web}),
		docs: await dag.dir({
			'manifest.json': dirManifest,
			'README.txt': await dag.file(Buffer.from('hello\n')),
		}),
		hidden: await dag.dir({'manifest.json': dirManifest, '._web.json': web}),
	});
	// Every block, for every path: the unused ones stay under the slack.
	all = await car([root], dag.blocks);
	[a, b, local] = await Promise.all([
		startGateway(),
		startGateway(),
		startGateway(false),
	]);
});
afterAll(async () => {
	await Promise.all([a, b, local].map((g) => g.close()));
});

/** `ipfs://<root>/<path>`, served by `gateways` (all paths). */
const at = (path: string) => `ipfs://${root}/${path}`;
const serve = (...gateways: Gateway[]) => {
	for (const g of gateways)
		for (const path of [
			'my-set-1.2.0.tar.gz',
			'set',
			'v3',
			'bare',
			'docs',
			'hidden',
		])
			g.routes.set(`/ipfs/${root}/${path}${query}`, all);
};

const snapshot = realDataDirs();
let before: unknown[];
let tmp: string;
let env: NodeJS.ProcessEnv;
let base: string;
beforeEach(() => {
	before = snapshot();
	tmp = mkdtempSync(join(tmpdir(), 'searchcast-recipes-ipfs-'));
	env = {XDG_DATA_HOME: join(tmp, 'data')};
	base = join(tmp, 'data', 'searchcast', 'recipes');
});
afterEach(() => {
	for (const g of [a, b, local]) {
		g.hits.length = 0;
		g.routes.clear();
	}
	rmSync(tmp, {recursive: true, force: true});
	expect(snapshot()).toEqual(before); // the real data directory is untouched
});

const source = (dir: string) =>
	JSON.parse(readFileSync(join(dir, '.source.json'), 'utf8'));
const failure = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error('expected a failure');
		},
		(error: unknown) => {
			expect(error).toBeInstanceOf(InstallError);
			expect((error as Error).message).toMatch(/Nothing was installed\.$/);
			return (error as Error).message;
		},
	);

describe('installRecipes from ipfs://', () => {
	it('installs a release archive by CID with no --sha256, recording the source, CID and gateway', async () => {
		serve(a);
		const log: string[] = [];
		const result = await installRecipes(at('my-set-1.2.0.tar.gz'), {
			ipfsGateways: [a.url],
			env,
			log: (line) => log.push(line),
		});
		const dir = join(base, 'my-set');
		expect(result).toEqual({
			name: 'my-set',
			dir,
			status: 'installed',
			files: {
				'api.mjs': sha256(CODE),
				'manifest.json': sha256(manifest('my-set')),
				'web.json': sha256(RECIPE),
			},
		});
		expect(readFileSync(join(dir, 'api.mjs'))).toEqual(CODE);
		const record = source(dir);
		expect(record).toMatchObject({
			source: at('my-set-1.2.0.tar.gz'),
			cid: root.toString(),
			gateway: a.url,
			sha256: sha256(ARCHIVE),
			manifest: {name: 'my-set', version: '1.2.0'},
			files: result.files,
		});
		expect(record.url).toBeUndefined();
		expect(log).toContain(
			`archive sha256 ${sha256(ARCHIVE)} (not pinned: the CID pins it)`,
		);
		expect(log.some((l) => l.startsWith('verified ipfs://'))).toBe(true);
	});

	it('checks a --sha256 given for an IPFS archive: a match installs, a mismatch installs nothing', async () => {
		serve(a);
		const options = {ipfsGateways: [a.url], env};
		const message = await failure(
			installRecipes(at('my-set-1.2.0.tar.gz'), {
				...options,
				sha256: '0'.repeat(64),
			}),
		);
		expect(message).toMatch(/checksum mismatch/);
		expect(message).toContain(sha256(ARCHIVE));
		expect(existsSync(join(tmp, 'data'))).toBe(false);
		const log: string[] = [];
		const result = await installRecipes(at('my-set-1.2.0.tar.gz'), {
			...options,
			sha256: sha256(ARCHIVE).toUpperCase(),
			log: (line) => log.push(line),
		});
		expect(result.status).toBe('installed');
		expect(log).toContain(
			`verified sha256 ${sha256(ARCHIVE)} (pinned with --sha256)`,
		);
	});

	it('installs a set directory (manifest.json and recipes), leaves it unchanged, replaces it with --force', async () => {
		serve(a);
		const options = {ipfsGateways: [a.url], env};
		const result = await installRecipes(at('set'), options);
		const dir = join(base, 'dir-set');
		expect(result).toMatchObject({name: 'dir-set', dir, status: 'installed'});
		expect(readdirSync(dir).sort()).toEqual([
			'.source.json',
			'api.mjs',
			'manifest.json',
			'web.json',
		]);
		expect(readdirSync(base)).toEqual(['dir-set']); // no temporary left
		const record = source(dir);
		expect(record).toMatchObject({
			source: at('set'),
			cid: root.toString(),
			gateway: a.url,
			manifest: {name: 'dir-set', version: '2.0.0'},
		});
		expect(record.sha256).toBeUndefined(); // no archive: the CID is the pin
		const recorded = readFileSync(join(dir, '.source.json'), 'utf8');
		expect(await installRecipes(at('set'), options)).toMatchObject({
			status: 'unchanged',
		});
		expect(readFileSync(join(dir, '.source.json'), 'utf8')).toBe(recorded);
		expect(await failure(installRecipes(at('v3'), options))).toMatch(
			/already exists and differs.*--force/,
		);
		expect(
			await installRecipes(at('v3'), {...options, force: true}),
		).toMatchObject({status: 'replaced'});
		expect(readdirSync(dir).sort()).toEqual([
			'.source.json',
			'manifest.json',
			'web.json',
		]);
		expect(listRecipeSets(base)[0]!.source!.manifest!.version).toBe('3.0.0');
	});

	it('refuses a --sha256 with an IPFS directory, a directory without manifest.json, and one with a non-recipe or hidden file', async () => {
		serve(a);
		const options = {ipfsGateways: [a.url], env};
		expect(
			await failure(
				installRecipes(at('set'), {...options, sha256: sha256(ARCHIVE)}),
			),
		).toMatch(/--sha256 pins an archive's bytes, and .* is a directory/);
		expect(
			await failure(installRecipes(at('bare'), {...options, name: 'x'})),
		).toMatch(/directory without a manifest\.json/);
		expect(await failure(installRecipes(at('docs'), options))).toMatch(
			/"README.txt" is not a \*\.mjs, \*\.js or \*\.json file/,
		);
		expect(await failure(installRecipes(at('hidden'), options))).toMatch(
			/"\._web\.json" is a hidden file/,
		);
		expect(existsSync(join(tmp, 'data'))).toBe(false);
	});

	it('skips a rate-limited gateway and one serving content that is not the CID, recording the one that verified', async () => {
		const dag = new Dag();
		const other = await dag.dir({
			set: await dag.dir({'web.json': await dag.file(CODE)}),
		});
		local.routes.set(`/ipfs/${root}/set${query}`, {status: 429});
		a.routes.set(`/ipfs/${root}/set${query}`, await car([other], dag.blocks));
		serve(b);
		const result = await installRecipes(at('set'), {
			ipfsGateways: [local.url, a.url, b.url],
			env,
		});
		expect(source(result.dir).gateway).toBe(b.url);
		expect(readFileSync(join(result.dir, 'web.json'))).toEqual(RECIPE);
	});

	it('installs nothing when no gateway serves the CID, listing each reason', async () => {
		a.routes.set(`/ipfs/${root}/set${query}`, {status: 429});
		const message = await failure(
			installRecipes(at('set'), {ipfsGateways: [a.url, b.url], env}),
		);
		expect(message).toMatch(/no gateway served .* verified against its CID/);
		expect(message).toContain(`${a.url}: GET`);
		expect(message).toMatch(/HTTP 429.*HTTP 404/);
		expect(existsSync(join(tmp, 'data'))).toBe(false);
	});

	it('refuses gateways for a non-IPFS source, a malformed --sha256 and a bad gateway before any request', async () => {
		serve(a);
		expect(
			await failure(
				installRecipes('https://example.com/set.tar.gz', {
					sha256: sha256(ARCHIVE),
					ipfsGateways: [a.url],
					env,
				}),
			),
		).toMatch(/--ipfs-gateway applies to an ipfs:\/\/ source only/);
		expect(
			await failure(
				installRecipes(at('set'), {sha256: 'abc', ipfsGateways: [a.url], env}),
			),
		).toMatch(/--sha256 must be 64 hex digits \(or left out/);
		expect(
			await failure(
				installRecipes(at('set'), {ipfsGateways: ['http://example.com'], env}),
			),
		).toMatch(/must be https:\/\//);
		expect(
			await failure(installRecipes('ipfs://not-a-cid/set', {env})),
		).toMatch(/is not a CID/);
		expect(a.hits).toEqual([]);
	});

	it('fetches through the proxy only', async () => {
		serve(a);
		const proxy = await startConnectProxy();
		try {
			await installRecipes(at('set'), {
				ipfsGateways: [a.url],
				proxy: `http://127.0.0.1:${proxy.port}`,
				env,
			});
			expect(proxy.requests).toEqual([
				{host: 'localhost', port: Number(new URL(a.url).port)},
			]);
		} finally {
			await proxy.close();
		}
	});
});

describe('searchcast install-recipes ipfs:// and recipes list (bin)', () => {
	const cliEnv = () => ({
		...process.env,
		HOME: tmp,
		XDG_DATA_HOME: env.XDG_DATA_HOME,
	});

	it('installs a set directory with no --sha256 from repeated --ipfs-gateway, and recipes list shows the IPFS source', async () => {
		// A plain http://127.0.0.1 gateway (a local node): the child process
		// does not trust the test certificate.
		local.routes.set(`/ipfs/${root}/set${query}`, {status: 429});
		const second = await startGateway(false);
		try {
			serve(second);
			const {stdout, stderr} = await run(
				process.execPath,
				[
					cli,
					'install-recipes',
					at('set'),
					'--ipfs-gateway',
					local.url,
					'--ipfs-gateway',
					second.url,
				],
				{env: cliEnv()},
			);
			const dir = join(base, 'dir-set');
			expect(stdout).toBe(dir + '\n');
			expect(stderr).toContain(`searchcast:   api.mjs  sha256 ${sha256(CODE)}`);
			expect(local.hits).toHaveLength(1);
			const list = await run(process.execPath, [cli, 'recipes', 'list'], {
				env: cliEnv(),
			});
			expect(list.stdout).toMatch(/^dir-set 2\.0\.0$/m);
			expect(list.stdout).toContain(`  source:    ${at('set')}\n`);
			expect(list.stdout).toContain(`  cid:       ${root}\n`);
			expect(list.stdout).toContain(`  gateway:   ${second.url}\n`);
			expect(list.stdout).not.toContain('  sha256:    ');
		} finally {
			await second.close();
		}
	});

	it('an archive with a wrong --sha256 exits 1; --ipfs-gateway with a file exits 1; no --sha256 for a file is still a usage error', async () => {
		serve(local);
		const archive = join(tmp, 'set.tar.gz');
		const failed = (args: string[]) =>
			run(process.execPath, [cli, ...args], {env: cliEnv()}).catch(
				(e: {code: number; stdout: string; stderr: string}) => e,
			);
		const mismatch = await failed([
			'install-recipes',
			at('my-set-1.2.0.tar.gz'),
			'--sha256',
			'0'.repeat(64),
			'--ipfs-gateway',
			local.url,
		]);
		expect(mismatch).toMatchObject({code: 1, stdout: ''});
		expect((mismatch as {stderr: string}).stderr).toMatch(
			/^searchcast: checksum mismatch.*Nothing was installed/m,
		);
		const gateway = await failed([
			'install-recipes',
			archive,
			'--sha256',
			sha256(ARCHIVE),
			'--ipfs-gateway',
			local.url,
		]);
		expect(gateway).toMatchObject({code: 1});
		expect((gateway as {stderr: string}).stderr).toMatch(
			/--ipfs-gateway applies to an ipfs:\/\/ source only/,
		);
		expect(await failed(['install-recipes', archive])).toMatchObject({
			code: 2,
		});
		expect(
			await failed(['recipes', 'list', '--ipfs-gateway', local.url]),
		).toMatchObject({
			code: 2,
		});
		expect(existsSync(join(tmp, 'data'))).toBe(false);
	});
});
