# @searchcast/libcurl-win32-x64

## 0.1.0

### Minor Changes

- 7e95404: First release. Each package holds only the pinned libcurl-impersonate 2.1.1 shared library for its platform (`libcurl-impersonate.so`, `.dylib` or `.dll`), taken unmodified from the upstream release archive pinned in `searchcast`'s source after verifying its sha256, with the license texts of the library's components. It is an optional dependency of `searchcast`, installed with it on its platform (`os`, `cpu`, and `libc: glibc` on Linux); it has no install script and nothing to import.
