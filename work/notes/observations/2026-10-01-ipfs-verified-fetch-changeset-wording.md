# The pending ipfs-verified-fetch changeset says "no command or API changes in this release"

2026-10-01, noticed while building install-recipes-from-ipfs. `.changeset/ipfs-verified-fetch.md` (a patch) ends with "no command or API changes in this release", but it will very likely ship in the same release as `.changeset/install-recipes-from-ipfs.md` (a minor that adds `install-recipes ipfs://`), so the combined changelog would contradict itself. Consider rewording or dropping that sentence before the Version Packages PR.
