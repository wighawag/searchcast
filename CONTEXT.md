# searchcast

searchcast runs keyless search engines, described by recipes, over HTTP with a real browser's fingerprint, and chains them with a real-browser fallback (the browser runner, `@searchcast/browser`). It supplies the mechanism; the caller supplies every policy (egress, state, which recipes), see `docs/adr/0002`. It was called serpcast until 0.2.0 (renames and their one-release fallbacks: `docs/adr/0005`).

## Language

### Recipes and engines

**Recipe**:
A description of how to get search results from one site. Either a declarative recipe or a code recipe.
_Avoid_: adapter, scraper, plugin

**Declarative recipe**:
A JSON recipe in the shared `@searchcast/recipe` schema (URL template, ready/empty/blocked selectors, result fields). The same file runs over HTTP in searchcast and in a real browser in the browser runner.
_Avoid_: JSON engine, config

**Code recipe**:
A JS module with a `{name, search(query, ctx)}` default export, loaded only from a path the caller gives, for sites that need challenge handling or a non-HTML API. It is code with full Node access, so loading one is a trust decision of the caller.
_Avoid_: custom engine, script recipe

**Engine**:
One entry in an engine chain: a declarative recipe, a code recipe or a browser engine, identified by its name.
_Avoid_: backend, provider

**Browser engine**:
A recipe run in a real browser by the browser runner (`@searchcast/browser` in-process, or a `searchcast serve` over its socket). The fallback when HTTP is blocked.
_Avoid_: headless engine

**Browser runner**:
`@searchcast/browser`, the library that runs a recipe in a real browser (published as the `searchcast` package 0.1.x before ADR 0005); `searchcast serve` is its command line.
_Avoid_: searchcast (that is the HTTP package), headless runner

**Engine chain**:
The ordered list of engines one search tries, stopping at the first answer (results, or an `empty` match); earlier failures are reported with it.
_Avoid_: fan-out, metasearch

### Transport and fingerprint

**Transport**:
The HTTP client every engine request goes through: libcurl-impersonate (through a direct koffi binding; `impers` was measured and not used, see the finding `impers-fingerprint-vs-curl-cffi`) sending the pinned impersonation target with our header table, through the caller's proxy.
_Avoid_: fetcher, HTTP backend

**Impersonation target**:
The one explicit Chrome version libcurl-impersonate reproduces at the TLS/HTTP2 level (for example `chrome146`), never the moving `chrome` alias. It and the header tables change together.
_Avoid_: profile, browser alias

**Header table**:
The exact request headers (names, values, order) that the pinned Chrome sends for one request kind. The only headers searchcast sends; the library's own defaults are off.
_Avoid_: default headers, user agent

**Request kind**:
What a request is, from the browser's point of view, which selects its header table: document navigation, same-origin navigation, fetch/XHR, or script. Only a fetch may be a POST.
_Avoid_: request type, mode

**Preflight**:
The CORS `OPTIONS` request Chrome sends before a fetch POST to another origin whose `content-type` is not CORS-safelisted (such as `application/json`). searchcast sends it too, as captured: credential-less, on the transport session's credential-less connections, remembered for its `access-control-max-age` (capped by `maxPreflightAgeS`; not at all with `preflightCache: false`). If it does not allow the POST, the POST is not sent.
_Avoid_: OPTIONS check, CORS probe

**Fetch site**:
How a `fetch` or `script` request relates to the page it comes from (its referer): `same-origin`, `same-site` (same scheme and registrable domain, any port) or `cross-site`, Chrome's `sec-fetch-site`. Derived from the URLs by a small built-in site rule (no public suffix list), overridable per request with `fetchSite`; it also decides the referer (the page's origin only, when not same-origin), `origin` and `sec-fetch-storage-access`.
_Avoid_: request site, origin type

**Strict mode**:
The default check that refuses to send any request unless libcurl-impersonate is loaded and accepts the impersonation target.
_Avoid_: safe mode

### State

**State store**:
The caller-injected async key/value store with per-key expiry that holds sessions and cooldowns, namespaced per engine. The default is in-memory; searchcast ships no disk store. Its index key `serpcast/sessions` keeps serpcast's name on purpose (ADR 0005).
_Avoid_: cache, database

**Session**:
One engine's cookies and arbitrary JSON state, kept in the state store and dropped after an idle time or when cleared explicitly. A code recipe reaches the cookies as a page's script would (`ctx.cookies`, `document.cookie` semantics: it can set, read and delete the non-`HttpOnly` ones) and the state through `ctx.session`.
_Avoid_: cookie jar, identity

**Transport session**:
The cookies and open connections that one engine's requests share. Cookies are stored and sent by the transport itself (never libcurl's cookie engine) so the `cookie` header sits where Chrome puts it; they are the cookie half of a Session, exported as plain JSON so the state store can keep it. Its `documentCookies` are the same cookies as a page's `document.cookie` sees them (what a code recipe's `ctx.cookies` uses). Connections are kept open between its requests (as Chrome does; `reuseConnections: false` opens one per request instead) and never shared with another transport session; they live only in memory, closed with `close()` or when the engine chain drops the Session. Preflights go on a second, credential-less set of connections of the same transport session, as Chrome keeps credential-less requests apart.
_Avoid_: cookie jar, client

**Cooldown**:
The period during which an engine that answered `blocked` is skipped by the engine chain.
_Avoid_: backoff, ban

**Data directory**:
`$XDG_DATA_HOME/searchcast` (default `~/.local/share/searchcast`): where `searchcast install-libcurl` puts the library and `searchcast install-recipes` puts recipe sets, only when the user types those commands (or an embedder calls the installers of `searchcast/install`). Nothing else writes there.
_Avoid_: cache, config dir

**Old data directory**:
serpcast's data directory, `$XDG_DATA_HOME/serpcast`, read for one release (0.2.x) when the data directory lacks an item (the library file, a recipe set by name). Never written, never moved: `searchcast doctor` names what is read from it and prints the `mv` command the user can run.
_Avoid_: legacy directory, migration

### Errors

Every failure is a `SearchcastError` (serpcast's name `SerpcastError` is a deprecated alias for one release) with a `kind`. An empty result list is never an error and only comes from a recipe's `empty` selector.

**`blocked`**:
The site refused or challenged the request (HTTP 202/403/429, a `blocked` selector match, or a `blockedUrl` match after redirects). Starts a cooldown.

**`recipe`**:
The recipe does not fit the site or the runner (the page matches none of its selectors, no usable result item, a wrong URL template, a browser-only feature over HTTP, malformed code-recipe output).

**`timeout`**:
The request or search did not finish within its time limit.

**`transport`**:
The network or the server failed (connection error, unexpected status such as 5xx).

**`decoy`**:
A guarded engine (named in the caller's `decoyGuard`, or its recipe declares `decoyProne: true`, and not in `decoyGuard.exclude`) answered with a well-formed page of results unrelated to the query (the `isDecoy` rule). Recorded like any engine failure; starts NO cooldown, since a decoy is per query, not per engine.

**`impersonation`**:
The browser fingerprint cannot be guaranteed (libcurl-impersonate missing, plain libcurl, unknown target). It aborts the whole search rather than falling through to later engines.

**`exhausted`**:
Every engine in the chain failed; carries the failure of each engine tried.
