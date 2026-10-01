---
title: Fetch a UnixFS file or directory by CID from trustless gateways, verified block by block, through the caller's proxy
slug: ipfs-verified-fetch
spec: ipfs-recipe-install
blockedBy: []
covers: [3, 4, 5]
---

## What to build

A module (install-side only: reachable from `searchcast/install` and the CLI, NEVER from the main entry; the existing import-walk test must keep proving the main entry reaches no download code) that, given `ipfs://<cid>[/<path>]`:

- requests `GET <gateway>/ipfs/<cid>[/<path>]?format=car&dag-scope=entity` (or `Accept: application/vnd.ipld.car`, per the IPFS trustless gateway spec, https://specs.ipfs.tech/http-gateways/trustless-gateway/; read it and record which form and why) through `download.ts` (the caller's proxy only, size cap, no https-to-http redirect), from each configured gateway in order;
- parses the CAR, checks every block's bytes hash to its CID (sha2-256 and the codecs UnixFS uses; refuse other hash functions), resolves `<path>` from the ROOT CID through verified dag-pb links (never trusting the gateway's path resolution or the CAR header's roots for anything but a hint), and reassembles the UnixFS file (or lists the directory and reassembles each file) from verified blocks only;
- rejects a CAR with a missing or mismatching block, an unexpected root, extra junk beyond a small slack, or sizes beyond the caps, then tries the next gateway; a 429/5xx/timeout also moves on; it fails only when every gateway failed, listing each gateway's reason;
- caps: compressed CAR size and total reassembled bytes (same ceilings as install-recipes: may be lowered, never raised); a directory with too many entries or too deep a path is refused.

Gateways: an option `ipfsGateways: string[]` (path-gateway base URLs, `https://` only except `http://127.0.0.1`/`localhost` for a local Kubo); default a short documented list of public trustless gateways (check which actually serve trustless CARs today, with at most one request each, and record it). No IPNS, no DNSLink.

Dependencies: pure JS from the IPFS project only (for example `multiformats`, `@ipld/car`, `@ipld/dag-pb`, `ipfs-unixfs`); no Helia, no Kubo client, no native code. Record the choice and the added install size.

Tests (offline): build CARs in the test from fixture files (with the same libraries), serve them from a local HTTPS fake gateway, and cover: a file, a directory, a path inside a directory, a tampered block, a wrong root, a missing block, an oversize CAR, a 429 then a good gateway, all gateways failing, and the proxy being used (the existing CONNECT-proxy test server).

## Acceptance criteria

- [ ] Verified fetch of files and directories by CID and path; any mismatch rejected and the next gateway tried (tested offline).
- [ ] Only through `download.ts` and the caller's proxy; main entry still reaches no download code (import-walk test green).
- [ ] Dependencies pure JS; caps enforced; the gate (including the no-skip guard) green.

## Blocked by

- None, can start immediately.

## Prompt

Goal: content addressed by CID is installed only if it IS that CID, whoever served it. Read `packages/searchcast/src/download.ts`, `install-recipes.ts`, `recipe-archive.ts`, and ADR 0002. One live check is allowed: fetch the private set's CID `bafybeid2g3nhn73nf6v6oejhqm3baicx6zkhr2w4kgp5kmnun26pk6zswy` (content is not to be copied anywhere; only record whether verification succeeded and which gateways answered) gently, a couple of requests at most.

FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

> FORWARD-NOTE (conductor, 2026-10-01): public IPFS gateways rate-limited this machine's shared IP with 429 earlier today. Make NO live network request in this build: neither the gateway survey nor the private-CID check above. The conductor runs the live check itself after the release. Pick the default gateway list from the trustless gateway spec and the gateways' own public documentation, and say in the PR and in the code comment that the list was not live-verified in this build. The private set's content must never appear in this repo, its tests, the PR or any log.

## Rules for this build

- No package version edits; no changeset unless a published package's content changes (state it in the PR if none).
- Security properties and every existing test stay unchanged in strength.
- Public repo: no real search engine named (placeholders), except the owner-approved Marginalia and Mwmbl examples.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
