# searchcast

## 0.1.2

### Patch Changes

- 4cba09e: Never start two browsers on one profile. `serve --idle-exit` started its idle clock before the browser warmup, so a browser slower to start than the idle timeout (Google Chrome on a CI runner) made the server stop before it served, and the next search launched a second browser on a profile the closing one still held, which Chrome refuses ("Failed to create a ProcessSingleton", HTTP 503). The idle clock of `createSearchcastServer` now starts when the server listens, `Searchcast` waits for a closed or dead browser's process to exit before launching the next one, and `Browser.close()` resolves only once the process has exited.
- e0bd0fc: Validate recipes with `serpcast-recipe`, the recipe schema shared with serpcast, instead of searchcast's own copy. One recipe file now describes a site for both runners. Behaviour is unchanged: the same recipes are accepted with the same error messages, and `Recipe`, `RecipeError`, `parseRecipe`, `loadRecipeFile` and `loadRecipes` are still exported from `searchcast`.

## 0.1.1

### Patch Changes

- bce0a63: Talk to the browser over `--remote-debugging-pipe` instead of a loopback TCP DevTools port. searchcast now works for a user that cannot use loopback TCP (it failed to start in a Tor-forced account), and no other process on the machine can reach the browser it drives through an open debugging port.

## 0.1.0

### Minor Changes

- ebbc49c: First release: `searchcast serve` and `searchcast query`, JSON recipes (navigate or form mode, ready, empty, blocked selectors and URL patterns, result fields), and an HTTP API that reports blocks and timeouts as explicit errors, never as empty results. Runs on-demand under systemd socket activation (`--listen systemd`, `--idle-exit`), with an ephemeral profile (`--ephemeral`) and its own private Xvfb display (`--xvfb`), and ships a SearXNG engine that queries it over a unix socket.
