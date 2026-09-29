---
title: Fix the CI failure of the unix-socket ephemeral-profile CLI test (Chrome aborts on an existing SingletonLock)
slug: fix-ci-ephemeral-socket-singleton-lock
blockedBy: []
covers: []
---

## What to build

`test/cli.test.ts` > "the CLI > serves a unix socket with an ephemeral profile, then exits when idle and deletes the profile" has failed in GitHub Actions on every `main` run since at least `Version Packages (#2)` (observation `work/notes/observations/ci-unix-socket-cli-test-503.md`, which this task resolves and deletes). It passes locally with Playwright's Chromium 1234. A diagnostic CI run (2026-09-29, `/usr/bin/google-chrome` with `--no-sandbox`, `TMPDIR` set to a fresh temp dir) printed the 503 body:

```
{"error":"browser","message":"browser exited with code 21
ERROR:chrome/browser/process_singleton_posix.cc:347] Failed to create /tmp/searchcast-cli-ODreoW/tmp-k2JeMR/searchcast-profile-hOO074/SingletonLock: File exists (17)
ERROR:chrome/app/chrome_main_delegate.cc:550] Failed to create a ProcessSingleton for your profile directory. ... Aborting now to avoid profile corruption."}
```

So a browser was started on a brand-new ephemeral profile that already held a `SingletonLock`: most likely a second launch on the same profile while the first browser (or a process spawned by Google Chrome's wrapper) still owns it, for example a relaunch after the first launch was judged dead, or an eager launch at `serve` time plus another on the first search. Find the real cause in `src/searchcast.ts` / `src/browser.ts` / `src/cli.ts` (the launch, liveness and relaunch paths, and how `--ephemeral` creates the profile) and fix it in the product code if it is a searchcast bug (two browsers must never share a profile), or in the test if it is a test artifact. Record which.

## Acceptance criteria

- [ ] The root cause is identified and recorded (in the done record), with the evidence above.
- [ ] The fix makes the test pass in GitHub Actions (Google Chrome, `--no-sandbox`); the test still passes locally with Chromium.
- [ ] On failure, the socket test's assertion message includes the response body, so a future CI failure is diagnosable from the log.
- [ ] If product code changes, a changeset (patch) is added and a regression test covers the launch path that caused a second browser on one profile, runnable without Chrome if possible.
- [ ] The observation note is deleted.

## Blocked by

- None, can start immediately.

## Prompt

Goal: a green CI and never two browsers on one profile. Local reproduction: `SEARCHCAST_CHROME=$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome pnpm test` runs the browser tests (they pass locally, so reason from the CI evidence and Google Chrome's launcher behaviour, `/usr/bin/google-chrome` being a wrapper script around `/opt/google/chrome/chrome`). FIRST, check this task against current reality. RECORD non-obvious decisions.

## Decisions

- **The fix is in product code, not the test.** Why: the premature idle shutdown and the second browser on one profile are real bugs that any slow-starting Chrome can trigger, for example `serve --idle-exit` under systemd socket activation. Changing the test (a longer `--idle-exit`) would only have hidden them. Touches: `serve --idle-exit`, `createSearchcastServer`, `Searchcast`, `Browser`.
- **The idle clock of `createSearchcastServer` now starts at `listening`, not at creation.** This changes an exported, documented behaviour (the `ServerOptions.idleMs` doc was updated). A server nobody talks to still goes idle. Alternative considered: only reorder `cli.ts` so the server is created after warmup. Rejected because the library would keep the trap for other callers. Touches: `serve --idle-exit`, and the doc of the exported `ServerOptions.idleMs`.
- **"Never two browsers" is enforced by making launches wait, not by making `close()` final.** After `close()`, a later search or warmup still starts a new browser, as before, but only once the previous process has exited. Alternative considered: a closed `Searchcast` refuses further searches. Rejected because that adds a new error to the public API. Touches: the `Searchcast.close()` contract, which now resolves only once the browser has exited, and concurrent `close()` calls now wait too.
- **`Browser.close()` waits for the process to exit, including after its SIGKILL fallback, with no timeout after SIGKILL.** A killed process only frees its profile once it is gone. A process stuck in uninterruptible sleep would make `close()` hang, which I accepted.
- **The regression tests use a fake browser (`test/fake-browser.mjs`) rather than a real one.** This meets "runnable without Chrome", and a shell wrapper runs it the way `/usr/bin/google-chrome` runs Chrome. It is not an exact model of Chrome: it only implements `Browser.getVersion` and `Browser.close`, and a crude stale-lock takeover.
