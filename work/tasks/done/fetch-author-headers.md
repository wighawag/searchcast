---
title: Code recipes can add their own headers to a fetch request, placed and preflighted as Chrome does (measured first)
slug: fetch-author-headers
blockedBy: [example-mwmbl-recipe]
covers: []
needsAnswers: false
---

## What to build

Today a request carries only the pinned Chrome header table for its kind, so an API that wants a header (for example `API-Key: <key>`) cannot be called. A page's script can do exactly that with `fetch(url, {headers: {...}})`, so a code recipe may too, for `kind: 'fetch'` requests only (GET and POST), keeping the request indistinguishable from what Chrome sends for such a script:

- **Measure first**, the way `work/notes/findings/post-requests.md` did: a net-log of a local Chromium (the nixpkgs one used there, or current) against LOCAL servers only, for `fetch()` GET and POST with one and with two author headers (mixed case names), same-origin, same-site and cross-site. Record in a new finding (`work/notes/findings/fetch-author-headers.md`): where Chrome places author headers in its header order, how it spells their names on HTTP/2 (lowercased), whether a non-safelisted author header triggers the CORS preflight for a cross-origin GET as it does for a POST, and the preflight's `access-control-request-headers` (lowercased, sorted, comma-joined). No internet traffic in the measurement.
- **Implement what was measured**: `ctx.http.get/text/json/post(url, {kind: 'fetch', headers: {...}})`. Author headers sit where Chrome puts them; a request that Chrome would preflight is preflighted (the existing preflight machinery and cache, extended to request headers: the cache key includes the header names, and a preflight answer that does not allow them means the request is not sent, a `blocked`... or the kind the existing POST preflight uses; follow that). Names that a page's script cannot set (the Fetch standard's forbidden request headers, every `sec-*` and `proxy-*`, and names the table already carries, such as `user-agent`, `accept`, `accept-language`, `referer`, `origin`, `cookie`) are refused with a `recipe` error naming the header; so is `headers` on a `document` or `script` request. Values must be valid header values (no CR/LF).
- `createTransport`'s `RequestOptions` gets the same option (the code-recipe context is built on it); declarative recipes do not (they describe pages, not scripts).
- The Marginalia example (`examples/recipes/marginalia.mjs`) uses it: when `MARGINALIA_API_KEY` is set, it calls the current API (`https://api2.marginalia-search.com/search?query=...&count=...`) as a `fetch` with `API-Key`; otherwise the keyless old API as today. Its README section says so. (The owner does not want a keyed engine as webveil's default; this only makes the example usable with a key.)
- README: a "Headers a code recipe adds" subsection (what is allowed, the placement, the preflight). CONTEXT.md: **Author header**.
- Changeset: `searchcast` minor.

> RETRY HANDOFF (conductor, 2026-09-30, after the first attempt STOPPED correctly): the measurement (kept on branch `work/task-fetch-author-headers`, note `work/notes/observations/2026-09-30-author-header-order-is-hash-order.md`) showed Chrome orders author headers by Blink's `HTTPHeaderMap` hash iteration over the whole name set, so there is no fixed slot, and larger sets even move `user-agent`. Re-scope, decided by the conductor under the "strict impersonation must survive" rule (option (b) of the stop note): support ONLY a measured allowlist of author-header NAME SETS, each with its measured wire order per request kind and method; start with the single-header sets `{api-key}` and `{authorization}` (both measured: after `sec-ch-ua-platform`, before `user-agent`, for a same-origin GET; measure and add the POST and cross-origin placements the same way, local servers only). Any other set (including two headers together) is refused with a `recipe` error that names the supported sets and says why (Chrome's order for it is not modelled). Keep every other measured rule from that note (lowercase names, the preflight for a cross-origin GET and POST, `access-control-request-headers` sorted and comma-joined without spaces, refusal when not allowed, the preflight cache covering header names, `accept-language`/`priority` and forbidden names). Turn the note into the finding `work/notes/findings/fetch-author-headers.md` with the method, versions and the hash-order explanation, so a later task can extend the allowlist by measuring. Build on that branch. Depends on `example-mwmbl-recipe` only so the two README edits do not collide.

## Acceptance criteria

- [ ] The finding records the measured placement and preflight rules, with the method and versions, from local servers only.
- [ ] Transport tests (native, against the local H2 servers) assert the measured order and spelling, and the preflight with `access-control-request-headers`, including a refusal when the preflight does not allow the header.
- [ ] Forbidden names and `headers` on non-fetch kinds are refused (tested).
- [ ] The Marginalia example uses the new API with a key and the old one without (tested against local fakes).
- [ ] No test contacts the internet; CI no-skip guard green.

## Blocked by

- example-mwmbl-recipe (README edits only)

## Prompt

Goal: the header table stays Chrome's; a code recipe gets exactly the power a page's script has, no more. Read `work/notes/findings/post-requests.md` and `sec-fetch-site-by-initiator.md`, `packages/searchcast/src/chrome.ts` (header tables, preflight table), `transport.ts`, `post.ts`, `code.ts`. If the measurement contradicts this task (for example Chrome reorders in a way the table model cannot express), stop and route to needs-attention with the finding.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- ADRs 0001 to 0005 hold.
- Do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia example under `examples/` is the one owner-approved exception (Mwmbl joins it in `example-mwmbl-recipe`).
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
