---
'searchcast': patch
---

`install-recipes ipfs://` (and `DEFAULT_IPFS_GATEWAYS` in `searchcast/install`) now defaults to four trustless gateways on independent operators, in order `https://trustless-gateway.link`, `https://gateway.pinata.cloud`, `https://ipfs.filebase.io` and `https://4everland.io`, so one operator's bad day no longer fails the install. When every gateway fails, the error now ends with how to choose others: `--ipfs-gateway <url>` (repeatable; `ipfsGateways` in the API), for example your own node's gateway at `http://127.0.0.1:8080`.
