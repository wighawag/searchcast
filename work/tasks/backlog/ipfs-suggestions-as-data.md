---
title: The not-a-set refusal carries its suggested ipfs:// sources as data, so an embedder can print its own command
slug: ipfs-suggestions-as-data
spec: ipfs-recipe-install
blockedBy: []
covers: [6]
---

## What to build

Since `ipfs-install-folder-hint` (searchcast 0.4.1), `installRecipes` refuses an IPFS directory that cannot be a recipe set with an `InstallError` whose MESSAGE suggests `searchcast install-recipes ipfs://<cid>/<path>/<entry>` commands. An embedder (webveil) passes that message through, so a webveil user is told to run `searchcast install-recipes ...` directly, which would skip webveil's egress (the request then goes out direct, not through the user's Tor or proxy). The embedder needs the suggestions as data to print its own command.

- `InstallError` gains an optional, readonly `suggestions?: readonly InstallSuggestion[]`, where `InstallSuggestion` is `{source: string; kind: 'archive' | 'set-directory'; sha256?: string}`: `source` the full `ipfs://` URL (built with `ipfsUrl`, from the VERIFIED listing only), `kind` what it may be, `sha256` the `--sha256` the user gave, on archive suggestions only (as the message does today). Set it on the not-a-set refusal (the same entries, same order and same cap as the message's "Try:" list). No other error sets it.
- The CLI message is unchanged (same text, tested as today).
- Export the `InstallSuggestion` type from `searchcast/install` (and `InstallError` is already exported there); document the field in README's API table and in the "Installing from IPFS" section in one sentence ("an embedder can read `error.suggestions` to print its own command").
- Changeset: `searchcast` patch.

## Acceptance criteria

- [ ] The release-folder refusal's `InstallError` has `suggestions` equal to the archive (with the given `sha256`) then the set directory, as full `ipfs://` URLs; other refusals have none (tested offline).
- [ ] The CLI message is byte-for-byte unchanged (existing test still passes); the gate (including the no-skip guard) is green.

## Blocked by

- None, can start immediately.

## Prompt

Goal: an embedder never has to parse searchcast's prose to tell its user what to type. Read `packages/searchcast/src/install-recipes.ts` (`checkSetListing`), `install.ts` (`InstallError`), `install-api.ts`. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- Security properties unchanged and tested: every block verified against its CID, path resolution through verified links, suggestions built only from the verified listing, the caller's proxy the only egress, size caps, archive validation, checksum pins, the main entry reaching no download code (the import-walk test). No Kubo client, Helia, libp2p or native code.
- Make NO live network request.
- No package version edits; versions move only through `.changeset/*.md`, never 1.0.0.
- Public repo: no real search engine named (placeholders), except the owner-approved Marginalia and Mwmbl examples. No private recipe content anywhere.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
