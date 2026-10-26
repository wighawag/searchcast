---
title: Requests to plain http:// URLs carry the headers Chrome sends there (no sec-fetch-*, no client hints)
slug: http-targets-no-secure-context-headers
blockedBy: [cookies-respect-samesite]
covers: []
---

## What to build

The header tables are the same for `http://` and `https://` targets, but Chrome sends no `sec-fetch-*` and no client hints (`sec-ch-ua*`) to a non-secure origin, uses a different `accept-encoding` there, and sends no `referer` when an `https` page loads an `http` URL (the default referrer policy). Measure Chromium's real headers for plain-http requests per request kind (document navigation typed, same-origin navigation, `fetch`, `script`), with local servers only, the same way the existing findings were measured (nixpkgs Chromium over raw CDP plus the net-log or the server's raw header list), record the result as a finding, and make the header tables follow it for `http://` targets. Add a changeset.

## Acceptance criteria

- [ ] A finding `work/notes/findings/http-target-headers.md` with method, Chromium version and date, listing the measured headers in wire order per request kind for `http://` targets, and the referer behaviour for an `https` page loading an `http` URL.
- [ ] For `http://` targets the transport sends exactly the measured table (asserted against a local server, names, values and order); `https://` tables are unchanged.
- [ ] The referer downgrade case sends no `referer`.
- [ ] Tests cover the new behaviour; no internet traffic in tests or in the measurement.

## Blocked by

- cookies-respect-samesite (serialized: both touch the transport's request building)

## Prompt

Origin: observation `2026-09-29-http-targets-get-secure-context-headers`. The existing finding `sec-fetch-site-by-initiator` lists this case as not measured; measure it before changing the tables (strict impersonation: never guess a header table). If HTTP/1.1 vs HTTP/2 changes header casing or order, model what libcurl-impersonate can actually send and record any remaining difference. Delete the observation note once resolved.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
