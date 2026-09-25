# searchcast

## 0.1.1

### Patch Changes

- bce0a63: Talk to the browser over `--remote-debugging-pipe` instead of a loopback TCP DevTools port. searchcast now works for a user that cannot use loopback TCP (it failed to start in a Tor-forced account), and no other process on the machine can reach the browser it drives through an open debugging port.

## 0.1.0

### Minor Changes

- ebbc49c: First release: `searchcast serve` and `searchcast query`, JSON recipes (navigate or form mode, ready, empty, blocked selectors and URL patterns, result fields), and an HTTP API that reports blocks and timeouts as explicit errors, never as empty results. Runs on-demand under systemd socket activation (`--listen systemd`, `--idle-exit`), with an ephemeral profile (`--ephemeral`) and its own private Xvfb display (`--xvfb`), and ships a SearXNG engine that queries it over a unix socket.
