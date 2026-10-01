// A fake IPFS trustless gateway and a UnixFS DAG builder, for the IPFS tests
// (ipfs.test.ts, install-recipes-ipfs.test.ts): CARs built in-test with the
// same IPFS libraries, served over HTTPS with the test certificate (trust it
// in the test process) or plain http://127.0.0.1 (a local node). No network.

import {readFileSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type {AddressInfo} from 'node:net';
import tls from 'node:tls';
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
	hits: {url: string; accept?: string}[];
	/** What `GET /ipfs/...` answers; undefined is a 404. */
	routes: Map<string, Answer>;
	close(): Promise<void>;
}

export async function startGateway(secure = true): Promise<Gateway> {
	const hits: Gateway['hits'] = [];
	const routes = new Map<string, Answer>();
	const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
		hits.push({url: req.url ?? '', accept: req.headers.accept});
		const answer = routes.get(req.url ?? '');
		if (!answer) return void res.writeHead(404).end('not found');
		if (Buffer.isBuffer(answer)) {
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
	return {
		url: secure ? `https://localhost:${port}` : `http://127.0.0.1:${port}`,
		hits,
		routes,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
