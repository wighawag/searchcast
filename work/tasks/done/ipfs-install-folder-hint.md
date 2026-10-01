---
title: install-recipes ipfs:// refuses a folder that is not a set from its listing alone, and says which path to install
slug: ipfs-install-folder-hint
spec: ipfs-recipe-install
blockedBy: []
covers: [1, 2, 4]
---

## What to build

Observed on 2026-10-01 with searchcast 0.4.0 (through webveil 0.14.0): `install-recipes ipfs://<root-cid> --sha256 <hex>`, where `<root-cid>` is a release folder (an archive `x-1.0.0.tar.gz`, its `.sha256`, a `README.txt` and the set unpacked in a subdirectory `x/`, the layout a pinnace-deployed release folder has), downloaded the WHOLE folder (`dag-scope=all`: the archive and the unpacked set, about twice the set's size, from a rate-limited public gateway) and then failed with "`<cid>/x is a directory; only files are read from a directory`". The refusal is right; the cost and the message are not. Fix both:

1. **Refuse from the listing, before any file content is downloaded.** Ask first with `dag-scope=entity` (trustless gateway spec 2.2.2). For a file target that is the whole file, so one request, as today. For a directory target it is the listing only. Check the listing's verified names: if they cannot be a recipe set (an entry whose name is not a recipe file name by `recipe-archive.ts`'s rules, or no `manifest.json`), refuse now, with no further request. A `--sha256` with a directory target is likewise refused after the listing request. Only a listing that can be a set is then fetched with `dag-scope=all` (a second request, the same gateway first). Decide where the check lives (`ipfs.ts` stays generic: for example a two-phase API or a listing callback from `install-recipes.ts`) and record it.
2. **A message that says what to type.** When a directory is refused because it is not a set, the error lists its entries (capped) and suggests full commands, built from the verified listing: each `*.tar.gz` entry as an archive install (`ipfs://<cid>/<path>/<entry>`, keeping `--sha256` if one was given, since it pins an archive), and each entry that may be a set directory (a name with no recipe file extension) as `ipfs://<cid>/<path>/<entry>`. For the release-folder layout above it must name both the archive and the set directory. The nested-directory refusal in `ipfs.ts`, which can still happen for a directory whose name looks like a file, also names the path to try.
3. **A gateway that ignores `dag-scope=entity`** and answers with the whole DAG is allowed by the spec (it may return more). It must not be rejected as "unused blocks beyond the slack" just because the listing phase does not walk into the files: decide how (for example, blocks reachable from the verified root count as used, or the listing phase does not apply the slack) and record it. The slack still rejects blocks that are NOT part of the requested DAG.
4. README "Installing from IPFS": one sentence that a release folder's root is not a set, with the two paths to use instead.
5. Changeset: `searchcast` patch.

## Acceptance criteria

- [ ] Installing the release-folder layout's root fails after ONE request per gateway tried (an `entity` request), with no file content served (the fake gateway asserts what it was asked and what it sent), and the error names the full `ipfs://` commands for the archive and for the set directory (tested offline).
- [ ] A set directory still installs (entity, then all), an archive or file target is still one request, and a gateway that ignores `dag-scope=entity` still works (tested).
- [ ] Every existing IPFS and install test passes unchanged in strength; the gate (including the no-skip guard) is green.

## Blocked by

- None, can start immediately.

## Prompt

Goal: pointing install-recipes at the wrong level of a folder costs one small request and tells you the right command. Read `packages/searchcast/src/ipfs.ts`, `install-recipes.ts`, `recipe-archive.ts` and `test/ipfs-gateway.ts` (the fake gateway must learn `dag-scope=entity` vs `all`). FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- Security properties unchanged and tested: every block verified against its CID, the path resolved from the root CID through verified links (names in a suggestion come from the VERIFIED listing, never from anything else the gateway says), the caller's proxy the only egress (`download.ts`), the size caps, archive validation, checksum pins, the main entry reaching no download code (the import-walk test). No Kubo client, Helia, libp2p or native code.
- Make NO live network request (public gateways rate-limit this machine's shared IP); the conductor runs the live check.
- No package version edits; versions move only through `.changeset/*.md`, never 1.0.0.
- Public repo: no real search engine named (placeholders), except the owner-approved Marginalia and Mwmbl examples. No private recipe content anywhere.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
