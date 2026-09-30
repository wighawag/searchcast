# serpcast renamed to searchcast; browser runner becomes @searchcast/browser

## Status

accepted (2026-09-30). ADRs 0001 to 0004 and the notes under `work/` keep their original wording as history: read "serpcast" there as today's `searchcast`, "serpcast-recipe" as `@searchcast/recipe`, and "searchcast" (the browser runner) as `@searchcast/browser`.

Two repos shipped one product: serpcast (HTTP over libcurl-impersonate, engine chain, recipes) and searchcast (the real-browser runner that serpcast falls back to). They are now one monorepo, `wighawag/searchcast`, released by its one `release.yml` (changesets, npm trusted publishing, provenance), and the product takes the shorter, already-owned name: `searchcast` is what serpcast was, the browser runner becomes the library `@searchcast/browser`, and the recipe schema becomes `@searchcast/recipe`. serpcast's history was merged in (`git merge --allow-unrelated-histories`) and the browser runner's root code moved to `packages/browser` with `git mv`, so `git log --follow` works on both sides.

## The renames

| Before | After | Fallback, for one release (0.2.x) |
| --- | --- | --- |
| npm `serpcast` 0.6.x | npm `searchcast` 0.2.0 (0.1.x was the browser runner) | `serpcast` gets one last minor that says "moved", then is deprecated |
| npm `serpcast-recipe` 0.2.x | npm `@searchcast/recipe` 0.1.0 (MIT, zero dependencies) | same as above |
| npm `searchcast` 0.1.x (browser runner, bin `searchcast`) | npm `@searchcast/browser` 0.1.0, a library with no bin | none: `searchcast serve` keeps working, see below |
| bin `serpcast` | bin `searchcast`, every serpcast command, plus `serve` | none (the old package keeps its bin until deprecated) |
| bin `searchcast serve` / `searchcast query` (browser) | `searchcast serve` and `searchcast browser-query`, same flags and behaviour, delegating to `@searchcast/browser` (optional peer); `searchcast query` is now serpcast's HTTP query | none: `query` could not keep both meanings |
| `integrations/searxng/searchcast.py` at the package root | same path, shipped in the `searchcast` package | none needed: the path is unchanged |
| env `SERPCAST_LIBCURL_PATH` | env `SEARCHCAST_LIBCURL_PATH` | `SERPCAST_LIBCURL_PATH` and `LIBCURL_PATH` are still read, after the new name |
| data dir `$XDG_DATA_HOME/serpcast/` | `$XDG_DATA_HOME/searchcast/` | the old directory is read when the new one lacks the file; `doctor` says so. Files are never moved except by a command the user runs |
| `SerpcastError`, `createSerpcast`, `Serpcast`, `SerpcastOptions`, `SerpcastErrorKind` | `SearchcastError`, `createSearchcast`, `Searchcast`, `SearchcastOptions`, `SearchcastErrorKind` | the old names stay exported as deprecated aliases |
| test-only env `SERPCAST_TEST_*` | `SEARCHCAST_TEST_*` | none (tests only) |
| (new) | `@searchcast/libcurl-<os>-<arch>`: the pinned libcurl-impersonate per platform, optionalDependencies of `searchcast` | `searchcast install-libcurl` stays for skipped optional dependencies and unsupported platforms |

Not renamed, on purpose: the state-store key `serpcast/sessions` (an internal namespace inside a store the caller owns; renaming it would silently drop every stored session for no user-visible gain), and the browser library's own API names (`Searchcast`, `SearchcastError` in `@searchcast/browser` are a different class from the HTTP package's `SearchcastError`, which has `kind`, not `code`; the two packages are imported under their own names).

## Considered Options

- **Keep two repos, rename nothing**: two release pipelines and two names for one product; the browser runner and the chain that uses it drift.
- **Rename the browser runner's package only and keep `serpcast`**: keeps the worse name for the main package and still two repos.
- **Keep the browser runner as `searchcast` and name the HTTP package something else**: the HTTP runner is the product (the browser is its fallback), and it deserves the short name.
- **Move the user's data directory automatically**: rejected; nothing touches the user's files without a command they run (ADR 0002).

## Consequences

- `searchcast` 0.2.0 is a breaking release for users of 0.1.x (the browser runner): the library moved to `@searchcast/browser`, and the browser one-shot query is now `searchcast browser-query` (`searchcast query` is the HTTP query). `searchcast serve` works unchanged once `@searchcast/browser` is installed next to it.
- `searchcast` has runtime dependencies (koffi and the HTML parser), which a packager that copied the 0.1.x tarball without dependencies must now install.
- The one-release fallbacks (old env name, old data directory, old API names) are removed in the next minor after 0.2.x.
- The platform packages carry a native library built in CI from the pinned upstream archives, verified against the sha256 pins in the source; no runtime download is ever added (ADR 0002).
