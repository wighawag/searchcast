---
title: serpcast becomes searchcast, one monorepo with @searchcast/browser, @searchcast/recipe and per-platform libcurl packages
slug: searchcast-monorepo
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (ADR 0005 for the renames) and the code; remaining work: the tasks under `work/tasks/`. Tasked on 2026-09-30 into `recipe-package-rename`, `browser-library-package`, `rename-serpcast-to-searchcast`, `searchcast-serve-command`, `monorepo-ci-and-release`, `libcurl-platform-packages` (strictly in that order); the implementation and testing decisions moved into those tasks and ADR 0005.

## Problem Statement

One product was split over two repos and three npm names: serpcast (HTTP search over libcurl-impersonate, the engine chain, recipes), serpcast-recipe (the shared recipe schema) and searchcast (the real-browser runner the chain falls back to, with a `serve` CLI that my systemd units and SearXNG use). Two release pipelines, two READMEs, cross-repo version bumps for every schema change, and the main package carries the worse name. Installing the native library is a separate command on every machine.

## Solution

One repo (`wighawag/searchcast`, which already holds both histories after the import merge), one release workflow, and these packages:

- `searchcast` 0.2.0: what serpcast was (transport, chain, code recipes, CLI with every serpcast command) plus `searchcast serve` with exactly the 0.1.x flags and behaviour, delegating to `@searchcast/browser` (optional peer). It ships the SearXNG engine at the same `integrations/searxng/searchcast.py` path.
- `@searchcast/browser` 0.1.0: the browser runner as a library.
- `@searchcast/recipe` 0.1.0: the recipe schema (MIT, zero dependencies).
- `@searchcast/libcurl-{linux-x64,linux-arm64,darwin-x64,darwin-arm64,win32-x64}` 0.1.0: the pinned libcurl-impersonate per platform, optionalDependencies of `searchcast`, built in the release workflow from the pinned archives after verifying their sha256.

Every rename, with its one-release fallback, is recorded in ADR 0005.

## User Stories

1. As a user of serpcast, I want to install `searchcast` and find every serpcast command and API, so that moving is a rename.
2. As a user of serpcast's API, I want the old exported names (`createSerpcast`, `SerpcastError`, ...) to keep working for one release, so that I can upgrade before I rename.
3. As a user with `SERPCAST_LIBCURL_PATH` set, I want it still honoured (after `SEARCHCAST_LIBCURL_PATH`), so that my setup keeps working.
4. As a user with files in `~/.local/share/serpcast/`, I want them still found when the new directory lacks them, and `doctor` to tell me, so that nothing breaks and I know what to move.
5. As a user, I never want my files moved behind my back.
6. As an operator of `searchcast serve` under systemd (socket activation, `--idle-exit`, `--xvfb`, Unix socket), I want the same command line to work after upgrading, once `@searchcast/browser` is installed, so that my units need no change.
7. As an operator whose `@searchcast/browser` is missing, I want `searchcast serve` to fail with a clear message naming the package to install.
8. As a SearXNG operator, I want the engine file at the same path inside the `searchcast` package, so that my `engine:` path keeps working.
9. As a library user of the browser runner, I want `@searchcast/browser` to export what `searchcast` 0.1.x exported, so that I only change the import.
10. As a recipe author, I want `@searchcast/recipe` to accept exactly what `serpcast-recipe` accepted, with the same messages, MIT and dependency-free.
11. As a user on a supported platform, I want the pinned libcurl-impersonate installed with `searchcast` itself, so that no separate install step is needed.
12. As a user on an unsupported platform or with optional dependencies skipped, I want `searchcast install-libcurl` to keep working.
13. As a security-minded user, I want the platform packages built only from the pinned archives, verified against the sha256 in the source, with provenance, and no runtime download ever.
14. As a user, I want `doctor` to say where the library came from (option, env name, data directory old or new, platform package).
15. As the maintainer, I want one CI workflow running every package's tests (native with the pinned library, browser with Google Chrome).
16. As the maintainer, I want one release workflow with changesets and OIDC trusted publishing for every package, and no 1.0.0 anywhere.
17. As a reader of the history, I want the old ADRs and findings kept verbatim with a note pointing to ADR 0005.
18. As the owner of public repos, I want no real search engine named in code, tests, examples or docs.

## Decisions kept at the spec level

- The history import (browser code to `packages/browser`, serpcast merged, its packages at `packages/searchcast` and `packages/recipe`) was done by the conductor as PR #7, merged with a merge commit: a dorfl build cannot do it (the build agent does no git and the runner rebases and squashes).
- No 1.0.0 anywhere: `searchcast` 0.1.2 to 0.2.0, every scoped package 0.0.0 to 0.1.0. Nothing is published until the conductor merges the Version Packages PR after the last task.

## Out of Scope

- webveil moving to `searchcast` ^0.2.0 and webveil-private-recipes moving to the new names: follow-ups in those repos.
- my-boxes: not edited; the needed changes are written up for the owner.
- Deprecating `serpcast`/`serpcast-recipe` on npm: the owner runs the commands (OIDC cannot deprecate).
- Removing the one-release fallbacks: the next minor after 0.2.x.

## Further Notes

The serpcast repo gets one last minor of `serpcast` and `serpcast-recipe` whose README says "moved to searchcast / @searchcast/recipe", released from that repo after the new names are on npm, and is archived after the deprecations.
