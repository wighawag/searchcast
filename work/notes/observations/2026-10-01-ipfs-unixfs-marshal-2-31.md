# ipfs-unixfs 13.1.2 cannot round-trip a block size of exactly 2^31

2026-10-01, seen while writing `packages/searchcast/test/ipfs.test.ts` (task ipfs-verified-fetch): `UnixFS.unmarshal(new UnixFS({type: 'file', blockSizes: [2n ** 31n]}).marshal())` throws "index out of range" (2^20, 2^32 and 2^50 round-trip fine), so the marshal side (protons-runtime 8.0.1 varint) encodes that value wrongly. searchcast only unmarshals (gateway-built DAGs), and its tests keep block sizes below 2^31, so nothing here depends on it; worth an upstream report if a test ever builds such a DAG.
