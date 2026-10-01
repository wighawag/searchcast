// A UnixFS file or directory fetched by CID (`ipfs://<cid>[/<path>]`) from
// trustless gateways and verified block by block, for the install commands
// only (ADR 0002): never imported by the main entry (test/install.test.ts
// walks its imports). Content addressed by a CID is returned only if it IS
// that CID, whoever served it: a gateway is trusted for nothing.
//
// Each configured gateway is asked in order, through download.ts (the
// caller's proxy only, proxy environment ignored, no https-to-http redirect,
// a size cap), for `GET <gateway>/ipfs/<cid>[/<path>]?format=car&dag-scope=entity`
// with `accept: application/vnd.ipld.car`: the whole file for a file target
// (one request), the listing only for a directory target, which is then
// asked again with `dag-scope=all` once its listing is accepted (see the
// decisions of task ipfs-install-folder-hint). Every block of the CAR is hashed
// and checked against its CID (sha2-256 only; dag-pb and raw codecs only)
// before any is used; `<path>` is then resolved from the ROOT CID through
// verified dag-pb links, and the file (or each file of the directory) is
// reassembled from verified blocks only. The CAR header's roots and the
// gateway's own path resolution are ignored (the trustless gateway spec,
// section 5.2: "A Client SHOULD ignore this field").
//
// A gateway's failure (HTTP error such as 429 or 5xx, timeout, not a CAR, a
// block that does not match its CID, a missing block, valid but unused blocks
// beyond a small slack, a CAR over the size cap) moves on to the next
// gateway; the fetch fails only when every gateway failed, listing each one's
// reason. A refusal that follows from the VERIFIED content itself (the path
// does not exist, a nested directory, a HAMT-sharded directory, a symlink,
// too many entries, more bytes than the cap) is the same from every gateway,
// so it stops at once instead of asking the others.
//
// Decisions (task ipfs-verified-fetch, 2026-10-01):
// - The request carries BOTH `?format=car` and `accept:
//   application/vnd.ipld.car`, as the trustless gateway spec recommends
//   (sections 2.1.1 and 2.2.1: "A Client SHOULD include the format query
//   parameter in the request URL, in addition to the Accept header"); the
//   query parameter is what makes a cache key per format, the header is what
//   a strict trustless gateway may require. download.ts gained an optional
//   `accept` for it (no default: install-libcurl's requests are unchanged).
// - `dag-scope=all`, not the task's suggested `entity`: for a UnixFS
//   directory, `entity` means only the blocks needed to ENUMERATE it (spec
//   2.2.2), not its files' blocks, so listing a directory and reassembling
//   each file would need one more request per file. For a file `all` and
//   `entity` are the same blocks. One request per gateway is gentler on
//   rate-limited public gateways. Alternative: `entity` plus a request per
//   file. (SUPERSEDED by task ipfs-install-folder-hint, below: `entity`
//   first, then ONE `all` request for a directory, not one per file.)
// - Blocks are keyed by multihash, not by the CID they arrived under (a
//   blockstore's identity), so a CIDv0 link finds a block a gateway sent
//   under its CIDv1; the codec is always the LINK's, from verified bytes.
// - Unused valid blocks are tolerated up to UNUSED_SLACK_BYTES (64 KiB):
//   path-traversal blocks a gateway may add are used anyway; anything more is
//   a gateway sending what was not asked, refused. Duplicate blocks (the
//   CAR `dups` parameter) are not junk: the same verified bytes. (Since
//   ipfs-install-folder-hint, "used" is the requested DAG: see below.)
// - Directory listings are FLAT: a file entry (dag-pb UnixFS file or raw
//   leaf) only. A nested directory, a symlink, a HAMT-sharded directory or
//   metadata node is refused (recipe sets and release folders are flat and
//   small; sharding starts far above MAX_DIRECTORY_ENTRIES). Entry names must
//   be one safe path segment (no '/', '\', NUL, '.', '..', empty); what a
//   recipe set may contain is install-recipes' check, not this module's.
// - Caps: the CAR's size ceiling is install-recipes' archive ceiling
//   (MAX_ARCHIVE_BYTES, 16 MiB) and the reassembled bytes' is its unpacked
//   ceiling (MAX_UNPACKED_BYTES, 64 MiB); both may be lowered, never raised.
//   Also: at most MAX_PATH_SEGMENTS (32) path segments, MAX_DIRECTORY_ENTRIES
//   (1024) entries, MAX_FILE_DEPTH (64) levels of a file DAG and MAX_NODES
//   (262144) nodes visited (so a DAG reusing one block many times cannot make
//   reassembly exponential, even with empty leaves).
// - Gateways must be `https://`, or `http://` on a loopback host
//   (127.0.0.1, localhost, [::1]) for a local Kubo. With a proxy, a loopback
//   gateway is reached THROUGH the proxy like every other request (the
//   proxy's loopback, then): the caller's egress is never bypassed.
// - Errors are InstallError (this is install-side), without install-recipes'
//   "Nothing was installed." suffix: the caller adds its own context.
// - Not exported from `searchcast/install`: `installRecipes` (an `ipfs://`
//   source, task install-recipes-from-ipfs) is how embedders reach it; only
//   `DEFAULT_IPFS_GATEWAYS` is exported. Alternative: export `fetchIpfs` as a
//   public API; deferred so no API is published without a user.
//
// Decisions (task ipfs-install-folder-hint, 2026-10-01):
// - Two phases, so a directory that cannot be what the caller wants costs
//   one small request: every gateway is first asked with
//   `dag-scope=entity`. A file target is complete in that answer (spec
//   2.2.2: the whole file), so it stays one request. A directory target's
//   answer is its listing: its entry names (from its verified block, the
//   path resolved from the root as always) go to the caller's
//   `checkListing` callback, whose throw is the refusal (passed on
//   unchanged, no other gateway asked: it follows from verified content).
//   Only then is the SAME gateway asked with `dag-scope=all`.
// - Where the check lives: in the caller (install-recipes.ts knows what a
//   recipe set is), through the `checkListing` callback; this module stays
//   generic and only knows UnixFS. Alternative: a two-phase API (`list`
//   then `fetch`), which would make every caller drive the gateway loop and
//   the "which gateway answered" state itself.
// - Once a listing was verified and accepted, a later gateway (after the
//   first one failed on the `all` request) is asked with `dag-scope=all`
//   directly: the listing is the CID's, so it cannot differ. Alternative:
//   restart at `entity` on each gateway (one more request each).
// - A gateway that ignores `dag-scope=entity` (allowed: spec 2.2.2, it may
//   return more) is not penalised: the blocks counted as used are the
//   path's blocks plus EVERY block reachable from the target through links
//   of blocks in the CAR (the requested DAG), so its extra blocks are not
//   junk; and when its `entity` answer already holds every reachable block,
//   the directory is rebuilt from it with no second request. Blocks outside
//   the requested DAG (siblings, unrelated content) still count against the
//   slack, in both phases. For an `all` answer this is the same set as
//   before (rebuilding a flat directory visits every reachable block).
//   Alternative: no slack in the `entity` phase (weaker: junk would pass).
// - The slack is now checked before the content is rebuilt, so a CAR that
//   is both junk-laden and refused for its content is a gateway failure
//   (the next gateway is asked) rather than a refusal.
// - The nested-directory refusal names the `ipfs://` path of that
//   directory, to try it as a target itself.

