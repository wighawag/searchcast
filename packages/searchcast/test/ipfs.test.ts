// fetchIpfs (src/ipfs.ts) against local fake trustless gateways (HTTPS with
// the test certificate, trusted in this test process only, and one plain
// http://127.0.0.1 standing in for a local node; ipfs-gateway.ts). The CARs
// are built here from in-test files with the same IPFS libraries. No network.

import {randomBytes} from 'node:crypto';
import * as dagPb from '@ipld/dag-pb';
import {UnixFS} from 'ipfs-unixfs';
import {CID} from 'multiformats/cid';
import {sha256, sha512} from 'multiformats/hashes/sha2';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {InstallError} from '../src/install.js';
import {
	DEFAULT_IPFS_GATEWAYS,
	fetchIpfs,
	MAX_DIRECTORY_ENTRIES,
	parseIpfsUrl,
	UNUSED_SLACK_BYTES,
} from '../src/ipfs.js';
import {MAX_ARCHIVE_BYTES, MAX_UNPACKED_BYTES} from '../src/recipe-archive.js';
import {
	car,
	Dag,
	RAW,
	startGateway,
	trustTestCertificate,
	type Block,
	type Gateway,
} from './ipfs-gateway.js';
import {startConnectProxy} from './servers.js';

const query = '?format=car&dag-scope=all';
const entity = '?format=car&dag-scope=entity';
const RECIPE = Buffer.from(
	'{"name": "web", "padding": "' + 'x'.repeat(150) + '"}\n',
);
const CODE = Buffer.from(
	'export default {name: "api", search() { return []; }};\n',
);
const MANIFEST = Buffer.from('{"name": "my-set", "version": "1.0.0"}');

// The set: root/ { set/ { manifest.json, web.json (3 leaves), api.mjs }, README.txt }
const dag = new Dag();
let web: CID;
let api: CID;
let manifest: CID;
let set: CID;
let readme: CID;
let root: CID;
let setBlocks: Block[];
let a: Gateway;
let b: Gateway;
const gateways = () => [a.url, b.url];

beforeAll(async () => {
	trustTestCertificate();
	web = await dag.file(RECIPE);
	api = await dag.file(CODE);
	manifest = await dag.file(MANIFEST);
	set = await dag.dir({
		'manifest.json': manifest,
		'web.json': web,
		'api.mjs': api,
	});
	setBlocks = [...dag.blocks];
	readme = await dag.file(Buffer.from('hello\n'));
	root = await dag.dir({set, 'README.txt': readme});
	[a, b] = await Promise.all([startGateway(), startGateway()]);
});
afterAll(async () => {
	await a.close();
	await b.close();
});
afterEach(() => {
	for (const g of [a, b]) {
		g.hits.length = 0;
		g.routes.clear();
		g.ignoreScope = false;
	}
});

const logger = () => {
	const lines: string[] = [];
	return {lines, log: (line: string) => void lines.push(line)};
};
const block = (cid: CID) => dag.blocks.find((x) => x.cid.equals(cid))!;
const rootBlock = () => block(root);

