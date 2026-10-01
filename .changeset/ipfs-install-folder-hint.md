---
'searchcast': patch
---

`install-recipes ipfs://` refuses a directory that cannot be a recipe set (such as a release folder's root, holding the archive and the unpacked set side by side) from its listing alone, after one small `dag-scope=entity` request and before any file is downloaded, and its message lists the directory's entries and the `ipfs://` commands to use instead (the archive, keeping a given `--sha256`, and the set directory). A set directory is now fetched in two requests (its listing, then its files); an archive is still one. A gateway that ignores `dag-scope=entity` and sends the whole DAG is accepted, without a second request.
