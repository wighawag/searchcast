# @searchcast/libcurl-linux-arm64

The pinned [libcurl-impersonate](https://github.com/lexiforest/curl-impersonate) shared library for Linux arm64 (glibc), for [searchcast](https://github.com/wighawag/searchcast/tree/main/packages/searchcast). You do not install this package yourself: it is an optional dependency of `searchcast`, so `npm install searchcast` installs it on Linux arm64 (glibc) and skips it everywhere else. searchcast finds it with no setting and no download at run time; `searchcast doctor` names it as the library's source.

- Contents: `libcurl-impersonate.so` (the library, the one file of libcurl-impersonate 2.1.1 searchcast loads), `LICENSE` (the license texts of the library and of what it links statically), this README and `package.json`. There is no install script.
- Upstream: libcurl-impersonate 2.1.1, the release archive `libcurl-impersonate-v2.1.1.aarch64-linux-gnu.tar.gz` of https://github.com/lexiforest/curl-impersonate/releases/tag/v2.1.1.
- How it is built: in this repo's release workflow, from the archive pinned in searchcast's source (`LIBCURL_IMPERSONATE` in [`packages/searchcast/src/libcurl.ts`](https://github.com/wighawag/searchcast/blob/main/packages/searchcast/src/libcurl.ts)), whose sha256 is verified against the pin before it is unpacked; the library is taken out of it unmodified (`scripts/libcurl-packages.mjs`). The package is published with npm provenance, so npm shows the workflow run that built it.
- Versions: each `searchcast` release depends on the exact version of this package it was released with.
- On a platform without a package, or when optional dependencies are skipped, use `searchcast install-libcurl` instead (see searchcast's README).

License: `MIT AND curl AND Apache-2.0 AND BSD-3-Clause AND Zlib AND (LGPL-3.0-or-later OR GPL-2.0-or-later) AND Unicode-DFS-2016` (the library's components; see `LICENSE` for each text and where the source is).
