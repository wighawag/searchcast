---
'searchcast': patch
---

searchcast now depends on four pure-JS IPFS libraries (`multiformats`, `@ipld/car`, `@ipld/dag-pb`, `ipfs-unixfs`, about 5 MB installed with their own dependencies, no native code and no install scripts), for an internal verified fetch of IPFS content from trustless gateways that `install-recipes` will use for `ipfs://` sources. Nothing reaches them from the main entry, and no command or API changes in this release.
