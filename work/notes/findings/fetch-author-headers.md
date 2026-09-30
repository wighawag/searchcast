---
title: Chromium's author headers on a page's fetch() (placement, spelling, preflight)
slug: fetch-author-headers
source: 'captured 2026-09-30 in two runs (the first for the task attempt that stopped on the hash order, the second, UTC ~21:25, for the allowlist) with nixpkgs Chromium 152.0.7977.82 (/nix/store/33pxss8h71cl7vmfpy21bidsw0lj1g8q-chromium-152.0.7977.82, Linux x64, headless=new, fresh profile per run) against LOCAL servers only: one Node 24.19.0 HTTP/2 TLS server on 127.0.0.1 answering every host name, all mapped there with --host-resolver-rules="MAP * 127.0.0.1", a self-signed certificate for *.example.com and *.example.net plus --ignore-certificate-errors. No third-party site was contacted. Single host, single day, one Chromium version: re-measure when the pinned Chrome moves, and measure again before adding a name set.'
---

# Chromium's author headers on a page's fetch() (placement, spelling, preflight)

An author header is one a page's script adds to its own request: `fetch(url, {headers: {'API-Key': key}})`. The finding `post-requests` listed "POSTs with other author headers" as not measured, and the header tables had no place for them. This measures where Chrome puts them, how it spells them on HTTP/2, and the CORS preflight they cause, for GET and POST, same-origin, same-site (a sibling subdomain) and cross-site.

## Verdict

1. **There is no fixed slot: Chrome orders author headers by a hash over the whole name set.** The same name set always gave the same order (two runs, any insertion order, any name case), but different sets land in different places, and a larger set also moves `user-agent` and the client hints (below). This fits Blink's `HTTPHeaderMap`, a WTF hash map, being iterated over the author headers together with `user-agent`, `sec-ch-ua*` and `content-type`: the existing tables' fixed prefix (`sec-ch-ua-platform, user-agent, sec-ch-ua, [content-type,] sec-ch-ua-mobile`) is one instance of that hash order. Reproducing it in general means reimplementing WTF's string hash and hash-table layout (table sizes, probing, rehash). searchcast therefore supports only MEASURED name sets, each with its measured wire order, and refuses the rest.
2. **The two measured single-header sets, `{api-key}` and `{authorization}`, land right after `sec-ch-ua-platform`, before `user-agent`**, in every case measured: GET, and POST with a JSON, form, `text/plain` (string), bytes or empty body; same-origin, same-site and cross-site; `credentials: 'include'` and the default mode. Nothing else in the table changes.
3. **Names are lowercased on HTTP/2** (`API-Key` is sent as `api-key`); two names that differ only in case are combined as `x-dup: a, b`.
4. **A non-safelisted author header preflights a request to another origin, GET as well as POST**, same-site included, in either credentials mode; a same-origin request is never preflighted. The preflight is the one `post-requests` recorded (same header list, credential-less, on its own connection when the request is credentialed), with `access-control-request-method` the request's method and `access-control-request-headers` the non-safelisted names, lowercased, sorted and comma-joined WITHOUT a space: `api-key,content-type` for a JSON POST; a form, `text/plain`, bytes or empty POST asks for `api-key` alone.
5. **A preflight answer whose `access-control-allow-headers` lacks a requested name means the request is not sent** (`TypeError: Failed to fetch`). The names are compared case-insensitively (`API-KEY` allows `api-key`); `*` does NOT allow `api-key` for a credentialed request.
6. **The preflight cache is per page origin and URL and holds the header names of the LAST answer.** A later request whose names are all among them is not preflighted (default 5 s, or `access-control-max-age`); a request with another name is preflighted, and its answer REPLACES the entry: after answers allowing `api-key`, then `content-type` (a JSON POST), then `authorization`, a GET with `api-key` was preflighted again. An answer allowing more than was asked (`api-key, content-type` for a GET asking `api-key`) covers a later JSON POST with `api-key` without a preflight.
7. **What a page's script cannot set, or sets differently.** `user-agent`, `cookie`, `referer`, every `sec-*` name, and `x-http-method-override: TRACE` were silently dropped. `accept-language` and `priority` CAN be set and replace the table's values, but a set `accept-language` moved (it was sent after `sec-ch-ua-platform`, ahead of its table place). A safelisted `content-language` was not preflighted cross-site; `range` was not preflighted either but switched `accept-encoding` to `identity`.

## Method (spike code, deleted after recording)

Scratch dir outside the repo. One HTTP/2 server answered `/page` (HTML), `/setcookie` (`lax=1; Path=/` and `none=1; Path=/; SameSite=None; Secure`), `OPTIONS` on any path with 204, `access-control-allow-origin: <origin>`, `access-control-allow-credentials: true`, `access-control-allow-methods: GET, POST` and `access-control-allow-headers` echoing `access-control-request-headers` (or the `allow=` query parameter when given; `access-control-max-age: 600` on paths containing `maxage`), and anything else with a JSON body and the same allow-origin/credentials headers. The headers of each request were read in wire order from the server's raw HTTP/2 header list (Node's `stream` event `rawHeaders`), with the HTTP/2 session each came on and whether the HEADERS frame ended the stream.

```sh
chromium --headless=new --remote-debugging-port=<port> --user-data-dir=<fresh> \
  --host-resolver-rules='MAP * 127.0.0.1' --ignore-certificate-errors \
  --no-first-run --no-default-browser-check --disable-background-networking \
  --disable-component-update --disable-sync about:blank
```