import {createHash} from 'node:crypto';
import {CarBufferReader} from '@ipld/car/buffer-reader';
import * as dagPb from '@ipld/dag-pb';
import {UnixFS} from 'ipfs-unixfs';
import {CID} from 'multiformats/cid';
import {describeProxy, download} from './download.js';
import {InstallError} from './install.js';
import {checkNumber} from './options.js';
import {MAX_ARCHIVE_BYTES, MAX_UNPACKED_BYTES} from './recipe-archive.js';

/**
 * The default trustless gateways, in order: two operators, so one backend's
 * rate limit is not the end. `trustless-gateway.link` is the IPFS
 * Foundation's trustless-only gateway (docs.ipfs.tech, "Public IPFS
 * Utilities"; ipfs.io and dweb.link are the SAME backend, so they are not
 * added); `4everland.io` is the second default trustless gateway of Helia
 * (`@helia/block-brokers`). Chosen from the spec and that documentation
 * only: NOT live-verified in the build that added it (2026-10-01), because
 * public gateways were rate-limiting the build machine.
 */
export const DEFAULT_IPFS_GATEWAYS: readonly string[] = Object.freeze([
	'https://trustless-gateway.link',
	'https://4everland.io',
]);

export interface FetchIpfsOptions {
	/** Path-gateway base URLs, tried in order. Default `DEFAULT_IPFS_GATEWAYS`. */
	ipfsGateways?: readonly string[];
	/** Proxy for every request (`http://`, `socks5://`, `socks5h://`). */
	proxy?: string;
	/** Largest CAR, in bytes. Default and ceiling `MAX_ARCHIVE_BYTES` (16 MiB): may only be lowered. */
	maxCarBytes?: number;
	/** Largest total of reassembled file bytes. Default and ceiling `MAX_UNPACKED_BYTES` (64 MiB): may only be lowered. */
	maxBytes?: number;
	/** Progress lines (which gateway is asked, why one failed). */
	log?: (line: string) => void;
	/**
	 * Called once with a directory target's verified listing, after the
	 * first (`dag-scope=entity`) request and before its files are fetched.
	 * What it throws is the fetch's refusal, passed on unchanged, and no
	 * other request is made. Not called for a file target.
	 */
	checkListing?: (listing: IpfsListing) => void;
}

