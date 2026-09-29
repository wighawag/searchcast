---
'searchcast': patch
---

Never start two browsers on one profile. `serve --idle-exit` started its idle clock before the browser warmup, so a browser slower to start than the idle timeout (Google Chrome on a CI runner) made the server stop before it served, and the next search launched a second browser on a profile the closing one still held, which Chrome refuses ("Failed to create a ProcessSingleton", HTTP 503). The idle clock of `createSearchcastServer` now starts when the server listens, `Searchcast` waits for a closed or dead browser's process to exit before launching the next one, and `Browser.close()` resolves only once the process has exited.
