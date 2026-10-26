# README LOC table is stale (2026-09-29)

Noticed while doing `post-requests`: the "Size discipline (per-module LOC)" table in `README.md` no longer matches the sources (before that task, `src/transport.ts` was listed at 280 LOC with a 300 target but had 496 lines; `src/chrome.ts` 122 vs 252; `src/serpcast.ts` 243 vs 393; `src/libcurl.ts` 272 vs 313), and several modules are over their `target`. `post-requests` updated only the rows it touched; the rest needs a pass (and a decision on whether the targets still hold).

## Update (2026-10-24)

The rows this note cites are now right, and so is `src/ipfs.ts` (the separate ipfs note was deleted). Rows still off: `src/index.ts` 39 vs 168, `src/download.ts` 290 vs 293, `src/recipe-archive.ts` 167 vs 199, `src/browser-cli.ts` 64 vs 102 (the `index.ts` row may be ambiguous between packages).
