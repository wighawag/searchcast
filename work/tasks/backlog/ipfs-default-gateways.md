---
title: Sturdier default IPFS gateways (independent operators), and the all-failed error says how to choose your own
slug: ipfs-default-gateways
spec: ipfs-recipe-install
blockedBy: []
covers: [4, 5]
---

## What to build

`DEFAULT_IPFS_GATEWAYS` (`packages/searchcast/src/ipfs.ts`) is `https://trustless-gateway.link` then `https://4everland.io`. On 2026-10-23 both failed for a CID that was pinned and reachable on the network (another public gateway served it): `trustless-gateway.link` answered 522, then 526 (Cloudflare origin errors), and `4everland.io` answered a body that is not a CAR. So `install-recipes ipfs://` failed with every default.

A conductor survey the same day (one `?format=car&dag-scope=entity` request each, `accept: application/vnd.ipld.car`, the root of a small UnixFS folder):

- `https://w3s.link` redirects (301) to `https://dweb.link`, which redirects (301) to `https://trustless-gateway.link`: one operator's backend (as is `ipfs.io`), down that day.
- `https://gateway.pinata.cloud`: 200, `application/vnd.ipld.car; version=1; order=dfs; dups=n`, 403 bytes (honoured `dag-scope=entity`).
- `https://ipfs.filebase.io`: 200, the same content type, 484 KB (IGNORED `dag-scope=entity` and sent the whole DAG; searchcast accepts that since `ipfs-install-folder-hint`).

Build:

1. **Defaults:** at least three gateways on independent operators, in a sensible order. Candidates: `https://trustless-gateway.link`, `https://gateway.pinata.cloud`, `https://ipfs.filebase.io`, `https://4everland.io`. Check each candidate's own public documentation for its terms on public trustless (CAR) use and rate limits (no live requests; use the survey above), drop any whose terms forbid this use, and record the list, the order and why, with the survey date, in the Decisions comment and the README. Do not add a gateway that only redirects to another one on the list.
2. **Redirects:** confirm (and test offline) what happens when a gateway answers a 301/302 to another https gateway: it must stay within `download.ts`'s rules (no https to http, the caller's proxy only, the size cap), and the block verification is unchanged whoever serves it. Record whether the redirect target is reported as the serving gateway in `.source.json`.
3. **The all-failed error:** after listing each gateway's reason, add one sentence on how to choose others: `--ipfs-gateway <url>` (repeatable; `ipfsGateways` in the API), for example your own node's gateway at `http://127.0.0.1:8080`. Keep it generic (no gateway names in that sentence).
4. **README "Installing from IPFS":** the new defaults; one paragraph on running your own node as a gateway (Kubo's gateway on loopback), and why searchcast does not embed an IPFS node (a peer-to-peer node's traffic would not go through the caller's proxy, so it would bypass an embedder's egress); the gateways see only what you ask for and are trusted for nothing.
5. Changeset: `searchcast` patch.

## Acceptance criteria

- [ ] At least three default gateways on independent operators, chosen from the survey and their documented terms, recorded with reasons (tested: the list is https only and has no duplicate operator).
- [ ] A redirect between https gateways stays within `download.ts`'s rules and verification (tested offline); the all-failed error names `--ipfs-gateway` (tested); README updated; the gate (including the no-skip guard) is green.

## Blocked by

- None, can start immediately.

## Prompt

Goal: an `ipfs://` install does not fail because one gateway operator is having a bad day. Read `packages/searchcast/src/ipfs.ts`, `download.ts` and `test/ipfs.test.ts`. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- Security properties unchanged and tested: every block verified against its CID, path resolution through verified links, the caller's proxy the only egress (`download.ts`), size caps, archive validation, checksum pins, the main entry reaching no download code (the import-walk test). No Kubo client, Helia, libp2p or native code.
- Make NO live network request (the survey above is the live data; the conductor runs the live check).
- No package version edits; versions move only through `.changeset/*.md`, never 1.0.0.
- Public repo: no real search engine named (placeholders), except the owner-approved Marginalia and Mwmbl examples. Naming IPFS gateway operators is fine. No private recipe content anywhere.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
