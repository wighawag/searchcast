---
title: serpcast, keyless search engines over HTTP with a real browser's fingerprint, driven by shared recipes
slug: serpcast
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked.)

## Problem Statement

Getting keyless web search results today means running SearXNG. SearXNG is a Python service with its own config, rate limiter, JSON-format switch and deployment topology, and it is the single biggest setup hurdle for webveil users. What SearXNG actually contributes is small and specific: engine adapters (turn a results page into title/url/snippet), an HTTP client that looks like a real browser at the TLS/HTTP2 level (curl_cffi over libcurl-impersonate, impersonating Chrome), and per-engine handling of challenges and failures.

Search engines gate crawlers on that fingerprint. Node's own HTTP stack (undici) has a Node fingerprint, so a Node tool that parses results pages itself gets blocked where SearXNG does not. And a request whose headers describe a different browser than its TLS handshake is a bot signal of its own: measured privately, a site answered 0/8 with mismatched headers and 30/30 with a coherent header set, same IP. Stock SearXNG itself sends a Chrome TLS handshake with a Firefox User-Agent.

On top of that, the most useful engines change and occasionally need site-specific challenge handling that is code, not configuration, and some of that code should stay private (it may break a site's terms). There is no Node library that lets a user plug such engines in without forking the tool.

searchcast already solves the heavy end (a real browser driven by a JSON recipe). The missing piece is the light end: the same recipes run over plain HTTP with a browser-grade fingerprint, plus an engine chain that falls back to searchcast when HTTP is not enough.

## Solution

A pnpm monorepo, `serpcast`, with two published packages:

- **`serpcast-recipe`** (MIT, zero dependencies): the recipe schema, its TypeScript types and its validator. Shared by serpcast and searchcast, so one recipe file describes a site for both. MIT so projects under any license can share the format.
- **`serpcast`** (AGPL-3.0-only): a library plus a small CLI. It runs search engines described by recipes over HTTP through **libcurl-impersonate** (via the `impers` Node binding, the Node port of curl_cffi by the same author), pinned to one Chrome version with the exact header set Chromium sends, so every request looks like the same real browser. Engines are tried as an ordered chain with fallback to searchcast (real browser).

serpcast is deliberately **not** an anonymity tool, and it is built so an anonymity tool can safely use it (webveil does, as a backend). It follows mechanism-not-policy: the caller injects the proxy, the state store and the recipe set; serpcast never makes a network call the caller did not cause, never writes to disk on its own, and can prove impersonation is active.

Three kinds of engine, cheapest first:

1. **Declarative recipe** (JSON, the shared schema): URL template, ready/empty/blocked selectors, result fields. Run over HTTP: fetch the page, parse the HTML, apply the selectors. No JavaScript is executed.
2. **Code recipe** (a JS module): for sites that need challenge handling or a non-HTML API. It receives a context carrying the impersonated HTTP client, a session and helpers, and nothing else. Private code recipes live outside this repo.
3. **Browser engine**: a searchcast recipe, run by searchcast (as a library in-process, or over its HTTP/Unix socket). The fallback when HTTP is blocked.

## User Stories

1. As a user who does not want to run SearXNG, I want keyless web search results from a Node library, so that the only thing I install is a package.
2. As a user, I want serpcast's requests to carry the same TLS/JA3/JA4 and HTTP/2 fingerprint as SearXNG's curl_cffi Chrome impersonation, so that engines treat it the way they treat SearXNG.
3. As a user, I want the request headers (set, order and values, including `sec-ch-ua*` and `sec-fetch-*`) to describe the same Chrome version and platform as the TLS side, so that the request carries no header/TLS mismatch.
4. As a user, I want the impersonated Chrome version pinned explicitly (not a moving `chrome` alias), so that an upgrade of the native library cannot move the TLS side without the header side.
5. As a user, I want serpcast to refuse to run when libcurl-impersonate is not actually loaded (plain libcurl, wrong library, impersonation target unknown), so that I never silently search with a non-browser fingerprint.
6. As a user, I want serpcast never to download libcurl-impersonate implicitly at runtime, so that no network call happens outside my configured egress and my install is reproducible.
7. As a user, I want an explicit, opt-in command that fetches the pinned libcurl-impersonate release, verifies its checksum and stores it in a known data directory, so that installing the native library is one command without a hidden runtime download.
8. As a Nix or distro user, I want to point serpcast at my own libcurl-impersonate (for example the same build my SearXNG uses), so that I control the native library.
9. As a recipe author, I want to describe a site in the same JSON recipe format searchcast uses, so that one file works over HTTP (serpcast) and in a browser (searchcast).
10. As a recipe author, I want `serpcast query --recipe ./x.json "q"` to run one recipe once and print the results or the typed error, so that I can develop recipes quickly.
11. As a recipe author, I want a recipe that uses browser-only features (`form` input) to be rejected by the HTTP runner with a clear error, so that I know it must run through searchcast.
12. As a recipe author, I want HTTP 202/403/429 responses, a `blocked` selector match or a `blockedUrl` match (after redirects) to be reported as `blocked`, so that challenge pages are never mistaken for results.
13. As a caller, I want every failure to be a typed error (`blocked`, `recipe`, `timeout`, `transport`, `impersonation`), and an empty result list only when the recipe's `empty` selector matched, so that a broken engine is never reported as "no results".
14. As a code-recipe author, I want a module contract `{name, search(query, ctx)}` where `ctx` gives me the impersonated HTTP client (with a request-kind option: document navigation, fetch/XHR, script, each with Chromium's header set for that kind), a per-engine session (cookies and arbitrary JSON state), the abort signal and a `blocked()` helper, so that I can implement a challenge flow without touching transport or identity.
15. As a code-recipe author, I want my recipe to live anywhere on disk and be loaded by path, so that private engines never need to be in this repo.
16. As a caller, I want to pass an ordered list of engines and get the first one that returns results, with the failures of the ones tried before it, so that a query costs as few requests as possible (engines gate on request volume per exit IP, and querying every engine per search spends that budget).
17. As a caller, I want an engine that answered `blocked` to be skipped for a configurable cooldown, so that serpcast does not keep hitting an engine that is currently refusing.
18. As a caller, I want a searchcast recipe to be usable as an engine in the chain (via the searchcast library or its socket), so that a real browser is the fallback when HTTP is blocked.
19. As a caller, I want to inject a proxy URL (http, socks5, socks5h) that ALL engine traffic uses, including code recipes, so that serpcast has no egress of its own.
20. As a caller, I want to inject the state store (sessions and cooldowns), with an in-memory default and no disk writes unless I supply a store, so that I decide where state lives and how it is partitioned.
21. As a caller, I want sessions to expire after a configurable idle time and to be clearable explicitly, so that nothing outlives a burst of searching unless I want it to.
22. As a caller, I want results normalized to `{title, url, snippet?}` plus the engine that answered, so that the output drops straight into any search tool.
23. As a searchcast user, I want searchcast to validate recipes with `serpcast-recipe`, so that both tools accept exactly the same format.
24. As a maintainer, I want releases published by changesets through npm Trusted Publishing (OIDC, no token, with provenance), so that releases are reproducible and tokenless.

### Autonomy notes

- `humanOnly`: not set. The spec is agent-taskable once promoted.
- `needsAnswers`: not set. The one real unknown (whether impers can reproduce the exact header set with its own defaults off) is handled as the first task, a spike whose outcome gates the transport task; it is not a question for a human.

## Implementation Decisions

- **Monorepo shape** mirrors webveil: pnpm workspace, TypeScript (NodeNext, strict), `tsc` build, vitest, prettier (tabs, single quotes, no bracket spacing). Packages `packages/serpcast-recipe` and `packages/serpcast`. Verify gate `pnpm format:check && pnpm build && pnpm test`.
- **Licensing**: repo default AGPL-3.0-only (LICENSE at the root); `packages/serpcast-recipe` carries its own MIT LICENSE and `"license": "MIT"`. The reserved `serpcast-recipe@0.0.0` placeholder is AGPL; the first real release is MIT.
- **Recipe schema ownership**: `serpcast-recipe` owns the schema, types, `RecipeError` and the validator (file and directory loading may stay in each consumer or live here as a node-only helper; the validator itself stays dependency-free). It starts as an extraction of searchcast's current `recipe.ts`, unchanged in meaning, so existing searchcast recipes stay valid. HTTP-only extensions (if any are later needed) are optional fields that searchcast ignores or rejects explicitly.
- **Transport**: `impers` (npm, MIT, koffi FFI to libcurl-impersonate). One pinned impersonation target (start at `chrome146`, the version the private prior art pins) and header tables per request kind (document navigation, same-origin navigation with referer, fetch/XHR, script) for that exact Chrome version on Linux. The library's default headers are turned off so only our table is sent. Proxy passed through as a URL. The library path is resolved explicitly (config, then `LIBCURL_PATH`, then the data dir the install command writes to) and set before `impers` loads, so its auto-download never runs; if none is found, fail with an actionable error.
- **Impersonation check**: on first use, verify the loaded library is libcurl-impersonate and accepts the pinned target (for example via the curl version string and a target-setting call). A `strict` option (default on) makes any failure an `impersonation` error. An optional `serpcast doctor` hits a fingerprint echo service to show JA3/JA4/HTTP2 values, never automatically.
- **HTML parsing** for declarative recipes uses a small HTML parser plus a CSS selector engine over its tree (for example `parse5` or `rehype-parse` with `hast-util-select`, whichever is smaller and supports the selectors real recipes use). `href`/`src` fields resolve to absolute URLs against the final URL, matching searchcast.
- **Engine chain**: ordered, sequential; stop at the first engine that returns results (or a matched `empty`); collect `{engine, error}` for each engine tried before it. Cooldown after `blocked`, default a few minutes, configurable, stored in the injected store.
- **State store interface**: a small async key/value interface (`get`, `set`, `delete`, with per-key expiry) that serpcast namespaces by engine. Default in-memory. serpcast ships no file store; webveil provides its own.
- **Code recipe contract**: ESM module with a default export `{name, search(query, ctx)}` returning results or throwing a serpcast error. Loaded only by explicit path from the caller; serpcast never scans for recipes on its own.
- **searchcast integration**: an engine kind that delegates to a searchcast recipe, either through the `searchcast` library (optional peer dependency, proxy passed through) or through a searchcast HTTP/Unix-socket endpoint. searchcast's `blocked`/`recipe`/`timeout` map to serpcast's errors.
- **Public API sketch** (decision-level, not final): `createSerpcast({libcurlPath?, impersonate?, strict?, proxy?, store?, sessionIdleMs?, cooldownMs?, searchcast?})` returning `{search(query, {engines, maxResults?, signal?}), close()}`; `loadRecipe(path)`; `loadCodeRecipe(path)`.
- **Release**: changesets + GitHub Actions `release.yml` copied from searchcast's (npm Trusted Publishing via OIDC, `id-token: write`, Node 24, provenance, no `NPM_TOKEN`). Both names are reserved at `0.0.0`, so trusted publishers can be registered for `wighawag/serpcast` + `release.yml` on each package before the first real release.
- **Size discipline**: track per-module LOC in the README as webveil does; the core (transport, runner, chain, loader) should stay well under 1k LOC.

## Testing Decisions

- The first task is a **fingerprint spike**: with `impers` loading libcurl-impersonate 2.1.1 and the pinned target, record the JA3/JA4, HTTP/2 (Akamai) fingerprint and the header order seen by a fingerprint echo service, and compare with curl_cffi using the same target and header table. Also confirm that impers can send ONLY our headers (defaults off) and that its auto-download can be fully prevented. The spike's recorded result is a finding in `work/notes/findings/`; if impers cannot match, the transport task is re-scoped (fallback candidate: a direct koffi binding to libcurl-impersonate).
- Declarative runner tests run against local HTML fixtures served by a local test server (no live engines in CI): ready, empty, blocked selector, blockedUrl after redirect, 429 as blocked, missing title/url skipped, relative URLs resolved, `form` rejected.
- Transport tests assert the exact outgoing header set per request kind against a local server (header names, order, values).
- Chain tests use fake engines: first-success wins, failures collected, cooldown skip and expiry, empty is a success.
- `serpcast-recipe` tests: every searchcast recipe fixture validates unchanged; invalid recipes fail with the same messages searchcast gives today.
- Live checks against real engines are manual (`serpcast query`), never part of `verify`.

## Out of Scope

- Anonymity policy (which proxy, per-identity state partitioning, trust policy for code recipes): that is the caller's job (webveil).
- Recipes for specific engines that may break a site's terms. The repo may ship example recipes only for engines that offer keyless access openly.
- JSON-API results in declarative recipes (use a code recipe in v1).
- Running the searchcast browser itself; serpcast delegates to searchcast.
- Result merging/ranking across multiple engines (the chain stops at the first answer).
- A decoy-results relevance guard (a well-formed page of results unrelated to the query). Worth doing later as an optional post-filter; capture as an idea.
- An HTTP server mode. serpcast is a library and a recipe-development CLI.

## Further Notes

- **Cross-repo change in searchcast** (no `work/` there yet, so it is recorded here): replace searchcast's in-file recipe schema and validator with a dependency on `serpcast-recipe`. searchcast is already `AGPL-3.0-only` in every published version, so no relicensing is needed. searchcast's README should link to serpcast as the HTTP runner for the same recipes.
- **Consumer**: webveil will add a `serpcast` backend; see webveil's spec `serpcast-backend`, which depends on serpcast's first release.
- **Human setup before the first release**: register the npm trusted publisher (repo `wighawag/serpcast`, workflow `release.yml`) on both `serpcast` and `serpcast-recipe`, and create the GitHub repo.