export type IpfsContent =
	| {type: 'file'; bytes: Buffer}
	| {type: 'directory'; files: Map<string, Buffer>};

export interface FetchIpfsResult {
	/** The root CID, as given. */
	cid: string;
	/** The path below it, segments joined with '/' ('' for the root). */
	path: string;
	/** The gateway (base URL) whose CAR verified. */
	gateway: string;
	content: IpfsContent;
}

/** Unused valid blocks tolerated in a CAR, in bytes. */
export const UNUSED_SLACK_BYTES = 64 * 1024;
export const MAX_PATH_SEGMENTS = 32;
export const MAX_DIRECTORY_ENTRIES = 1024;
const MAX_FILE_DEPTH = 64;
const MAX_NODES = 1 << 18;
const IDLE_TIMEOUT_MS = 60_000;
const SHA2_256 = 0x12;
const RAW = 0x55;
const CAR = 'application/vnd.ipld.car';

/** A gateway's fault: the next gateway may do better. */
class GatewayError extends Error {}

/** `ipfs://<cid>[/<path>]` as a CID and decoded path segments; an InstallError otherwise. */
export function parseIpfsUrl(source: string): {cid: CID; segments: string[]} {
	const match = /^ipfs:\/\/([^/?#]+)((?:\/[^?#]*)?)$/i.exec(source);
	if (!match) {
		throw new InstallError(
			`${source} is not an ipfs://<cid>[/<path>] URL (no query, fragment, IPNS or DNSLink)`,
		);
	}
	let cid: CID;
	try {
		cid = CID.parse(match[1]!);
	} catch (cause) {
		throw new InstallError(
			`${JSON.stringify(match[1])} is not a CID (base32 CIDv1 or base58 CIDv0): ${(cause as Error).message}`,
			{cause},
		);
	}
	checkCid(cid, (why) => new InstallError(`${source}: the CID ${why}`));
	const segments = match[2]!.split('/').slice(1);
	if (segments.at(-1) === '') segments.pop(); // a trailing slash
	const decoded = segments.map((segment) => {
		let name: string;
		try {
			name = decodeURIComponent(segment);
		} catch {
			name = '';
		}
		if (!safeName(name)) {
			throw new InstallError(
				`${source}: ${JSON.stringify(segment)} is not a path segment`,
			);
		}
		return name;
	});
	if (decoded.length > MAX_PATH_SEGMENTS) {
		throw new InstallError(
			`${source}: the path is deeper than ${MAX_PATH_SEGMENTS} segments`,
		);
	}
	return {cid, segments: decoded};
}

/** A directory target's verified listing, as `checkListing` is given it. */
export interface IpfsListing {
	/** The source, as given. */
	source: string;
	/** The root CID. */
	cid: string;
	/** The directory's path below the root CID, as decoded segments. */
	segments: readonly string[];
	/** The directory's entry names, from its VERIFIED block only, sorted. */
	names: readonly string[];
}

/** `ipfs://<cid>/<segments>`, each segment percent-encoded (what parseIpfsUrl reads back). */
export function ipfsUrl(cid: string, segments: readonly string[]): string {
	return `ipfs://${[cid, ...segments.map(encodeURIComponent)].join('/')}`;
}

/** What a `checkListing` callback threw: the fetch's refusal, passed on unchanged. */
class Refusal extends Error {
	constructor(readonly refusal: unknown) {
		super('refused by checkListing');
	}
}

/** The UnixFS file or flat directory at `ipfs://<cid>[/<path>]`, verified against the CID. */
export async function fetchIpfs(
	source: string,
	options: FetchIpfsOptions = {},
): Promise<FetchIpfsResult> {
	const log = options.log ?? (() => {});
	const maxCarBytes =
		checkNumber('maxCarBytes', options.maxCarBytes, {
			integer: true,
			max: MAX_ARCHIVE_BYTES,
		}) ?? MAX_ARCHIVE_BYTES;
	const maxBytes =
		checkNumber('maxBytes', options.maxBytes, {
			integer: true,
			max: MAX_UNPACKED_BYTES,
		}) ?? MAX_UNPACKED_BYTES;
	const gateways = (options.ipfsGateways ?? DEFAULT_IPFS_GATEWAYS).map(
		gatewayBase,
	);
	if (!gateways.length) throw new InstallError('no IPFS gateway given');
	const {cid, segments} = parseIpfsUrl(source);
	const path = segments.map(encodeURIComponent).join('/');
	const via = options.proxy ? ` via ${describeProxy(options.proxy)}` : '';
	const reasons: string[] = [];
	// Whether a directory target's listing was verified (and accepted by
	// checkListing): it is the same from every gateway, so the next one is
	// asked for the whole DAG at once.
	let listed = false;
	for (const gateway of gateways) {
		let scope: 'entity' | 'all' = listed ? 'all' : 'entity';
		try {
			for (;;) {
				const url = `${gateway}/ipfs/${cid}${path ? `/${path}` : ''}?format=car&dag-scope=${scope}`;
				log(`fetching ${url}${via}`);
				const {body: car} = await download(url, {
					proxy: options.proxy,
					maxBytes: maxCarBytes,
					idleTimeoutMs: IDLE_TIMEOUT_MS,
					accept: CAR,
				});
				const dag = verified(car, cid, segments, maxBytes);
				let content: IpfsContent | undefined;
				if (dag.type === 'file') {
					content = {type: 'file', bytes: dag.file()};
				} else {
					const names = dag.names();
					if (!listed) {
						try {
							options.checkListing?.({
								source,
								cid: cid.toString(),
								segments,
								names,
							});
						} catch (refusal) {
							throw new Refusal(refusal);
						}
						listed = true;
					}
					// An `all` answer, or an `entity` answer from a gateway that
					// sent more (the spec allows it): every block is here.
					if (scope === 'all' || dag.complete) {
						content = {type: 'directory', files: dag.files()};
					}
				}
				if (content) {
					log(`verified ${source} against its CID (from ${gateway})`);
					return {
						cid: cid.toString(),
						path: segments.join('/'),
						gateway,
						content,
					};
				}
				log(`listed ${source} (from ${gateway}); fetching its files`);
				scope = 'all';
			}
		} catch (error) {
			if (error instanceof Refusal) throw error.refusal;
			if (error instanceof InstallError) {
				throw new InstallError(`${source}: ${error.message}`, {cause: error});
			}
			const reason = `${gateway}: ${(error as Error).message}`;
			log(`rejected ${reason}`);
			reasons.push(reason);
		}
	}
	throw new InstallError(
		`no gateway served ${source} verified against its CID: ${reasons.join('; ')}`,
	);
}

/** A gateway base URL without its trailing slash; an InstallError when it is not allowed. */
function gatewayBase(gateway: string): string {
	let url: URL;
	try {
		url = new URL(gateway);
	} catch {
		throw new InstallError(`not an IPFS gateway URL: ${gateway}`);
	}
	const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
		throw new InstallError(
			`the IPFS gateway ${gateway} must be https:// (http:// only on 127.0.0.1, localhost or [::1], a local node)`,
		);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new InstallError(
			`the IPFS gateway ${gateway} must be a base URL (no credentials, query or fragment)`,
		);
	}
	return url.href.replace(/\/+$/, '');
}

/** Whether a CID can be verified here (sha2-256; dag-pb or raw); else `fail(why)`. */
function checkCid(cid: CID, fail: (why: string) => Error): void {
	if (cid.multihash.code !== SHA2_256 || cid.multihash.size !== 32) {
		throw fail(
			`${cid} uses hash function 0x${cid.multihash.code.toString(16)}, only sha2-256 is verified`,
		);
	}
	if (cid.code !== dagPb.code && cid.code !== RAW) {
		throw fail(
			`${cid} has codec 0x${cid.code.toString(16)}, only dag-pb and raw (UnixFS) are read`,
		);
	}
}

/** One safe path segment or entry name. */
function safeName(name: string): boolean {
	return name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}

const key = (cid: CID) => Buffer.from(cid.multihash.bytes).toString('hex');

/** A verified block read as UnixFS: a raw leaf, or a dag-pb node and its UnixFS data. */
type Node = {raw: Buffer} | {pb: dagPb.PBNode; unixfs: UnixFS};

/** What a node is: `file` for a raw leaf or a UnixFS file or raw node. */
const kind = (n: Node): string =>
	'raw' in n || n.unixfs.type === 'raw' ? 'file' : n.unixfs.type;

/** `root`/`segments` resolved in a verified CAR. */
interface VerifiedDag {
	type: 'file' | 'directory';
	/** Whether every block reachable from the target is in the CAR. */
	complete: boolean;
	/** The file's bytes (type `file`). */
	file(): Buffer;
	/** The directory's entry names, sorted (type `directory`; its block only). */
	names(): string[];
	/** The directory's files by name, sorted (type `directory`; every block). */
	files(): Map<string, Buffer>;
}

/**
 * `root`/`segments` in `car`: a GatewayError when the CAR is not the CID's
 * (the next gateway may serve it right), an InstallError when the verified
 * content itself is refused. Blocks that are neither on the path nor
 * reachable from the target count against UNUSED_SLACK_BYTES.
 */
function verified(
	car: Buffer,
	root: CID,
	segments: string[],
	maxBytes: number,
): VerifiedDag {
	let reader: CarBufferReader;
	try {
		reader = CarBufferReader.fromBytes(car);
	} catch (cause) {
		throw new GatewayError(`not a CAR: ${(cause as Error).message}`);
	}
	const blocks = new Map<string, Buffer>();
	for (const {cid, bytes} of reader.blocks()) {
		checkCid(cid, (why) => new GatewayError(`the CAR's block ${why}`));
		const digest = createHash('sha256').update(bytes).digest();
		if (!digest.equals(cid.multihash.digest)) {
			throw new GatewayError(`the CAR's block ${cid} does not match its CID`);
		}
		blocks.set(key(cid), Buffer.from(bytes));
	}
	const used = new Set<string>();
	let nodes = 0;
	let total = 0;

	const node = (cid: CID): Node => {
		if (++nodes > MAX_NODES) {
			throw new InstallError(`the DAG has more than ${MAX_NODES} nodes`);
		}
		const bytes = blocks.get(key(cid));
		if (!bytes) throw new GatewayError(`the CAR lacks the block ${cid}`);
		used.add(key(cid));
		if (cid.code === RAW) return {raw: bytes};
		let pb: dagPb.PBNode;
		let unixfs: UnixFS;
		try {
			pb = dagPb.decode(bytes);
			if (!pb.Data) throw new Error('no UnixFS data');
			unixfs = UnixFS.unmarshal(pb.Data);
		} catch (cause) {
			throw new InstallError(
				`${cid} is not a UnixFS node: ${(cause as Error).message}`,
			);
		}
		for (const link of pb.Links) {
			checkCid(
				link.Hash,
				(why) => new InstallError(`a link of ${cid}: ${why}`),
			);
		}
		return {pb, unixfs};
	};

	/** The bytes of the UnixFS file `n` (at `cid`), reassembled from verified blocks. */
	const file = (cid: CID, n: Node, depth = 0): Buffer => {
		if (depth > MAX_FILE_DEPTH) {
			throw new InstallError(`the file DAG is deeper than ${MAX_FILE_DEPTH}`);
		}
		if (kind(n) !== 'file') {
			throw new InstallError(`${cid} is a ${kind(n)} inside a file`);
		}
		const count = (bytes: Uint8Array) => {
			total += bytes.length;
			if (total > maxBytes) {
				throw new InstallError(`the content is larger than ${maxBytes} bytes`);
			}
			return Buffer.from(bytes);
		};
		if ('raw' in n) return count(n.raw);
		const {pb, unixfs} = n;
		const data = count(unixfs.data ?? new Uint8Array());
		if (unixfs.type === 'raw' && pb.Links.length) {
			throw new InstallError(`${cid} is a raw node with links`);
		}
		if (pb.Links.length !== unixfs.blockSizes.length && pb.Links.length) {
			throw new InstallError(
				`${cid} has ${pb.Links.length} links but ${unixfs.blockSizes.length} block sizes`,
			);
		}
		const parts: Buffer[] = [data];
		pb.Links.forEach((link, i) => {
			const child = file(link.Hash, node(link.Hash), depth + 1);
			if (BigInt(child.length) !== unixfs.blockSizes[i]) {
				throw new InstallError(
					`${link.Hash} is ${child.length} bytes, its parent ${cid} says ${unixfs.blockSizes[i]}`,
				);
			}
			parts.push(child);
		});
		return Buffer.concat(parts);
	};

	/** A plain directory's entries by name. */
	const entries = (cid: CID, n: Node): Map<string, CID> => {
		if ('raw' in n || n.unixfs.type !== 'directory') {
			throw new InstallError(
				kind(n) === 'hamt-sharded-directory'
					? `${cid} is a HAMT-sharded directory, which is not supported`
					: `${cid} is a ${kind(n)}, not a directory`,
			);
		}
		if (n.pb.Links.length > MAX_DIRECTORY_ENTRIES) {
			throw new InstallError(
				`${cid} has more than ${MAX_DIRECTORY_ENTRIES} entries`,
			);
		}
		const links = new Map<string, CID>();
		for (const link of n.pb.Links) {
			const name = link.Name ?? '';
			if (!safeName(name)) {
				throw new InstallError(
					`${cid} has an entry named ${JSON.stringify(name)}`,
				);
			}
			if (links.has(name)) {
				throw new InstallError(`${cid} has the entry ${name} twice`);
			}
			links.set(name, link.Hash);
		}
		return new Map([...links].sort(([a], [b]) => (a < b ? -1 : 1)));
	};

	let cid = root;
	for (const [i, segment] of segments.entries()) {
		const next = entries(cid, node(cid)).get(segment);
		if (!next) {
			const at = [root, ...segments.slice(0, i)].join('/');
			throw new InstallError(`${at} has no entry ${segment}`);
		}
		cid = next;
	}
	const target = cid;
	const terminus = node(target);

	// The blocks reachable from the target through the links of blocks in
	// the CAR (whatever they are; the content checks come later), and
	// whether any is missing. With the path's blocks they are the requested
	// DAG; anything else is junk, tolerated up to the slack.
	const reachable = new Set<string>([key(target)]);
	let missing = 0;
	const queue = [target];
	while (queue.length) {
		const bytes = blocks.get(key(queue.pop()!))!;
		let links: dagPb.PBLink[] = [];
		try {
			links = dagPb.decode(bytes).Links;
		} catch {
			// a raw leaf, or not dag-pb: no links to follow
		}
		for (const {Hash} of links) {
			const k = key(Hash);
			if (reachable.has(k)) continue;
			if (!blocks.has(k)) {
				missing++;
				continue;
			}
			reachable.add(k);
			queue.push(Hash);
		}
	}
	let unused = 0;
	for (const [k, bytes] of blocks) {
		if (!used.has(k) && !reachable.has(k)) unused += bytes.length;
	}
	if (unused > UNUSED_SLACK_BYTES) {
		throw new GatewayError(
			`the CAR holds ${unused} bytes of blocks that are not part of the content (at most ${UNUSED_SLACK_BYTES})`,
		);
	}

	return {
		type: kind(terminus) === 'file' ? 'file' : 'directory',
		complete: missing === 0,
		file: () => file(target, terminus),
		names: () => [...entries(target, terminus).keys()],
		files: () => {
			const files = new Map<string, Buffer>();
			for (const [name, link] of entries(target, terminus)) {
				const entry = node(link);
				if (kind(entry) !== 'file') {
					throw new InstallError(
						`${target}/${name} is a ${kind(entry)}; only files are read from a directory (to read it, use ${ipfsUrl(root.toString(), [...segments, name])})`,
					);
				}
				files.set(name, file(link, entry));
			}
			return files;
		},
	};
}
