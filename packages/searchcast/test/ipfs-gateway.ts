// A fake IPFS trustless gateway and a UnixFS DAG builder, for the IPFS tests
// (ipfs.test.ts, install-recipes-ipfs.test.ts): CARs built in-test with the
// same IPFS libraries, served over HTTPS with the test certificate (trust it
// in the test process) or plain http://127.0.0.1 (a local node). No network.
//
// A route is set for a `dag-scope=all` URL (or any exact URL). Asked the
// same path with `dag-scope=entity` and no route of its own, the gateway
// answers what a spec-following gateway would (trustless gateway spec
// 2.2.2): the path's blocks and the target's, plus, for a file, all of the
// file's blocks; for a directory, its own block only. It derives that from
// the `all` CAR; when it cannot (the CAR is not the path's DAG: a test of a
// bad gateway), or when `ignoreScope` is set (a gateway ignoring the
// parameter, which the spec allows), it sends the `all` answer as is. Each
// hit records the CIDs of the blocks it was sent.

import {readFileSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type {AddressInfo} from 'node:net';
import tls from 'node:tls';
import {CarBufferReader} from '@ipld/car/buffer-reader';
import {CarWriter} from '@ipld/car/writer';
import * as dagPb from '@ipld/dag-pb';
import {UnixFS} from 'ipfs-unixfs';
import {CID} from 'multiformats/cid';
import {sha256} from 'multiformats/hashes/sha2';
import {CA_PATH} from './servers.js';

/** Trust the test certificate, in this test process only (vitest forks). */
export function trustTestCertificate(): void {
	tls.setDefaultCACertificates([
		...tls.getCACertificates('default'),
		readFileSync(CA_PATH, 'utf8'),
	]);
}

export const RAW = 0x55;

export interface Block {
	cid: CID;
	bytes: Uint8Array;
}

/** A UnixFS DAG built block by block, as `ipfs add` would (raw leaves, CIDv1). */
export class Dag {
	blocks: Block[] = [];
	async put(codec: number, bytes: Uint8Array, version: 0 | 1 = 1) {
		const cid = CID.create(version, codec, await sha256.digest(bytes));
		this.blocks.push({cid, bytes});
		return cid;
	}
	pbNode(unixfs: UnixFS, links: dagPb.PBLink[] = []): Uint8Array {
		return dagPb.encode(dagPb.prepare({Data: unixfs.marshal(), Links: links}));
	}
	/** A file: one raw leaf, or raw leaves of `chunk` bytes under a dag-pb root. */
	async file(body: Buffer, chunk = 64, version: 0 | 1 = 1): Promise<CID> {
		if (body.length <= chunk && version === 1) return this.put(RAW, body);
		const leaves: CID[] = [];
		const sizes: bigint[] = [];
		for (let i = 0; i < body.length; i += chunk) {
			const part = body.subarray(i, i + chunk);
			leaves.push(await this.put(RAW, part));
			sizes.push(BigInt(part.length));
		}
		const unixfs = new UnixFS({type: 'file', blockSizes: sizes});
		const links = leaves.map((Hash, i) => ({
			Hash,
			Name: '',
			Tsize: Number(sizes[i]),
		}));
		return this.put(dagPb.code, this.pbNode(unixfs, links), version);
	}
	async dir(entries: Record<string, CID>): Promise<CID> {
		const links = Object.entries(entries).map(([Name, Hash]) => ({
			Name,
			Hash,
			Tsize: 1,
		}));
		return this.put(
			dagPb.code,
			this.pbNode(new UnixFS({type: 'directory'}), links),
		);
	}
}

/** A CARv1 of `blocks` with `roots` in its header. */
export async function car(roots: CID[], blocks: Block[]): Promise<Buffer> {
	const {writer, out} = CarWriter.create(roots);
	const chunks: Uint8Array[] = [];
	const collected = (async () => {
		for await (const chunk of out) chunks.push(chunk);
	})();
	for (const block of blocks) await writer.put(block);
	await writer.close();
	await collected;
	return Buffer.concat(chunks);
}

export type Answer = Buffer | {status: number};
export interface Gateway {
	url: string;
	/** Each request: its URL and accept header, and the CIDs of the blocks of the CAR sent (if one was). */
	hits: {url: string; accept?: string; blocks?: string[]}[];
	/** What `GET /ipfs/...` answers; undefined is a 404. */
	routes: Map<string, Answer>;
	/** Answer a `dag-scope=entity` request with the `all` CAR, as a gateway ignoring the parameter. */
	ignoreScope: boolean;
	close(): Promise<void>;
}

/** The CIDs of a CAR's blocks, or undefined when it is not a CAR. */
function blockCids(body: Buffer): string[] | undefined {
	try {
		return [...CarBufferReader.fromBytes(body).blocks()].map(({cid}) =>
			cid.toString(),
		);
	} catch {
		return undefined;
	}
}

/**
 * The `dag-scope=entity` CAR for `/ipfs/<cid>[/<path>]`, from the `all` CAR
 * of the same path; undefined when the `all` CAR does not hold that DAG.
 */
async function entityCar(
	path: string,
	all: Buffer,
): Promise<Buffer | undefined> {
	let byHash: Map<string, Block>;
	let segments: string[];
	let root: CID;
	try {
		byHash = new Map(
			[...CarBufferReader.fromBytes(all).blocks()].map((b) => [
				Buffer.from(b.cid.multihash.bytes).toString('hex'),
				b,
			]),
		);
		const [cid, ...rest] = path.replace(/^\/ipfs\//, '').split('/');
		root = CID.parse(cid!);
		segments = rest.filter((s) => s !== '').map(decodeURIComponent);
	} catch {
		return undefined;
	}
	const get = (cid: CID) =>
		byHash.get(Buffer.from(cid.multihash.bytes).toString('hex'));
	const unixfs = (block: Block) =>
		block.cid.code === RAW
			? undefined
			: {
					pb: dagPb.decode(block.bytes),
					type: UnixFS.unmarshal(dagPb.decode(block.bytes).Data!).type,
				};
	try {
		const out: Block[] = [];
		let cid = root;
		for (const segment of segments) {
			const block = get(cid);
			const node = block && unixfs(block);
			if (!node || node.type !== 'directory') return undefined;
			out.push(block);
			const link = node.pb.Links.find((l) => l.Name === segment);
			if (!link) return undefined;
			cid = link.Hash;
		}
		const target = get(cid);
		if (!target) return undefined;
		const node = unixfs(target);
		if (node && node.type === 'directory') {
			out.push(target);
		} else if (!node || node.type === 'file' || node.type === 'raw') {
			// The whole file: every block below it, once each.
			const seen = new Set<Block>();
			const queue = [target];
			while (queue.length) {
				const block = queue.pop()!;
				if (seen.has(block)) continue;
				seen.add(block);
				out.push(block);
				const children: Block[] = [];
				for (const link of unixfs(block)?.pb.Links ?? []) {
					const child = get(link.Hash);
					if (!child) return undefined;
					children.push(child);
				}
				queue.push(...children.reverse()); // depth first, in link order
			}
		} else {
			return undefined;
		}
		return await car([root], out);
	} catch {
		return undefined;
	}
}

export async function startGateway(secure = true): Promise<Gateway> {
	const hits: Gateway['hits'] = [];
	const routes = new Map<string, Answer>();
	const handler = async (
		req: http.IncomingMessage,
		res: http.ServerResponse,
	) => {
		const url = req.url ?? '';
		const hit: Gateway['hits'][number] = {url, accept: req.headers.accept};
		hits.push(hit);
		let answer = routes.get(url);
		if (!answer && url.endsWith('&dag-scope=entity')) {
			answer = routes.get(url.replace(/entity$/, 'all'));
			if (Buffer.isBuffer(answer) && !gateway.ignoreScope) {
				answer = (await entityCar(url.split('?')[0]!, answer)) ?? answer;
			}
		}
		if (!answer) return void res.writeHead(404).end('not found');
		if (Buffer.isBuffer(answer)) {
			hit.blocks = blockCids(answer);
			res.writeHead(200, {
				'content-type': 'application/vnd.ipld.car; version=1',
			});
			return void res.end(answer);
		}
		res.writeHead(answer.status).end();
	};
	const fixture = (name: string) =>
		readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
	const server = secure
		? https.createServer(
				{
					key: fixture('localhost-key.pem'),
					cert: fixture('localhost-cert.pem'),
				},
				handler,
			)
		: http.createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	const gateway: Gateway = {
		url: secure ? `https://localhost:${port}` : `http://127.0.0.1:${port}`,
		hits,
		routes,
		ignoreScope: false,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
	return gateway;
}
