---
title: Changesets release workflow publishing both packages via npm Trusted Publishing (OIDC)
slug: release-workflow-oidc
spec: serpcast
humanOnly: true
blockedBy: [scaffold-monorepo]
covers: [24]
---

## What to build

The release pipeline: changesets configured for the two packages (independent versions), and a GitHub Actions `release.yml` that opens or updates a "Version Packages" PR from pending changesets and, when that PR is merged, runs `changeset publish` authenticating through npm Trusted Publishing (OIDC, `id-token: write`, Node 24, provenance, no `NPM_TOKEN`). The trusted publishers are already registered on npm for both `serpcast` and `serpcast-recipe` (repo `wighawag/serpcast`, workflow `release.yml`), so the workflow file name must be exactly `release.yml`.

## Acceptance criteria

- [ ] `.changeset/config.json` exists; `pnpm changeset` works locally.
- [ ] `.github/workflows/release.yml` mirrors searchcast's (`.github/workflows/release.yml` in https://github.com/wighawag/searchcast): push to main plus `workflow_dispatch`, non-cancelling concurrency, `contents`/`pull-requests`/`id-token` write, `changesets/action` with `publish: pnpm release:ci` and `version: pnpm changeset version`.
- [ ] Root `release:ci` script builds, format-checks and runs `changeset publish`.
- [ ] `serpcast-recipe` publishes as MIT and `serpcast` as AGPL-3.0-only; `publishConfig.provenance` or equivalent is set.
- [ ] A first changeset exists that will produce `0.1.0` for both packages (merge it only when the code is ready to release).

## Blocked by

- scaffold-monorepo

## Prompt

Goal: tokenless, provenance-stamped releases for both packages. Copy searchcast's release workflow and comments, adapt to a two-package workspace. `humanOnly` because it is the release pipeline: a human builds and merges it, and decides when the first changeset lands.

FIRST, check this task against current reality (launch snapshot; may have drifted).
