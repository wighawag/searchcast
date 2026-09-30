---
title: Per-platform @searchcast/libcurl-* packages carry the pinned libcurl-impersonate, built and verified in the release workflow
slug: libcurl-platform-packages
spec: searchcast-monorepo
blockedBy: [monorepo-ci-and-release]
covers: [11, 12, 13, 14]
---

## What to build

Five packages, `@searchcast/libcurl-linux-x64`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64`, `-win32-x64` (all reserved on npm at 0.0.0 and bound to this repo's `release.yml`), each carrying ONLY the pinned libcurl-impersonate library for its platform, so `npm install searchcast` brings the library on supported platforms with no separate step and no runtime download.

- **Package shape** (one directory per platform under `packages/`): `version` `0.0.0` in the source (a minor changeset takes each to 0.1.0), `os` and `cpu` set (and `libc: ["glibc"]` for the Linux ones, since the pinned archives are `*-linux-gnu`), NO `scripts.install`/`preinstall`/`postinstall`, `files` limited to the library and the license notices, `publishConfig.access: public`, repository on `wighawag/searchcast` with its `directory`. License notices for curl-impersonate, curl and BoringSSL (the upstream license texts, taken from the pinned release's source at the same tag; record where each came from); the `license` field states the combination honestly (for example `SEE LICENSE IN LICENSES.md` or an SPDX expression; decide and record). A short README per package: what it is, that it is installed automatically by `searchcast`, the pinned version and upstream URL, and that it is built in CI from the pinned archive.
- **Build script** (under `scripts/`): for each platform, download the archive named in `LIBCURL_IMPERSONATE` (the pins in `packages/searchcast/src/libcurl.ts` stay the single source of truth: read them, do not copy the hashes), verify its sha256 against the pin BEFORE unpacking, validate and extract with the same code and the same size caps as `install-libcurl` (reuse it; do not write a second tar reader), take exactly the pinned `library` entry (a regular file, not a symlink), and write it into the package directory under a fixed file name. The payload is never committed (gitignored). A pack/publish without the payload must fail (a `prepack` check in each platform package, which is not an install script).
- **Release workflow:** `release.yml` runs the build script before `pnpm release:ci` publishes, so the published platform packages are built from the pinned, verified archives, with provenance. It must not run for a Version-PR-only run in a way that could publish half the set; decide and record how (for example, build always before the changesets step, since the step either opens the PR or publishes).
- **CI:** `test.yml` builds at least the linux-x64 package with the script (so the verification path runs on every PR) and runs a test that loads the library through the platform-package lookup with no env var and no data directory.
- **searchcast:** lists the five packages as `optionalDependencies` pinned EXACTLY (`workspace:*` publishes the exact version; the library a given `searchcast` loads is the one it was released with). Library lookup order becomes: `libcurlPath` option, `SEARCHCAST_LIBCURL_PATH`, the old env names, the data directory (new then old), then the installed platform package for `${process.platform}-${process.arch}` resolved with `createRequire` (a package that is not installed, or a platform with no package, is simply skipped). `LibrarySource` gains `platform package`; `doctor` names it with the package name and version. `install-libcurl` stays as the fallback and its messages mention the platform packages (skipped optional dependencies, unsupported platform). Strict mode still verifies impersonation at load exactly as today, whatever the source. No runtime download is added anywhere; the main-entry import-walk test still passes.
- **Pack check** (from `monorepo-ci-and-release`): extended to the platform packages (only the library, notices, README, package.json).
- **Changesets:** minor for each platform package and a minor for `searchcast` (platform packages as optional dependencies).
- README (root and `searchcast`): install now brings the library on supported platforms; `install-libcurl` remains for others; how to check with `searchcast doctor`.

> FORWARD-NOTE (conductor, freshness check after #16): the data-directory logic now lives in `packages/searchcast/src/data-dir.ts` (new and old directory), and `LibrarySource` already has `SEARCHCAST_LIBCURL_PATH`, `SERPCAST_LIBCURL_PATH`, `LIBCURL_PATH`, `data directory`, `old data directory`; add `platform package` after them. The repo-wide pack check is `scripts/pack-check.mjs`: every non-private package must be listed in its `PUBLISHABLE` with its `extraFiles`/`allow`, so add the five platform packages there (their tarball is the library, the notices, README, package.json, and CHANGELOG if the check keeps requiring it). The pack check runs in `pnpm test` and in `release:ci`, so it must pass on a checkout where the payload has NOT been built (locally, and in CI for the four platforms not built there): decide how (for example, the check verifies the manifest and skips the payload file when absent, while each platform package's own `prepack` refuses to pack without it) and record it. `scripts/no-skips.mjs` makes CI fail on any skipped test, so the platform-package lookup test must really run in CI.

> RETRY HANDOFF (conductor, after PR #17 was blocked): the first attempt (branch `work/task-libcurl-platform-packages`, PR #17, closed) is complete except that CI failed one native test that passes on main: `packages/searchcast/test/doctor.test.ts` > "searchcast doctor (native libcurl-impersonate) > with remote, asks the echo service through the transport and the proxy and reports what it saw" gets `report.impersonating === false` with `libcurlPath: LIB`. Find the real cause (print `report.problem` in the assertion message first). A likely one: an earlier in-process test in the same file now loads the library from another source (the linux-x64 platform package CI builds, or a hidden-module mock that changes resolution), and the library is loaded once per process, so the later explicit path is refused. Fix the cause (test isolation or the lookup), not the assertion. Keep every other part of that branch; decision 1 of its decisions note (licenses) stands and goes to the owner separately.

## Acceptance criteria

- [ ] The build script verifies each archive's sha256 against the pin in the source before unpacking, rejects a mismatch (tested with a local fixture archive and a wrong pin, no network in tests), and reuses install-libcurl's validation and caps.
- [ ] Each platform package has `os`/`cpu` (`libc` on Linux), no install script, only the library + notices + README; publishing without the payload fails.
- [ ] `searchcast` resolves the library from the platform package after every other source (tested with a fake installed package in a temp `node_modules`), and doctor reports it.
- [ ] CI builds the linux-x64 package from the pinned archive and runs the native tests loading it through the platform-package lookup.
- [ ] `release.yml` builds the payloads before publishing; still OIDC, provenance, no token.
- [ ] No runtime download added; strict-mode and import-walk tests unchanged and green.

## Blocked by

- monorepo-ci-and-release

## Prompt

Goal: the pinned library ships through npm like any native dependency (esbuild-style optional platform packages), without giving up any of ADR 0002's properties: the only thing that downloads is CI at release time, from pinned URLs, verified against the sha256 already in the source. Read `packages/searchcast/src/libcurl.ts`, `install.ts`, `tar.ts`, `doctor.ts`, and the release/test workflows. The one live check this task needs (downloading the pinned linux-x64 archive and checking its hash matches) is done by CI and, gently, by the conductor; do not add network access to the test suite.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-monorepo`)

- Read ADR 0005 (`docs/adr/0005-*`) first: it is the rename table this task implements a part of. ADRs 0001 to 0004 still hold for the mechanics (read "serpcast" there as `searchcast`).
- Do NOT edit any `version` field in a package.json and do not run `changeset version`; versions move only through `.changeset/*.md` files (minor for every package this task touches, as stated below). Nothing may be published by this task.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders such as `engine-a`, `example.test`); the Marginalia example under `examples/` is the one owner-approved exception.
- Security properties must stay tested and unchanged: strict impersonation, no download reachable from the main entry, checksum pins, archive validation, no disk write except where ADR 0002 allows.
- No em dashes anywhere (code, comments, docs, changesets). Do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, and never grep `node_modules`, `dist` or `.git`.
- The local gate skips the native tests (no libcurl-impersonate here) and the browser tests (no Chrome); CI runs both. Keep the skip messages, and do not weaken a test to make it pass locally.
