---
title: Impersonated transport, pinned Chrome, per-kind header tables, explicit libcurl path, strict check, proxy passthrough
slug: impersonated-transport
spec: serpcast
blockedBy: [fingerprint-spike, recipe-schema-package]
covers: [2, 3, 4, 5, 6, 8, 19]
---

## What to build

The transport every engine uses: a small client over libcurl-impersonate (through `impers`, or the fallback the spike recommends) that sends a request as the pinned Chrome (`chrome146` unless the spike says otherwise) with exactly our header table for the chosen request kind (document navigation, same-origin navigation with referer, fetch/XHR, script), through the caller's proxy (`http`, `socks5`, `socks5h` URL, or none), with a cookie session the caller can keep across requests, a per-request timeout and an abort signal. The shared library is located explicitly: an option, then `SERPCAST_LIBCURL_PATH`, then `LIBCURL_PATH`, then serpcast's data directory (`$XDG_DATA_HOME/serpcast/`, where the install command of a later task puts it). It is set before `impers` is imported so impers never downloads anything. On first use a strict check (default on) verifies the loaded library is libcurl-impersonate and accepts the pinned target; failure raises an `impersonation` error whose message says how to fix it (install command, or set the path). Network failures raise `transport` errors; timeouts raise `timeout`.

Define the typed error class used across serpcast here (`SerpcastError`, `kind`: `blocked` | `recipe` | `timeout` | `transport` | `impersonation` | `exhausted`, plus a message and optional cause), exported from the package.

The proxy URL is passed to libcurl as given, so its scheme decides where DNS is resolved: `socks5h://` resolves at the proxy, `socks5://` resolves locally. Document this prominently (callers that want no local DNS must pass `socks5h://`). Because the library is loaded once per process, the library path is process-global: a later instance asking for a different path fails with an `impersonation` error instead of silently using the first one.

## Acceptance criteria

- [ ] Requests to a local test server carry exactly the header table for each request kind: names, values and order, and no extra headers from the library.
- [ ] The impersonation target and the Chrome version in the header tables come from one constant, so they cannot drift apart.
- [ ] With no library found, or with plain libcurl, the first request fails with an `impersonation` error and makes no network call; in non-strict mode it proceeds.
- [ ] No code path triggers impers's own download (asserted by a test that runs with no library available and checks no download was attempted, for example by pointing the data dir and `HOME` at a temp dir and verifying nothing was written).
- [ ] A second instance configured with a different library path in the same process fails loudly.
- [ ] The proxy option is honoured for `http` and `socks5h` (test against a local proxy or a mock that records the CONNECT/SOCKS request).
- [ ] Cookies set by a response are sent on the next request in the same session and not in another session.
- [ ] The pinned libcurl-impersonate version and its per-platform checksums live in one exported constant (the install command of a later task reuses it).
- [ ] Tests needing the native library run in CI: the CI workflow fetches the pinned release named by that constant, verifies its checksum and sets the path; locally they are skipped with a clear message when no library is configured. Record this decision.
- [ ] Tests that touch the data dir or `HOME` isolate them in a temp dir and assert the real ones are untouched.

## Blocked by

- fingerprint-spike
- recipe-schema-package (serialized: both edit package manifests and the root README LOC table)

## Prompt

Goal: the fingerprint layer of ADR 0001, honouring ADR 0002 (no hidden network, strict by default). Read the finding `work/notes/findings/impers-fingerprint-vs-curl-cffi.md` first; it tells you the exact options for header control and preventing the download, or tells you to use the fallback binding. If the finding contradicts this task, follow the finding and record the deviation. Keep the module small; it is the most security-relevant code in the repo.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