Driven over raw CDP: typed navigations to `/setcookie` on every host, `Page.navigate` to `https://www.example.com:P/page?q=x`, then `Runtime.evaluate` of `fetch(url, {credentials: 'include', headers, ...})` per case with a distinct path per case (so no preflight came from the cache), to `https://www.example.com:P` (same-origin), `https://cdn.example.com:P` (same-site) and `https://www.example.net:P` (cross-site).

- First run (the placement survey): single headers `api-key`, `authorization`, `x-zeta`, `x-a`, `content-language`, `range`; pairs and larger sets (`{api-key, x-zeta}` in both insertion orders and cases, `{x-a, x-b, x-c, x-d}`, `{b-second, A-First, zz, Accept-Language: fr}`); duplicates (`X-Dup` and `x-dup`); the forbidden and table names above; POST with JSON; the preflight, a refusing answer, and the cache with an answer allowing `api-key, x-zeta, content-type`.
- Second run (the allowlist): `API-Key: k1` and `Authorization: Bearer t`, each as a GET and as a POST with a JSON (`{"a":1}`), form (`a=1`), string (`hello`), `Uint8Array([1,2,3])` and no body, to the three targets; a GET with `API-Key` in the default credentials mode to same-site and cross-site; refusing answers (`allow=content-type` for a GET and a JSON POST with `api-key`, `allow=api-key` for a JSON POST, `allow=*`, and `allow=API-KEY`); and the cache sequences of verdict 6, plus a GET repeated at once and after 6 s without `access-control-max-age`.

## Header lists

As for the earlier findings, Chromium 152 is unbranded headless; the header SET and ORDER are taken as those of the pinned target (Chrome 146), with branded values. Only the leading part is shown where the rest is unchanged from the `fetch` tables of `sec-fetch-site-by-initiator` and `post-requests`.

### The measured sets (second run)

GET, same-origin, `API-Key: k1` (the whole list):

```
sec-ch-ua-platform: "Linux"
api-key: k1
user-agent: <UA>
sec-ch-ua: <sec-ch-ua>
sec-ch-ua-mobile: ?0
accept: */*
sec-fetch-site: same-origin
sec-fetch-mode: cors
sec-fetch-dest: empty
referer: https://www.example.com:P/page?q=x
accept-encoding: gzip, deflate, br, zstd
accept-language: en-US,en;q=0.9
cookie: lax=1; none=1
priority: u=1, i
```

POST JSON, cross-site, `Authorization: Bearer t` (the whole list):

```
content-length: 7
sec-ch-ua-platform: "Linux"
authorization: Bearer t
user-agent: <UA>
sec-ch-ua: <sec-ch-ua>
content-type: application/json
sec-ch-ua-mobile: ?0
accept: */*
origin: https://www.example.com:P
sec-fetch-site: cross-site
sec-fetch-mode: cors
sec-fetch-dest: empty
sec-fetch-storage-access: active
referer: https://www.example.com:P/
accept-encoding: gzip, deflate, br, zstd
accept-language: en-US,en;q=0.9
cookie: none=1
priority: u=1, i
```

Every other case of the second run is the corresponding table without an author header, with the header inserted right after `sec-ch-ua-platform`.

Preflight of that request (the same list for same-site, with `sec-fetch-site: same-site`; for a GET, `access-control-request-method: GET`; HEADERS frame with END_STREAM, own connection):

```
:method: OPTIONS
accept: */*
access-control-request-method: POST
access-control-request-headers: authorization,content-type
origin: https://www.example.com:P
user-agent: <UA>
sec-fetch-mode: cors
sec-fetch-site: cross-site
sec-fetch-dest: empty
referer: https://www.example.com:P/
accept-encoding: gzip, deflate, br, zstd
accept-language: en-US,en;q=0.9
priority: u=1, i
```

### Other sets (first run; why there is no fixed slot)

- `{api-key}`: `sec-ch-ua-platform, api-key, user-agent, sec-ch-ua, sec-ch-ua-mobile`
- `{authorization}`: the same slot as `api-key`
- `{x-zeta}`: `x-zeta, sec-ch-ua-platform, user-agent, sec-ch-ua, sec-ch-ua-mobile`
- `{x-a}`: `sec-ch-ua-platform, user-agent, sec-ch-ua, x-a, sec-ch-ua-mobile`
- `{api-key, x-zeta}` (either insertion order, either case): `x-zeta, sec-ch-ua-platform, api-key, user-agent, sec-ch-ua, sec-ch-ua-mobile`
- `{x-a, x-b, x-c, x-d}`: `x-d, sec-ch-ua-platform, x-c, sec-ch-ua, x-a, sec-ch-ua-mobile, user-agent, x-b` (the table's own `user-agent` moves)
- `{b-second, A-First, zz, Accept-Language: fr}`: `sec-ch-ua-platform, accept-language, sec-ch-ua, sec-ch-ua-mobile, a-first, zz, b-second, user-agent, accept, ...`
- POST JSON with `{api-key, x-zeta}`: `content-length, x-zeta, sec-ch-ua-platform, api-key, user-agent, sec-ch-ua, content-type, sec-ch-ua-mobile, ...`
- `{content-language}`: between `sec-ch-ua` and `sec-ch-ua-mobile`

## Extending the allowlist

Measure the new name set the same way (every method, body kind and fetch site the recipe needs, local servers only), and add it with its measured order to `PLACEMENT` in `packages/searchcast/src/author-headers.ts`. Its order is only known for this Chromium's hash layout: re-measure every set when the pinned Chrome moves.

## Not measured

Name sets other than those above (in particular any set searchcast refuses), HTTP/1.1, `http` (non-secure) targets, `no-cors` mode, `XMLHttpRequest.setRequestHeader` (assumed to share `fetch()`'s header map, not checked), the `access-control-max-age` cap, and a preflight refused by status (Chromium follows the Fetch standard; searchcast maps statuses as for POST).
