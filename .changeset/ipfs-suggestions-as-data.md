---
'searchcast': patch
---

`InstallError` gains an optional `suggestions` (the new exported type `InstallSuggestion`, `{source, kind: 'archive' | 'set-directory', sha256?}`), set when `install-recipes ipfs://` refuses a directory that is not a recipe set: the same `ipfs://` sources as its message's "Try:" list, in the same order, so an embedder (through `searchcast/install`) can print its own command instead of `searchcast install-recipes`. The message is unchanged.
