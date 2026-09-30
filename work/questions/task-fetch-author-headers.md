<!-- dorfl-sidecar: item=task:fetch-author-headers type=task slug=fetch-author-headers allAnswered=false -->

## Q1

**'task:fetch-author-headers' was bounced — how should we proceed?**

> The measurement contradicts the task's premise that "author headers sit where Chrome puts them" as a fixed slot in the header table. This is the stop condition the task's Prompt names ("Chrome reorders in a way the table model cannot express").
>
> Measured with nixpkgs Chromium 152.0.7977.82 (headless, CDP-driven `fetch()` with `credentials: 'include'`) against a local Node 24 HTTP/2 server only; headers read in wire order. Full data: work/notes/observations/2026-09-30-author-header-order-is-hash-order.md.
>
> 1. **Placement depends on the header names.** For a same-origin GET:
>    - `{api-key}` and `{authorization}`: after `sec-ch-ua-platform`, before `user-agent`.
>    - `{x-zeta}`: before `sec-ch-ua-platform` (first).
>    - `{x-a}`: between `sec-ch-ua` and `sec-ch-ua-mobile`.
>    - `{api-key, x-zeta}`: `x-zeta, sec-ch-ua-platform, api-key, user-agent, ...`
> 2. **Larger sets also reorder the table's own headers.**
>    - `{x-a, x-b, x-c, x-d}`: `x-d, sec-ch-ua-platform, x-c, sec-ch-ua, x-a, sec-ch-ua-mobile, user-agent, x-b`, so `user-agent` moved.
>    - `{b-second, A-First, zz, Accept-Language}`: `user-agent` moved after the author headers.
> 3. **It is deterministic.** The same set always gave the same order, regardless of insertion order or name case.
>
> This matches Blink's `HTTPHeaderMap` (a WTF hash map) being iterated over the author headers together with `user-agent`, `sec-ch-ua*` and `content-type`. The pinned table order is one instance of that hash order. Doing what Chrome does means reimplementing WTF's string hash and hash-table layout (sizes, probing, rehash) for Chrome 146, and checking it against captures. That is a design and maintenance decision, not a slot in the table.
>
> Other measured facts, usable in a re-scope:
> - Names are lowercased on HTTP/2.
> - A non-safelisted author header preflights a cross-origin GET (same-site too) with `access-control-request-method: GET`.
> - `access-control-request-headers` is lowercased, sorted and comma-joined with NO space (`api-key,content-type,x-zeta`).
> - A preflight whose answer does not allow the header means the request is not sent.
> - The preflight cache is per URL and covers header names: a wider allowed list also covered later requests with other names and a JSON POST.
> - Pages CAN set `accept-language` and `priority`, which replace the table's values; `user-agent`, `cookie`, `referer`, `sec-*` and `x-http-method-override: TRACE` are silently dropped.
>
> Suggested re-scopes, for a human to pick:
> - (a) Model Blink's hash order: port WTF StringHasher and HashTable iteration for the pinned version, and test it against a matrix of captured key sets. This is costly and must be re-measured at every Chrome bump.
> - (b) Allow only a small, measured allowlist of header-name sets (for example `{api-key}` alone, whose slot is known), and refuse any other set.
> - (c) Accept an order that is not Chrome's for author headers, and record that it weakens strict impersonation. This probably conflicts with ADR 0001.
>
> The Marginalia `API-Key` use case needs only (b) with `{api-key}`.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
