> Names changed since this was written, see [ADR 0005](0005-serpcast-renamed-to-searchcast-browser-runner-becomes-searchcast-browser.md): read "serpcast" here as `searchcast`, "serpcast-recipe" as `@searchcast/recipe`, and "searchcast" (the browser runner) as `@searchcast/browser`.
# serpcast is policy-free: the caller injects egress, state and recipes

## Status

accepted

serpcast is not an anonymity tool, but anonymity tools (webveil) build on it, so it follows mechanism-not-policy, the same split webveil uses with distilly (webveil ADR 0001). The caller injects the proxy, the state store and the recipe set; serpcast never makes a network call the caller did not cause (no library download, no update check, no telemetry), never writes to disk unless handed a store that does, never scans for recipes on its own, and in strict mode (the default) refuses to run when impersonation is not provably active. Anything that is a privacy decision (which proxy, how state is partitioned per identity, which code recipes are trusted) belongs to the caller.

## Consequences

- The default state store is in-memory; serpcast ships no file store.
- One exception: searchcast's library requires a browser profile directory, so when the caller gives none, serpcast creates a private temporary one and deletes it on close and on process exit.
- Code recipes receive only a context (impersonated HTTP client, session, signal, helpers). A JS module can still import anything, so which modules are loaded is a trust decision the caller makes.
- Installing libcurl-impersonate is an explicit, user-invoked command, never a side effect of first use.
