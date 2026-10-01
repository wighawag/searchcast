---
title: searchcast install-recipes accepts ipfs://<cid>[/path] (archive or set directory), --sha256 optional for IPFS
slug: install-recipes-from-ipfs
spec: ipfs-recipe-install
blockedBy: [ipfs-verified-fetch]
covers: [1, 2, 4, 5, 6]
---

## What to build

Wire the verified fetch (`ipfs-verified-fetch`) into `install-recipes` (CLI and `searchcast/install`'s `installRecipes`):

- `ipfs://<cid>[/<path>]` is a new source kind (today any `scheme://` other than http(s) is refused). If it resolves to a file, it is a release archive and goes through the existing archive checks; if to a directory, it must hold `manifest.json` and recipe files only, checked with the same rules as an archive's contents (`recipe-archive.ts`), then installed the same way (temporary directory, rename into place, `--force` to replace, identical set left `unchanged`).
- `--sha256` is optional for IPFS sources (the CID pins the content); if given for an archive it must also match. Still required for http(s) URLs and files.
- `--ipfs-gateway <url>` (repeatable) and the `ipfsGateways` option override the defaults; `--proxy` applies as for URLs.
- `.source.json` records `{source: "ipfs://...", cid, gateway}`; `recipes list` shows the `ipfs://` source.
- README: "Installing from IPFS" (what is verified, the gateways, choosing your own or a local Kubo, the proxy), and the release archive section mentions it. CONTEXT.md: **Trustless gateway**.
- Changeset: `searchcast` minor.

## Acceptance criteria

- [ ] Archive and directory installs from `ipfs://` work against the offline fake gateway, with and without `--sha256`; a wrong `--sha256` fails (tested).
- [ ] `.source.json` and `recipes list` show the IPFS source; README and CONTEXT updated; the gate is green.

## Blocked by

- ipfs-verified-fetch

## Prompt

Goal: `searchcast install-recipes ipfs://<cid>/<set>` is the whole install, safely. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- No package version edits; no changeset unless a published package's content changes (state it in the PR if none).
- Security properties and every existing test stay unchanged in strength.
- Public repo: no real search engine named (placeholders), except the owner-approved Marginalia and Mwmbl examples.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
