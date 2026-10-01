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

## Decisions

These are recorded in the "Decisions (task install-recipes-from-ipfs, 2026-10-01)" block in the header comment of `packages/searchcast/src/install-recipes.ts`:
1. **A set directory must hold `manifest.json`**, even when `--name` is given (archives don't need one). This stops a folder of random JSON being taken for a set.
2. **`--sha256` with an IPFS directory is refused**, not ignored. There are no archive bytes to compare it with, so ignoring it would let the user think it was checked.
3. **Gateways with a non-IPFS source are refused**, in the CLI and the API, matching the existing rule for `--proxy` with a file. This affects embedders: they must pass gateways only for `ipfs://` sources.
4. **The caps are the existing ones:** the download is held to `maxArchiveBytes` and the rebuilt content to `maxUnpackedBytes`. No new setting.
5. **`.source.json` records the root CID as given** (the path is in `source`). Its `sha256` field is now optional, which changes the public `RecipeSetSource` type.
6. **`DEFAULT_IPFS_GATEWAYS` is now exported from `searchcast/install`**, so an embedder can put its own gateway in front. `fetchIpfs` itself stays internal; its note in `ipfs.ts` is updated.
