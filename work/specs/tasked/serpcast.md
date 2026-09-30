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
13. As a caller, I want every failure to be a typed error (`blocked`, `recipe`, `timeout`, `transport`, `impersonation`, and `exhausted` when every engine failed), and an empty result list only when the recipe's `empty` selector matched, so that a broken engine is never reported as "no results".
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

## Out of Scope

- Anonymity policy (which proxy, per-identity state partitioning, trust policy for code recipes): that is the caller's job (webveil).
- Recipes for specific engines that may break a site's terms. The repo may ship example recipes only for engines that offer keyless access openly.
- JSON-API results in declarative recipes (use a code recipe in v1).
- Running the searchcast browser itself; serpcast delegates to searchcast.
- Result merging/ranking across multiple engines (the chain stops at the first answer).
- A decoy-results relevance guard (a well-formed page of results unrelated to the query). Worth doing later as an optional post-filter; captured as idea `decoy-results-relevance-guard`.
- An HTTP server mode. serpcast is a library and a recipe-development CLI.

## Further Notes

Tasked 2026-09-28. Implementation and testing detail moved to `work/tasks/` (serpcast repo) and, for story 23, to `use-serpcast-recipe` in the searchcast repo; durable rationale moved to `docs/adr/0001`..`0003`. Consumer: webveil spec `serpcast-backend`.
