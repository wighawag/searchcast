---
title: A second example code recipe, Mwmbl's keyless public API
slug: example-mwmbl-recipe
blockedBy: []
covers: []
---

## What to build

Add `examples/recipes/mwmbl.mjs`, a code recipe for Mwmbl (https://mwmbl.org, a non-profit, open-source (AGPL-3.0) independent search engine), beside the Marginalia example and in the same style. Owner decision 2026-09-30: Mwmbl joins Marginalia as the owner-approved engines that public examples and webveil's default may name, because its API is public and keyless by design.

Facts, read 2026-09-30 from https://developer.mwmbl.org/ and checked with one request: `GET https://api.mwmbl.org/api/v2/search/?q=<query>` answers JSON `{query, number_of_results, results: [{url, title, title_highlights, content, content_highlights, engine, score}]}`. Anonymous tier: 1,000 requests a month per IP, 1 request per second, no key; an optional personal key goes in the `api_key` QUERY parameter (not a header). Over-quota answers are HTTP 429. Terms (https://mwmbl.org/terms): no scraping or excessive automated queries; data under CC BY-NC-SA 4.0.

- The recipe calls the API with `ctx.http.json(url, {kind: 'document'})` like the Marginalia example (a program calling a documented API, no page); maps `title`, `url`, `content` (as `snippet`); cuts to `ctx.maxResults`; sends `api_key` only when `MWMBL_API_KEY` is set; maps 429 (and 503) to `blocked`; a response without a `results` array is `ctx.recipeError(...)`; the query is URL-encoded.
- Tests against a local fake (no network), mirroring `marginalia-example.test.ts`.
- README: the Mwmbl example next to Marginalia (what it is, the anonymous quota per IP, which is shared by everyone on a Tor exit or VPN, the optional key, the terms and data licence, and that it is an example, not a bundled engine).
- Changeset: none if `examples/` is not in any package (it is not published); otherwise decide and record.

## Acceptance criteria

- [ ] Recipe behaviour as above, tested against a local fake (mapping, key only when set, 429/503 blocked, missing results a recipe error, encoding).
- [ ] README documents it with terms, quota and licence; no other engine named.

## Blocked by

- None, can start immediately (it needs no author header; `fetch-author-headers` was re-scoped and runs after it).

## Prompt

Goal: a keyless, terms-compliant engine for webveil's out-of-the-box default. Keep it tiny and honest about its limits. One live request is allowed if you want to confirm the response shape; record it.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- ADRs 0001 to 0005 hold.
- Do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia and Mwmbl examples under `examples/` are the owner-approved exceptions.
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
