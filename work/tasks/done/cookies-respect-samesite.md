---
title: Store SameSite and send cross-site requests only the cookies Chrome would send
slug: cookies-respect-samesite
blockedBy: [load-recipes-skips-set-metadata]
covers: []
---

## What to build

The cookie store does not store `SameSite`, so a request labelled `sec-fetch-site: cross-site` is sent every matching cookie, while Chrome drops cookies that are not `SameSite=None` on cross-site subresource requests (measured: from a cross-site credentialed `fetch`/`script`, only the `SameSite=None; Secure` cookie was sent, the default one was not; finding `sec-fetch-site-by-initiator`). Parse and store `SameSite` (`Strict`, `Lax`, `None`; absent or unknown means Chrome's default, Lax). When sending, a cross-site request (by the same site computation that sets `sec-fetch-site`) gets only `SameSite=None` cookies; `Lax` cookies still go with a top-level navigation; `Strict` cookies go only on same-site requests. A `SameSite=None` cookie without `Secure` is rejected when set, as Chrome does. Cookies persisted before this change (no `sameSite` field) load as Lax. Add a changeset.

## Acceptance criteria

- [ ] Cross-site `fetch` and `script` requests carry only `SameSite=None` cookies; same-site and same-origin requests carry all matching ones (subject to the existing credentials rules).
- [ ] Top-level navigation carries `Lax` and `None` cookies cross-site, not `Strict`.
- [ ] `SameSite=None` without `Secure` is not stored.
- [ ] A stored cookie without the new field loads and behaves as Lax.
- [ ] Tests cover the new behaviour, against a local server.

## Blocked by

- load-recipes-skips-set-metadata (serialized: both add changesets and may touch the README)

## Prompt

Origin: observation `2026-09-29-cross-site-cookies-ignore-samesite`. Read `work/notes/findings/sec-fetch-site-by-initiator.md` (the cookie paragraph and the captures) and the cookie store module. Only implement what the finding measured plus Chrome's documented defaults (Lax by default, None requires Secure); if a rule here is not backed by either, record it as a decision. Delete the observation note in the same change once it is resolved.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
