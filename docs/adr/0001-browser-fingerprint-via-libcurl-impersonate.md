> Names changed since this was written, see [ADR 0005](0005-serpcast-renamed-to-searchcast-browser-runner-becomes-searchcast-browser.md): read "serpcast" here as `searchcast`, "serpcast-recipe" as `@searchcast/recipe`, and "searchcast" (the browser runner) as `@searchcast/browser`.
# Engine traffic uses libcurl-impersonate (via impers) with one pinned Chrome and our own header tables

## Status

accepted (the "via impers" loading is superseded by ADR 0004; the pinned target and header-table decisions stand)

Search engines gate crawlers on the TLS/JA3/JA4 and HTTP/2 fingerprint, and Node's own HTTP stack (undici) carries a Node fingerprint, so serpcast sends all engine traffic through libcurl-impersonate, the same native library SearXNG reaches through curl_cffi, loaded in Node via `impers` (the Node port of curl_cffi by the same author, koffi FFI, MIT). The impersonation target is pinned to one explicit Chrome version (never the moving `chrome` alias) and the library's default headers are turned off: every request carries only our header table for that exact Chrome version, per request kind (document navigation, same-origin navigation, fetch/XHR, script). A request whose headers describe a different browser than its TLS handshake is itself a bot signal (privately measured: 0/8 answered with mismatched headers, 30/30 with a coherent set, same IP), so matching the TLS side alone is not enough.

## Considered Options

- **undici with tuned headers**: rejected, the TLS fingerprint stays Node's.
- **Spawning the `curl-impersonate` binary per request**: works, but a process per request, and sessions/cookies must be marshalled across the process boundary.
- **Go/Rust impersonation clients (tls-client, cycletls, impit)**: different fingerprint databases from curl_cffi, so "the same fingerprint as SearXNG" would need separate verification forever.
- **A direct koffi binding to libcurl-impersonate**: the fallback if `impers` cannot send exactly our headers or cannot be kept from downloading at runtime (the first task, a spike, decides).

## Consequences

- serpcast has a native dependency (koffi plus a libcurl-impersonate shared library). The library path is resolved explicitly and set before `impers` loads, so impers's own first-launch download never runs (see ADR 0002).
- Upgrading the Chrome target means updating the target and the header tables together, in one change.
