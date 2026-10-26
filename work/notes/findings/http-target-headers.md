---
title: Chromium's headers for plain http:// targets (HTTP/1.1, no secure-context headers unless loopback, mixed content, referer downgrade)
slug: http-target-headers
source: 'captured 2026-10-26 (UTC ~07:10-07:30) from nixpkgs Chromium 152.0.7977.82 (/nix/store/liw3r9d2yk68c081lkpbkj2817ccpp0i-chromium-152.0.7977.82, Linux x64, headless=new, fresh profile per run) against LOCAL servers only: a Node 24.19.0 plain HTTP/1.1 server and an HTTP/2 TLS server on 127.0.0.1, every host name mapped there with --host-resolver-rules="MAP * 127.0.0.1", the self-signed test certificate plus --ignore-certificate-errors. Headers read from the HTTP server''s raw header list (names as spelled on the wire, in order), cross-checked with the net-log. libcurl-impersonate 2.1.1 (libcurl/8.21.0-IMPERSONATE, the pinned release) checked against a local server the same day. No third-party site was contacted. Single host, single day, one Chromium version: re-measure when the pinned Chrome moves.'
---

# Chromium's headers for plain `http://` targets

The finding `sec-fetch-site-by-initiator` listed `http` subresources, and the referer downgrade (an `https` page loading an `http` URL), as not measured. This one measures what Chromium sends to an `http://` URL for each request kind searchcast models (`document` typed, `same-origin-navigation` link click, `fetch`, `script`), plus a `fetch` POST, author headers and the CORS preflight, from an `http` page and from an `https` page, to an ordinary host name and to loopback hosts.

## Verdict

1. **Plain http is HTTP/1.1** (Chrome has no cleartext HTTP/2). On HTTP/1.1 Chromium sends `Host` first and `Connection: keep-alive` second, never a `priority` header (not even to a loopback host, which does get the other secure-context headers), and spells names in Title-Case per hyphenated word (`User-Agent`, `Accept-Encoding`, `Sec-Fetch-Site`, `Upgrade-Insecure-Requests`, `Access-Control-Request-Method`), EXCEPT the client hints, which stay lowercase (`sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`). Headers a page's script sets keep the spelling the script gave them: `content-type` stayed `content-type` when written so and `Content-Type` when written so, `API-Key` and `api-key` likewise. The `content-type` Chrome adds itself (a string body without one) is `Content-Type`.
2. **A host that is not potentially trustworthy gets no secure-context headers**: no client hints (`sec-ch-ua*`), no `sec-fetch-*` (including `sec-fetch-storage-access`), and `Accept-Encoding: gzip, deflate` instead of `gzip, deflate, br, zstd`. Everything else (`Upgrade-Insecure-Requests`, `User-Agent`, `Accept`, `Origin`, `Referer`, `Accept-Language`, `Cookie`) is where it is in the `https` tables, in the same order. A CORS preflight keeps `Sec-Fetch-Mode: cors` (only `sec-fetch-site` and `sec-fetch-dest` go).
3. **Loopback hosts are potentially trustworthy**: `http://localhost`, `http://foo.localhost`, `http://127.0.0.1` and `http://127.0.0.2` all got the full secure-context set (client hints, `sec-fetch-*`, `br, zstd`), in the same order as over HTTP/2, only spelled for HTTP/1.1 and without `priority`. (`[::1]` is in the same Chromium rule, `net::HostStringIsLocalhost`, but its capture failed in this setup: not measured.)
4. **Mixed content**: from an `https` page, a `fetch` (GET or POST) or a `<script src>` to an `http` URL that is not potentially trustworthy is BLOCKED: no request reaches the server (`fetch` rejects with `TypeError: Failed to fetch`, the script fires `error`), even to the same host name. A link-click navigation to such a URL is allowed.
5. **Referer downgrade**: from an `https` page to an `http` URL, Chrome sends NO `referer` (its default policy `strict-origin-when-cross-origin`), for the navigation (to a non-loopback host) and for `fetch`, `script` and the preflight (to a loopback host, the only subresources not blocked). `origin` is still sent on a `fetch`.
6. Author headers: to a host that is not potentially trustworthy, the measured sets (`{api-key}`, `{authorization}`) land right before `Accept` (after `Content-Type` when there is one), GET and POST alike; to a loopback host, after `sec-ch-ua-platform` as over HTTP/2.

Cookies were as in the `https` case (`SameSite` rules; a `Secure` cookie never goes to `http`). Cross-site `fetch` with `credentials: 'include'` from an http page carried no cookie: the only ones set were `Lax` (default), which a cross-site request does not get.