describe('fetchIpfs', () => {
	it('fetches a file by CID, verified, with the trustless CAR request (format and accept)', async () => {
		const leaves = dagPb
			.decode(block(web).bytes)
			.Links.map((l) => block(l.Hash));
		const fileBlocks = [block(web), ...leaves];
		expect(leaves).toHaveLength(3); // a multi-block file
		a.routes.set(`/ipfs/${web}${query}`, await car([web], fileBlocks));
		const {lines, log} = logger();
		const result = await fetchIpfs(`ipfs://${web}`, {
			ipfsGateways: [a.url],
			log,
		});
		expect(result).toEqual({
			cid: web.toString(),
			path: '',
			gateway: a.url,
			content: {type: 'file', bytes: RECIPE},
		});
		// One request: `entity` is the whole file.
		expect(a.hits).toEqual([
			{
				url: `/ipfs/${web}${entity}`,
				accept: 'application/vnd.ipld.car',
				blocks: fileBlocks.map((x) => x.cid.toString()),
			},
		]);
		expect(lines.join('\n')).toMatch(/verified ipfs:\/\/\S+ against its CID/);
	});

	it('fetches a directory in two requests to the same gateway: its listing (entity), then its files (all)', async () => {
		a.routes.set(`/ipfs/${set}${query}`, await car([set], setBlocks));
		const listings: unknown[] = [];
		const {lines, log} = logger();
		const result = await fetchIpfs(`ipfs://${set}`, {
			ipfsGateways: gateways(),
			checkListing: (listing) => void listings.push(listing),
			log,
		});
		expect(result.gateway).toBe(a.url);
		expect(a.hits.map((h) => h.url)).toEqual([
			`/ipfs/${set}${entity}`,
			`/ipfs/${set}${query}`,
		]);
		expect(a.hits[0]!.blocks).toEqual([set.toString()]); // the listing only
		expect(listings).toEqual([
			{
				source: `ipfs://${set}`,
				cid: set.toString(),
				segments: [],
				names: ['api.mjs', 'manifest.json', 'web.json'],
			},
		]);
		expect(lines.join('\n')).toContain(`listed ipfs://${set} (from ${a.url})`);
		expect(b.hits).toEqual([]);
	});

	it('passes what checkListing throws on unchanged, after the listing request only, asking no other gateway', async () => {
		a.routes.set(`/ipfs/${root}${query}`, await car([root], dag.blocks));
		const refusal = new InstallError('not wanted');
		let seen: unknown;
		const error = await fetchIpfs(`ipfs://${root}`, {
			ipfsGateways: gateways(),
			checkListing: (listing) => {
				seen = listing;
				throw refusal;
			},
		}).catch((e: unknown) => e);
		expect(error).toBe(refusal);
		expect(seen).toMatchObject({
			cid: root.toString(),
			names: ['README.txt', 'set'],
		});
		expect(a.hits.map((h) => h.url)).toEqual([`/ipfs/${root}${entity}`]);
		expect(a.hits[0]!.blocks).toEqual([root.toString()]);
		expect(b.hits).toEqual([]);
		// Not called for a file target.
		a.routes.set(
			`/ipfs/${root}/README.txt${query}`,
			await car([root], dag.blocks),
		);
		const file = await fetchIpfs(`ipfs://${root}/README.txt`, {
			ipfsGateways: [a.url],
			checkListing: () => {
				throw refusal;
			},
		});
		expect(file.content).toEqual({type: 'file', bytes: Buffer.from('hello\n')});
	});

	it('after a verified listing, asks the next gateway for the whole DAG directly when the first fails it', async () => {
		a.routes.set(`/ipfs/${set}${entity}`, await car([set], [block(set)]));
		a.routes.set(`/ipfs/${set}${query}`, {status: 429});
		b.routes.set(`/ipfs/${set}${query}`, await car([set], setBlocks));
		let listings = 0;
		const result = await fetchIpfs(`ipfs://${set}`, {
			ipfsGateways: gateways(),
			checkListing: () => void listings++,
		});
		expect(result.gateway).toBe(b.url);
		expect(listings).toBe(1);
		expect(a.hits.map((h) => h.url)).toEqual([
			`/ipfs/${set}${entity}`,
			`/ipfs/${set}${query}`,
		]);
		expect(b.hits.map((h) => h.url)).toEqual([`/ipfs/${set}${query}`]);
	});

	it('takes a gateway that ignores dag-scope=entity: its whole DAG is not junk, and needs no second request', async () => {
		// A directory whose files are far above the slack.
		const big = new Dag();
		const body = Buffer.alloc(UNUSED_SLACK_BYTES * 2, 7);
		const dir = await big.dir({
			'manifest.json': await big.file(MANIFEST),
			'big.json': await big.file(body, 4096),
		});
		const bigBlocks = [...big.blocks];
		a.ignoreScope = true;
		a.routes.set(`/ipfs/${dir}${query}`, await car([dir], bigBlocks));
		let listings = 0;
		const {content} = await fetchIpfs(`ipfs://${dir}`, {
			ipfsGateways: [a.url],
			checkListing: () => void listings++,
		});
		expect(
			content.type === 'directory' && content.files.get('big.json'),
		).toEqual(body);
		expect(listings).toBe(1);
		expect(a.hits.map((h) => h.url)).toEqual([`/ipfs/${dir}${entity}`]);
		// Blocks outside the requested DAG are still junk beyond the slack.
		const junk = new Dag();
		await junk.put(RAW, Buffer.alloc(UNUSED_SLACK_BYTES + 1, 1));
		a.routes.set(
			`/ipfs/${dir}${query}`,
			await car([dir], [...bigBlocks, ...junk.blocks]),
		);
		await expect(
			fetchIpfs(`ipfs://${dir}`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(/bytes of blocks that are not part of the content/);
		// And so are a sibling's blocks, when the target is below the root.
		const parent = await big.dir({
			dir,
			'other.json': await big.file(randomBytes(UNUSED_SLACK_BYTES + 1), 4096),
		});
		a.routes.set(
			`/ipfs/${parent}/dir${query}`,
			await car([parent], big.blocks),
		);
		await expect(
			fetchIpfs(`ipfs://${parent}/dir`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(/bytes of blocks that are not part of the content/);
	});

	it('fetches a directory: every file reassembled from verified blocks, sorted by name', async () => {
		a.routes.set(`/ipfs/${set}${query}`, await car([set], setBlocks));
		const {content} = await fetchIpfs(`ipfs://${set}/`, {
			ipfsGateways: [a.url],
		});
		expect(content).toEqual({
			type: 'directory',
			files: new Map([
				['api.mjs', CODE],
				['manifest.json', MANIFEST],
				['web.json', RECIPE],
			]),
		});
		expect(content.type === 'directory' && [...content.files.keys()]).toEqual([
			'api.mjs',
			'manifest.json',
			'web.json',
		]);
	});

	it('resolves a path from the root CID through verified links (a directory, and a file in it)', async () => {
		a.routes.set(
			`/ipfs/${root}/set${query}`,
			await car([root], [rootBlock(), ...setBlocks]),
		);
		const dir = await fetchIpfs(`ipfs://${root}/set`, {ipfsGateways: [a.url]});
		expect(dir.path).toBe('set');
		expect(
			dir.content.type === 'directory' && dir.content.files.get('web.json'),
		).toEqual(RECIPE);

		const path = `/ipfs/${root}/set/web.json${query}`;
		a.routes.set(path, await car([root], [rootBlock(), ...setBlocks]));
		const file = await fetchIpfs(`ipfs://${root}/set/web.json`, {
			ipfsGateways: [a.url],
		});
		expect(file.content).toEqual({type: 'file', bytes: RECIPE});
	});

	it('ignores the CAR header roots (a hint at most) and accepts a CIDv0 root', async () => {
		const v0 = new Dag();
		const cid = await v0.file(RECIPE, 64, 0);
		expect(cid.version).toBe(0);
		a.routes.set(`/ipfs/${cid}${query}`, await car([web], v0.blocks));
		const {content} = await fetchIpfs(`ipfs://${cid}`, {ipfsGateways: [a.url]});
		expect(content).toEqual({type: 'file', bytes: RECIPE});
	});

	it('rejects a tampered block and tries the next gateway', async () => {
		const tampered = setBlocks.map((x) =>
			x.cid.equals(api)
				? {cid: x.cid, bytes: Buffer.from(CODE.toString().replace('[]', '[1]'))}
				: x,
		);
		a.routes.set(`/ipfs/${set}${query}`, await car([set], tampered));
		b.routes.set(`/ipfs/${set}${query}`, await car([set], setBlocks));
		const {lines, log} = logger();
		const result = await fetchIpfs(`ipfs://${set}`, {
			ipfsGateways: gateways(),
			log,
		});
		expect(result.gateway).toBe(b.url);
		expect(lines.join('\n')).toContain(
			`rejected ${a.url}: the CAR's block ${api} does not match its CID`,
		);
	});

	it('rejects a CAR of another root (the content is not the CID) and tries the next gateway', async () => {
		const other = new Dag();
		const cid = await other.file(Buffer.from('not the set'));
		a.routes.set(`/ipfs/${set}${query}`, await car([set], other.blocks));
		a.routes.set(`/ipfs/${web}${query}`, await car([cid], other.blocks));
		await expect(
			fetchIpfs(`ipfs://${set}`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(`${a.url}: the CAR lacks the block ${set}`);
		await expect(
			fetchIpfs(`ipfs://${web}`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(`the CAR lacks the block ${web}`);
	});

	it('rejects a CAR with a missing block and tries the next gateway', async () => {
		const leaf = dagPb.decode(block(web).bytes).Links[1]!.Hash;
		a.routes.set(
			`/ipfs/${set}${query}`,
			await car(
				[set],
				setBlocks.filter((x) => !x.cid.equals(leaf)),
			),
		);
		b.routes.set(`/ipfs/${set}${query}`, await car([set], setBlocks));
		const {lines, log} = logger();
		const result = await fetchIpfs(`ipfs://${set}`, {
			ipfsGateways: gateways(),
			log,
		});
		expect(result.gateway).toBe(b.url);
		expect(lines.join('\n')).toContain(
			`rejected ${a.url}: the CAR lacks the block ${leaf}`,
		);
	});

	it('rejects a CAR carrying more unused blocks than the slack', async () => {
		const junk = new Dag();
		await junk.put(RAW, Buffer.alloc(UNUSED_SLACK_BYTES + 1, 1));
		a.routes.set(
			`/ipfs/${set}${query}`,
			await car([set], [...setBlocks, ...junk.blocks]),
		);
		await expect(
			fetchIpfs(`ipfs://${set}`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(/bytes of blocks that are not part of the content/);
		// Within the slack, and duplicate blocks, are fine.
		const small = new Dag();
		await small.put(RAW, Buffer.alloc(100, 2));
		a.routes.set(
			`/ipfs/${set}${query}`,
			await car([set], [...setBlocks, ...small.blocks, ...setBlocks]),
		);
		expect(
			(await fetchIpfs(`ipfs://${set}`, {ipfsGateways: [a.url]})).gateway,
		).toBe(a.url);
	});

	it('rejects bytes that are not a CAR, and a block hashed with anything but sha2-256', async () => {
		a.routes.set(
			`/ipfs/${set}${query}`,
			Buffer.from('<html>rate limited</html>'),
		);
		await expect(
			fetchIpfs(`ipfs://${set}`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(/not a CAR/);
		const bytes = Buffer.from('x');
		const odd = CID.create(1, RAW, await sha512.digest(bytes));
		a.routes.set(
			`/ipfs/${set}${query}`,
			await car([set], [...setBlocks, {cid: odd, bytes}]),
		);
		await expect(
			fetchIpfs(`ipfs://${set}`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(/uses hash function 0x13, only sha2-256 is verified/);
	});

	it('rejects a CAR over the size cap and tries the next gateway', async () => {
		const body = await car([set], setBlocks);
		a.routes.set(
			`/ipfs/${set}${query}`,
			Buffer.concat([body, Buffer.alloc(4096)]),
		);
		b.routes.set(`/ipfs/${set}${query}`, body);
		const {lines, log} = logger();
		const result = await fetchIpfs(`ipfs://${set}`, {
			ipfsGateways: gateways(),
			maxCarBytes: body.length,
			log,
		});
		expect(result.gateway).toBe(b.url);
		expect(lines.join('\n')).toMatch(
			new RegExp(`rejected ${a.url}: .* is larger than ${body.length} bytes`),
		);
	});

	it('moves on from a 429 (and a 5xx) to a good gateway', async () => {
		a.routes.set(`/ipfs/${set}${query}`, {status: 429});
		b.routes.set(`/ipfs/${set}${query}`, await car([set], setBlocks));
		const result = await fetchIpfs(`ipfs://${set}`, {ipfsGateways: gateways()});
		expect(result.gateway).toBe(b.url);
		a.routes.set(`/ipfs/${set}${query}`, {status: 502});
		expect(
			(await fetchIpfs(`ipfs://${set}`, {ipfsGateways: gateways()})).gateway,
		).toBe(b.url);
	});

	it('fails only when every gateway failed, naming each one and its reason', async () => {
		a.routes.set(`/ipfs/${set}${query}`, {status: 429});
		const error = await fetchIpfs(`ipfs://${set}`, {
			ipfsGateways: gateways(),
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(InstallError);
		expect((error as Error).message).toBe(
			`no gateway served ipfs://${set} verified against its CID: ` +
				`${a.url}: GET ${a.url}/ipfs/${set}${entity}: HTTP 429; ` +
				`${b.url}: GET ${b.url}/ipfs/${set}${entity}: HTTP 404`,
		);
	});

	it('goes through the caller proxy only (CONNECT), for every gateway it asks', async () => {
		const proxy = await startConnectProxy();
		try {
			a.routes.set(`/ipfs/${set}${query}`, {status: 429});
			b.routes.set(`/ipfs/${set}${query}`, await car([set], setBlocks));
			const {lines, log} = logger();
			await fetchIpfs(`ipfs://${set}`, {
				ipfsGateways: gateways(),
				proxy: `http://127.0.0.1:${proxy.port}`,
				log,
			});
			// a's `entity` (429), then b's `entity` and `all` (a directory).
			expect(proxy.requests).toEqual([
				{host: 'localhost', port: Number(new URL(a.url).port)},
				{host: 'localhost', port: Number(new URL(b.url).port)},
				{host: 'localhost', port: Number(new URL(b.url).port)},
			]);
			expect(lines[0]).toMatch(/via http:\/\/127\.0\.0\.1:\d+$/);
		} finally {
			await proxy.close();
		}
	});

	it('takes a local node over plain http on loopback, and refuses http anywhere else', async () => {
		const local = await startGateway(false);
		try {
			local.routes.set(`/ipfs/${set}${query}`, await car([set], setBlocks));
			expect(
				(await fetchIpfs(`ipfs://${set}`, {ipfsGateways: [`${local.url}/`]}))
					.gateway,
			).toBe(local.url);
		} finally {
			await local.close();
		}
		for (const gateway of [
			'http://gateway.example',
			'ftp://127.0.0.1',
			'https://u:p@gw.example',
			'https://gw.example/?x=1',
			'nope',
		]) {
			await expect(
				fetchIpfs(`ipfs://${set}`, {ipfsGateways: [gateway]}),
			).rejects.toThrow(InstallError);
		}
		await expect(
			fetchIpfs(`ipfs://${set}`, {ipfsGateways: []}),
		).rejects.toThrow('no IPFS gateway given');
	});

	it('refuses what the verified content is, at once, without asking the next gateway', async () => {
		a.routes.set(
			`/ipfs/${root}/nope${query}`,
			await car([root], [rootBlock()]),
		);
		await expect(
			fetchIpfs(`ipfs://${root}/nope`, {ipfsGateways: gateways()}),
		).rejects.toThrow(`ipfs://${root}/nope: ${root} has no entry nope`);
		expect(b.hits).toEqual([]);
		// A nested directory in a listing.
		a.routes.set(`/ipfs/${root}${query}`, await car([root], dag.blocks));
		await expect(
			fetchIpfs(`ipfs://${root}`, {ipfsGateways: gateways()}),
		).rejects.toThrow(
			`${root}/set is a directory; only files are read from a directory (to read it, use ipfs://${root}/set)`,
		);
		// A path through a file.
		a.routes.set(`/ipfs/${web}/x${query}`, await car([web], setBlocks));
		await expect(
			fetchIpfs(`ipfs://${web}/x`, {ipfsGateways: gateways()}),
		).rejects.toThrow(`${web} is a file, not a directory`);
		expect(b.hits).toEqual([]);
	});

	it('enforces the reassembled-bytes cap, even when one block is reused many times', async () => {
		a.routes.set(`/ipfs/${set}${query}`, await car([set], setBlocks));
		await expect(
			fetchIpfs(`ipfs://${set}`, {ipfsGateways: [a.url], maxBytes: 100}),
		).rejects.toThrow('the content is larger than 100 bytes');
		const bomb = new Dag();
		const leaf = await bomb.put(RAW, Buffer.alloc(1024));
		let cid = leaf;
		let size = 1024n;
		for (let i = 0; i < 20; i++) {
			const unixfs = new UnixFS({type: 'file', blockSizes: [size, size]});
			cid = await bomb.put(
				dagPb.code,
				bomb.pbNode(unixfs, [
					{Hash: cid, Name: '', Tsize: 1},
					{Hash: cid, Name: '', Tsize: 1},
				]),
			);
			size *= 2n;
		}
		a.routes.set(`/ipfs/${cid}${query}`, await car([cid], bomb.blocks));
		await expect(
			fetchIpfs(`ipfs://${cid}`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(`the content is larger than ${MAX_UNPACKED_BYTES} bytes`);
	});

	it('refuses a DAG that would visit too many nodes (one empty block reused)', async () => {
		const bomb = new Dag();
		let cid = await bomb.put(RAW, Buffer.alloc(0));
		for (let i = 0; i < 20; i++) {
			const unixfs = new UnixFS({type: 'file', blockSizes: [0n, 0n]});
			cid = await bomb.put(
				dagPb.code,
				bomb.pbNode(unixfs, [
					{Hash: cid, Name: '', Tsize: 1},
					{Hash: cid, Name: '', Tsize: 1},
				]),
			);
		}
		a.routes.set(`/ipfs/${cid}${query}`, await car([cid], bomb.blocks));
		await expect(
			fetchIpfs(`ipfs://${cid}`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(/the DAG has more than \d+ nodes/);
	});

	it('refuses a directory with too many entries, and a path too deep', async () => {
		const big = new Dag();
		const leaf = await big.file(Buffer.from('x'));
		const entries = Object.fromEntries(
			Array.from({length: MAX_DIRECTORY_ENTRIES + 1}, (_, i) => [
				`f${i}.json`,
				leaf,
			]),
		);
		const cid = await big.dir(entries);
		a.routes.set(`/ipfs/${cid}${query}`, await car([cid], big.blocks));
		await expect(
			fetchIpfs(`ipfs://${cid}`, {ipfsGateways: [a.url]}),
		).rejects.toThrow(`has more than ${MAX_DIRECTORY_ENTRIES} entries`);
		await expect(
			fetchIpfs(`ipfs://${cid}/${'d/'.repeat(33)}x`, {ipfsGateways: [a.url]}),
		).rejects.toThrow('the path is deeper than 32 segments');
		expect(a.hits).toHaveLength(1);
	});

	it('caps may be lowered, never raised', async () => {
		await expect(
			fetchIpfs(`ipfs://${set}`, {
				ipfsGateways: [a.url],
				maxCarBytes: MAX_ARCHIVE_BYTES + 1,
			}),
		).rejects.toThrow(RangeError);
		await expect(
			fetchIpfs(`ipfs://${set}`, {
				ipfsGateways: [a.url],
				maxBytes: MAX_UNPACKED_BYTES + 1,
			}),
		).rejects.toThrow(RangeError);
		expect(a.hits).toEqual([]);
	});
});

describe('parseIpfsUrl', () => {
	it('takes ipfs://<cid>[/<path>] with percent-encoded segments', () => {
		const {cid, segments} = parseIpfsUrl(`ipfs://${set}/a%20b/c.json`);
		expect(cid.equals(set)).toBe(true);
		expect(segments).toEqual(['a b', 'c.json']);
	});

	it('refuses IPNS, DNSLink, queries, unsafe segments and CIDs it cannot verify, before any request', async () => {
		const identity = CID.parse('bafkqaaa'); // the identity-hashed empty CID
		const sha512Cid = CID.create(1, RAW, await sha512.digest(Buffer.from('x')));
		const cbor = CID.create(1, 0x71, await sha256.digest(Buffer.from('x')));
		for (const source of [
			`ipns://${set}`,
			'ipfs://example.com',
			`ipfs://${set}?format=car`,
			`ipfs://${set}#x`,
			`ipfs://${set}/../x`,
			`ipfs://${set}/a//b`,
			`ipfs://${set}/%2F`,
			`ipfs://${identity}`,
			`ipfs://${sha512Cid}`,
			`ipfs://${cbor}`,
			`https://ipfs.io/ipfs/${set}`,
		]) {
			expect(() => parseIpfsUrl(source), source).toThrow(InstallError);
		}
	});

	it('defaults to documented public trustless gateways, https only', () => {
		expect(DEFAULT_IPFS_GATEWAYS.length).toBeGreaterThan(0);
		for (const gateway of DEFAULT_IPFS_GATEWAYS)
			expect(gateway).toMatch(/^https:\/\/[^/]+$/);
	});
});
