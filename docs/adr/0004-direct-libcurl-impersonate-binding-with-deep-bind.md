# libcurl-impersonate is bound directly with koffi and loaded with RTLD_DEEPBIND, not through impers

## Status

accepted (supersedes the "via impers" part of ADR 0001; the rest of ADR 0001 stands)

The fingerprint spike (`work/notes/findings/impers-fingerprint-vs-curl-cffi.md`) found that stock `impers` matches curl_cffi on JA3, JA4, the Akamai HTTP/2 string and our header tables, but not on the HTTP/2 HEADERS frame: when libcurl-impersonate is loaded into Node, its nghttp2 calls bind to Node's newer nghttp2, which drops the PRIORITY flag Chrome (and curl_cffi) set. Loading the library with `RTLD_DEEPBIND` (koffi `{deep: true}`) restores byte-identical output, and impers exposes no way to do that. So serpcast binds libcurl-impersonate directly with koffi (ADR 0001's own fallback) and deep-binds it on Linux and FreeBSD. The binding also avoids impers's first-import download, its shared module-level cookie jar, its auto-added Accept-Encoding and its missing zstd decoding.

## Considered Options

- **impers with a one-line patch to pass `{deep: true}`**: smaller, but a patch on an alpha dependency, and the jar, header and decoding workarounds would remain.

## Consequences

- The fix is the deep-bind, not the binding: any future loader (including a return to impers) must load with `RTLD_DEEPBIND`, and the transport tests assert the HEADERS PRIORITY flag because JA3/JA4/Akamai pass without it.
- macOS and Windows have no `RTLD_DEEPBIND`; there the library loads plainly and HTTP/2 HEADERS parity is not claimed until measured.
- The library is pinned in memory (`RTLD_NODELETE`) to avoid a crash at process exit from BoringSSL thread-local destructors.
