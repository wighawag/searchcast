---
'searchcast': patch
---

searchcast now depends on four pure-JS IPFS libraries (`multiformats`, `@ipld/car`, `@ipld/dag-pb`, `ipfs-unixfs`, about 5 MB installed with their own dependencies, no native code and no install scripts), for the verified fetch of IPFS content from trustless gateways behind `install-recipes ipfs://`. Nothing reaches them from the main entry.
