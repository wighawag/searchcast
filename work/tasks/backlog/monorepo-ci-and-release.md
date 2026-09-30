---
title: One CI workflow and one release workflow for every package, with a no-1.0 guard and pack checks
slug: monorepo-ci-and-release
spec: searchcast-monorepo
blockedBy: [serve-options-before-command]
covers: [15, 16]
---

## What to build

Make the repo's two workflows describe and guard the monorepo as it now is.

- `test.yml`: one workflow running every package's tests (recipe, searchcast with the native tests against the pinned library installed by `searchcast install-libcurl`, browser and CLI tests with Google Chrome). Comments name the packages and the env each suite needs. It also runs the two checks below.
- A release-plan check (a small script under `scripts/`, run in CI and by `pnpm test` at the root or a dedicated root script included in `verify`): fails if any package.json version is >= 1.0.0, or if `changeset status` plans any package to >= 1.0.0, or plans a major bump. With the pending changesets it must report `searchcast` 0.2.0, `@searchcast/browser` 0.1.0, `@searchcast/recipe` 0.1.0 (print the plan).
- A pack check (script or test): for each publishable package, the file list of a pack dry-run matches an expected shape (dist, README, LICENSE, CHANGELOG, package.json; plus `integrations/searxng/searchcast.py` for `searchcast`); each has `publishConfig.access: public`, a `repository.url` on `wighawag/searchcast` with the right `directory`, and the right license (MIT for `@searchcast/recipe`, AGPL-3.0-only otherwise). Written so the platform packages of the next task can be added to it.
- `release.yml`: keep the file name (it is the trusted publisher bound to every name) and its flow (changesets action, `pnpm release:ci`, OIDC, `PNPM_CONFIG_PROVENANCE: true`, never cancel an in-progress run). Update the header comment: the packages it publishes, that all are bound to `wighawag/searchcast` + `release.yml` on npm, that the scoped names were reserved at 0.0.0 by hand, and that there is no local publish path. `release:ci` at the root runs the release-plan check before publishing.
- Root README: a short "Release" section (changesets, Version Packages PR, OIDC, provenance, never 1.0 without an explicit decision).

> FORWARD-NOTE (conductor, after #10): (1) In CI today two CLI cases are skipped: the Xvfb case (no Xvfb on the runner) and the SearXNG engine case (`SEARCHCAST_TEST_SEARXNG_PYTHON` unset). Make the Xvfb case run in CI (install `xvfb`). For the SearXNG case, run it if a SearXNG Python can be installed in CI at reasonable cost; otherwise keep it skipped but explicit (a named, commented exception in the workflow and in the "no silent skip" guard) and record the decision. (2) Peer-dependency hazard: once `@searchcast/browser` is 0.1.x inside `searchcast`'s peer range, a later minor of `@searchcast/browser` makes changesets plan a MAJOR for `searchcast` (the peer rule). The release-plan check must catch that; also decide whether to set changesets' `onlyUpdatePeerDependentsWhenOutOfRange` (under `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH`) and record why. See `work/notes/observations/2026-09-30-browser-library-package-decisions.md`, decisions 1 and 2.

> FORWARD-NOTE (conductor, freshness check after #14): partial pack checks already exist: `packages/searchcast/test/pack.test.ts` (npm pack --dry-run --json --ignore-scripts; asserts the SearXNG file path), `packages/recipe/test/package.test.ts` and `packages/browser/test/package.test.ts` (manifest shape). Build the repo-wide pack check on the same technique and fold or reference these rather than adding a third style. `@searchcast/browser` now also exports `browserCommand` from `./cli`.

## Acceptance criteria

- [ ] CI runs every suite (no suite silently skipped in CI: the job fails if the native or browser tests would be skipped, for example by requiring their env there).
- [ ] The release-plan check fails on a >= 1.0.0 version or plan (tested with a fixture), and passes on the current tree with the expected plan.
- [ ] The pack check passes and fails on a missing LICENSE or a stray file (tested).
- [ ] `release.yml` still has `id-token: write`, provenance forced, no NPM_TOKEN, and the name `release.yml`.

## Blocked by

- serve-options-before-command

## Prompt

Goal: one CI and one release path for the whole product, with guards that make a wrong publish (1.0.0, a package missing its license, a tarball with junk) fail before npm sees it.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- Read ADR 0005 (`docs/adr/0005-*`) first: it is the rename table this task implements a part of. ADRs 0001 to 0004 still hold for the mechanics (read "serpcast" there as `searchcast`).
- Do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia example under `examples/` is the one owner-approved exception.
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