## What libcurl-impersonate can send (2.1.1, target `chrome146`, default headers off)

- With the impersonation target alone, an `http://` request is an `h2c` upgrade attempt: libcurl adds `Upgrade: h2c` and `HTTP2-Settings: ...` after `Host`, and `Connection: Upgrade, HTTP2-Settings` at the end. Chrome never sends these. `CURLOPT_HTTP_VERSION = CURL_HTTP_VERSION_1_1` (set after `curl_easy_impersonate`) removes all three.
- libcurl sends HTTP/1.1 header names as given in `CURLOPT_HTTPHEADER`, in that order, after its own `Host`. So the casing above can be sent exactly.
- libcurl moves a custom `Connection:` header to the END of an HTTP/1.1 request (wherever it is in the list; also with a custom `Host:`). A custom `Host:` header, however, is sent first. So the transport sends Chrome's start as one custom line, `Host: <host>\r\nConnection: keep-alive`, which goes on the wire as the two headers in Chrome's order (verified against a local server). The host is the URL's `host` (lowercased, punycode, port only when not the default), as libcurl's own `Host` would be.
- No remaining difference was found on the header list for any measured case: the transport tests assert the server's raw header list, `Host` included, against the tables below. Not compared: the request line beyond `METHOD /path HTTP/1.1`, and TCP-level behaviour.

## Method (spike code, deleted after recording)

Scratch dir outside the repo (`/tmp/httpspike`). Servers answered `/page` (HTML with links), `/x.js`, `/api` (JSON, with `access-control-allow-origin: <origin>` and `access-control-allow-credentials: true`; `OPTIONS` also allowed `content-type, api-key, authorization`), `/setcookie` (`lax=1; Path=/`, `plain=1; Path=/`).

```sh
chromium --headless=new --remote-debugging-port=9347 --user-data-dir=/tmp/httpspike/profile \
  --log-net-log=/tmp/httpspike/net.json --net-log-capture-mode=IncludeSensitive \
  --host-resolver-rules='MAP * 127.0.0.1' --ignore-certificate-errors \
  --no-first-run --no-default-browser-check --disable-background-networking \
  --disable-component-update --disable-sync about:blank
```

Driven over raw CDP: cookies set by typed navigations to `/setcookie` on each host; `Page.navigate` (`transitionType: 'typed'`) to `http://www.example.com:H/page?q=x`; then `Runtime.evaluate` (`userGesture: true`) of `fetch(url, {credentials: 'include'})`, a default `fetch(url)`, `document.head.appendChild(<script src=url>)` and a link `click()`, same-origin, same-site (`cdn.example.com`) and cross-site (`www.example.net`); `fetch` POSTs (form, string, none, `Uint8Array`, JSON same-origin, JSON and form cross-site) and GETs/POSTs with `API-Key` or `Authorization`. From `https://www.example.com:S/page?q=x`: `fetch`/`script`/POST to `http://www.example.net:H`, `http://www.example.com:H` and `http://localhost:H` (GET, with `API-Key`, JSON POST, form POST), and a link click to `http://www.example.net:H/nav`. Typed navigations and `fetch`/`script` on `http://localhost:H`, `http://foo.localhost:H`, `http://127.0.0.1:H`, `http://127.0.0.2:H` (and `http://[::1]:H6` against a server on `::1`, which did not load). Four runs with a fresh profile each.

## Header lists (HTTP/1.1, wire spelling)

Chromium 152 is unbranded headless (`HeadlessChrome/152.0.0.0`, two-brand `sec-ch-ua`); as for the other tables, the SET, ORDER and SPELLING are taken from the capture, with the pinned Chrome 146's branded values (`UA` below). Every list starts with `Host: <host[:port]>`; `Cookie` (when there is one) comes after `Accept-Language`, last.

### Not a loopback host (`http://www.example.com:H`)

`document` (typed):

```
Host: www.example.com:H
Connection: keep-alive
Upgrade-Insecure-Requests: 1
User-Agent: UA
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7
Accept-Encoding: gzip, deflate
Accept-Language: en-US,en;q=0.9
Cookie: lax=1; plain=1
```

`same-origin-navigation` (link click): the same, with `Referer: http://www.example.com:H/page?q=x` between `Accept` and `Accept-Encoding`.

`fetch` and `script` (same-origin; identical lists, also for a default-credentials `fetch`):

