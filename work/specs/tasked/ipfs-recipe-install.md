---
title: install-recipes from IPFS, verified against the CID, through the caller's egress
slug: ipfs-recipe-install
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` and the code. Tasked on 2026-10-01 into `ipfs-verified-fetch` then `install-recipes-from-ipfs`.

## Problem Statement

Recipe sets are published to IPFS (the private set's release workflow pins it with pinnace), but `searchcast install-recipes` only takes an https URL or a file plus a `--sha256`. Installing from IPFS means trusting one public gateway's URL, and the public gateways rate-limit (429 from one machine on 2026-10-01). A Kubo client is not the answer: it needs a running daemon, its libp2p traffic bypasses the caller's proxy (webveil's egress), and it trusts the daemon's answer.

## Solution

`searchcast install-recipes ipfs://<cid>[/<path>]`: the content is fetched over HTTPS from trustless gateways (the IPFS "trustless gateway" CAR responses, `application/vnd.ipld.car`), through the caller's proxy exactly like every other searchcast download, and every block is verified against the CID locally before anything is unpacked. The CID is the pin, so `--sha256` is optional for IPFS sources. Gateways are tried in order until one answers with valid content. Pure-JS dependencies only (IPFS project libraries for CAR, dag-pb, UnixFS, CIDs); no daemon, no p2p traffic, no new native code. Installs from a set directory (`manifest.json` plus recipes) as well as from a release archive inside the DAG.

## User Stories

1. As a user, I want `searchcast install-recipes ipfs://<cid>/<archive>.tar.gz` to install a set with no `--sha256`, because the CID already pins the bytes.
2. As a user, I want `ipfs://<cid>/<set-dir>` (a directory holding `manifest.json` and recipes) to install the set directly.
3. As a privacy-minded user, I want the fetch to go through my proxy, never through a local daemon or p2p connections.
4. As a user, I want a gateway that returns wrong bytes to be rejected and the next gateway tried, and a rate-limited one skipped.
5. As a user, I want to choose the gateways (my own path gateway, a local Kubo at `http://127.0.0.1:8080`, or public ones) and have sensible defaults.
6. As an embedder (webveil), I want the same through `searchcast/install`, with my proxy.

## Out of Scope

- Pinning or publishing (pinnace does that). IPNS and DNSLink names (only CIDs).
