---
'searchcast': minor
---

`searchcast serve` and `searchcast browser-query` are back on the `searchcast` bin, with searchcast 0.1.x's flags, defaults, messages and exit codes (`--listen host:port|/path.sock|systemd`, `--idle-exit`, `--xvfb`, `--ephemeral`, `--profile`, `--proxy`, `--headless`, `--concurrency`, `--chrome-arg=`). They run the browser runner from `@searchcast/browser`, the optional peer dependency, so after upgrading from searchcast 0.1.x install it next to `searchcast` (`npm install -g searchcast @searchcast/browser`) and existing systemd units work unchanged; without it, both commands exit with code 1 and one line naming the package and the install command. `browser-query` is 0.1.x's browser `searchcast query` (`searchcast query` is now the HTTP query). Neither command loads koffi or libcurl-impersonate. `searchcast --help` lists both.

The SearXNG engine ships in the `searchcast` package again, at the same path as in 0.1.x: `integrations/searxng/searchcast.py`.