```
Host: www.example.com:H
Connection: keep-alive
User-Agent: UA
Accept: */*
Referer: http://www.example.com:H/page?q=x
Accept-Encoding: gzip, deflate
Accept-Language: en-US,en;q=0.9
Cookie: lax=1; plain=1
```

Same-site (`cdn.example.com`) and cross-site (`www.example.net`) `fetch`: `Origin: http://www.example.com:H` after `Accept`, and `Referer: http://www.example.com:H/` (the origin); a cross-site `script`, the same without `Origin`. No `sec-fetch-storage-access`.

`fetch` POST (same-origin; form body written with `content-type`):

```
Host: www.example.com:H
Connection: keep-alive
Content-Length: 3
User-Agent: UA
content-type: application/x-www-form-urlencoded
Accept: */*
Origin: http://www.example.com:H
Referer: http://www.example.com:H/page?q=x
Accept-Encoding: gzip, deflate
Accept-Language: en-US,en;q=0.9
Cookie: lax=1; plain=1
```

A string body without a type: `Content-Type: text/plain;charset=UTF-8` there. No body, or bytes: no content-type line. With author headers: `API-Key: k` / `Authorization: Bearer k` right before `Accept` (after the content-type line when there is one), measured for GET, JSON POST, form POST, string POST and empty POST.

Preflight (cross-site JSON POST, or a GET with `API-Key`), then the request (as above, `Origin` and origin `Referer`):

```
Host: www.example.net:H
Connection: keep-alive
Accept: */*
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type
Origin: http://www.example.com:H
User-Agent: UA
Sec-Fetch-Mode: cors
Referer: http://www.example.com:H/
Accept-Encoding: gzip, deflate
Accept-Language: en-US,en;q=0.9
```

### Loopback host (`http://localhost:H`, `foo.localhost`, `127.0.0.1`, `127.0.0.2`)

`document`: `Host`, `Connection: keep-alive`, `sec-ch-ua`, `sec-ch-ua-mobile: ?0`, `sec-ch-ua-platform: "Linux"`, `Upgrade-Insecure-Requests: 1`, `User-Agent`, `Accept` (navigation), `Sec-Fetch-Site: none`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-User: ?1`, `Sec-Fetch-Dest: document`, `Accept-Encoding: gzip, deflate, br, zstd`, `Accept-Language`, `Cookie`.

`fetch` (same-origin): `Host`, `Connection: keep-alive`, `sec-ch-ua-platform`, `User-Agent`, `sec-ch-ua`, `sec-ch-ua-mobile`, `Accept: */*`, `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: cors`, `Sec-Fetch-Dest: empty`, `Referer`, `Accept-Encoding: gzip, deflate, br, zstd`, `Accept-Language`, `Cookie`. `script`: `Sec-Fetch-Mode: no-cors`, `Sec-Fetch-Dest: script`. JSON POST: `Content-Length` after `Connection`, `content-type` between `sec-ch-ua` and `sec-ch-ua-mobile`, `Origin` after `Accept`. Cross-origin with `API-Key` (from `http://localhost` to `http://127.0.0.1`): `API-Key` after `sec-ch-ua-platform`; preflight `Accept`, `Access-Control-Request-Method`, `Access-Control-Request-Headers`, `Origin`, `User-Agent`, `Sec-Fetch-Mode`, `Sec-Fetch-Site`, `Sec-Fetch-Dest`, `Referer`, `Accept-Encoding`, `Accept-Language`. That is, the HTTP/2 tables in order, spelled for HTTP/1.1, without `priority`.

### From an `https` page (`https://www.example.com:S/page?q=x`)

- To `http://www.example.net:H` and `http://www.example.com:H`: `fetch` GET, `fetch` POST and `script` never reached the server (mixed content blocked). A link click to `http://www.example.net:H/nav` did, with the non-loopback `document`-shaped navigation list and NO `Referer` (`Cookie` sent).
- To `http://localhost:H`: `fetch` with `Origin: https://www.example.com:S`, `Sec-Fetch-Site: cross-site`, `Sec-Fetch-Storage-Access: active` and NO `Referer`; `script` likewise without `Origin`; preflights (`API-Key` GET, JSON POST) with NO `Referer`; form POST, the same.

## Not measured

`[::1]` (see verdict 3); `https` over HTTP/1.1 (a server without HTTP/2; Chrome would spell names for HTTP/1.1 there too, the transport sends the HTTP/2 lowercase names); an `http` target reached through an HTTP proxy (absolute-form request line, libcurl's proxy headers); a page-initiated navigation to another origin (not a modelled kind); a parser-blocking `<script>`; non-English `accept-language`.
