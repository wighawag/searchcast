# Chrome's author-header placement is hash-table order, not a fixed slot (2026-09-30)

Seen while measuring for task `fetch-author-headers`, which stopped on it. Method: nixpkgs Chromium 152.0.7977.82 (`/nix/store/33pxss8h71cl7vmfpy21bidsw0lj1g8q-chromium-152.0.7977.82`, Linux x64, headless=new, fresh profile) driven over raw CDP. The page was `https://www.example.com:P/page?q=x`, and `fetch(url, {credentials: 'include', headers})` went to same-origin, same-site (`cdn.example.com`) and cross-site (`www.example.net`) targets. A single Node 24.19.0 HTTP/2 TLS server on 127.0.0.1 took every host (`--host-resolver-rules='MAP * 127.0.0.1'`, self-signed cert, `--ignore-certificate-errors`). Headers were read in wire order from the server's raw HTTP/2 header list. Only local servers were used; no internet traffic.

Where author headers land, relative to the existing `fetch` table (only the leading part is shown; everything from `accept` on was unchanged in every case):

- `{api-key}`: `sec-ch-ua-platform, api-key, user-agent, sec-ch-ua, sec-ch-ua-mobile`
- `{authorization}`: the same slot as `api-key`
- `{x-zeta}`: `x-zeta, sec-ch-ua-platform, user-agent, sec-ch-ua, sec-ch-ua-mobile`
- `{x-a}`: `sec-ch-ua-platform, user-agent, sec-ch-ua, x-a, sec-ch-ua-mobile`
- `{api-key, x-zeta}` (either insertion order, either case): `x-zeta, sec-ch-ua-platform, api-key, user-agent, sec-ch-ua, sec-ch-ua-mobile`
- `{x-a, x-b, x-c, x-d}`: `x-d, sec-ch-ua-platform, x-c, sec-ch-ua, x-a, sec-ch-ua-mobile, user-agent, x-b`. Here the table's own `user-agent` moves.
- `{b-second, A-First, zz, Accept-Language: fr}`: `sec-ch-ua-platform, accept-language, sec-ch-ua, sec-ch-ua-mobile, a-first, zz, b-second, user-agent, accept, ...`
- POST (`content-length` first as before): `content-length, x-zeta, sec-ch-ua-platform, api-key, user-agent, sec-ch-ua, content-type, sec-ch-ua-mobile, ...`
- `{content-language}`: between `sec-ch-ua` and `sec-ch-ua-mobile`

The same key set always gave the same order: two runs matched, and insertion order and name case made no difference. The order does depend on WHICH names are in the set, and once the set grows it also reorders `user-agent` and the client hints. This fits Blink's `HTTPHeaderMap` (a WTF hash map) being iterated over the author headers together with `user-agent`, `sec-ch-ua*` and `content-type`. The existing header tables' fixed prefix order is one instance of that hash order. Reproducing it means reimplementing WTF's string hash and hash-table layout (table sizes, probing, rehash), not inserting at a fixed slot.

Other results from the same capture:

- Names are lowercased on HTTP/2, and duplicates are combined as `x-dup: a, b`.
- A non-safelisted author header preflights a cross-origin GET (`access-control-request-method: GET`) just as it does a POST, same-site included, with either credentials mode. Same-origin requests are never preflighted.
- `access-control-request-headers` is lowercased, sorted and comma-joined WITHOUT a space: `api-key,content-type,x-zeta`. A form-encoded POST with `api-key` asks only for `api-key`.
- A preflight answer whose `access-control-allow-headers` lacks the header means the request is not sent (`TypeError: Failed to fetch`).
- The preflight cache is per URL and covers header names: after one answer allowing `api-key, x-zeta, content-type`, later GETs with any subset and a JSON POST to the same URL were not preflighted. When the answer allowed only what was asked, a request with another name preflighted again.
- A safelisted `content-language` was not preflighted cross-site. `range` was not preflighted either, but it switched `accept-encoding` to `identity`.
- Page scripts CAN set `accept-language` and `priority`, which then replace the table's values. `user-agent`, `cookie`, `referer`, `sec-*`, and `x-http-method-override: TRACE` were silently dropped.

Follow-up (2026-09-30): turned into the finding `work/notes/findings/fetch-author-headers.md` (with a second, allowlist run), and the task was re-scoped to a measured allowlist of name sets.
