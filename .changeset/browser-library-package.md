---
'@searchcast/browser': minor
---

First release under the new name `@searchcast/browser`: the browser runner published as `searchcast` 0.1.x, now a library with no bin. The main entry exports exactly what `searchcast` 0.1.2 exported (`Searchcast`, `SearchcastError`, `Browser`, `Page`, `findChrome`, `CdpConnection`, `startXvfb`, `createSearchcastServer`, the recipe re-exports and their types), unchanged. The command line moved to the `./cli` entry as `runCli(argv)`, which the `searchcast` package's `searchcast serve` and `searchcast browser-query` call with the same flags, defaults, messages, exit codes and systemd socket activation as the 0.1.x `searchcast serve` and `searchcast query`.
