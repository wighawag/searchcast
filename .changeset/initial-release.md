---
'searchcast': minor
---

First release: `searchcast serve` and `searchcast query`, JSON recipes (navigate or form mode, ready, empty, blocked selectors and URL patterns, result fields), and an HTTP API that reports blocks and timeouts as explicit errors, never as empty results. Runs on-demand under systemd socket activation (`--listen systemd`, `--idle-exit`), with an ephemeral profile (`--ephemeral`) and its own private Xvfb display (`--xvfb`), and ships a SearXNG engine that queries it over a unix socket.
