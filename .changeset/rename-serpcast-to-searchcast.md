---
'searchcast': minor
---

searchcast 0.2.0 is serpcast renamed. It replaces the browser runner published as searchcast 0.1.x, which is now `@searchcast/browser`; `searchcast serve` keeps its flags and behaviour. Library users of searchcast 0.1.x import `@searchcast/browser` instead (`npm install @searchcast/browser`), and library-mode browser engines now need `@searchcast/browser` (the optional peer dependency, `npm install @searchcast/browser`) instead of `searchcast`.

Users of serpcast: install `searchcast` instead of `serpcast` (0.6.0 is the last serpcast feature release; `serpcast` is deprecated). Every command and API is there under the new names, and the old ones keep working for one release (0.2.x):

- The bin is `searchcast` (`searchcast query`, `install-libcurl`, `install-recipes`, `recipes list`, `doctor`), with the same options, output and exit codes; messages start with `searchcast:`. There is no `serpcast` bin in this package.
- The API is renamed: `createSearchcast`, `Searchcast`, `SearchcastOptions`, `SearchcastError` (its `name` is now `SearchcastError`), `SearchcastErrorKind`; the entry for embedders is `searchcast/install`. `createSerpcast`, `Serpcast`, `SerpcastOptions`, `SerpcastError` and `SerpcastErrorKind` stay exported as deprecated aliases of the same values and types (`instanceof SerpcastError` still works).
- The library is looked up in the `libcurlPath` option, `SEARCHCAST_LIBCURL_PATH`, then the old `SERPCAST_LIBCURL_PATH`, `LIBCURL_PATH`, the data directory and serpcast's old data directory.
- The data directory is `$XDG_DATA_HOME/searchcast` (default `~/.local/share/searchcast`): `install-libcurl` and `install-recipes` write only there. The library and recipe sets are still read from `$XDG_DATA_HOME/serpcast` when the new directory lacks them (a set in the new directory wins; the new `recipeSetDir(name)` finds a set in either, and `recipes list` shows both). Nothing moves your files: `searchcast doctor` says what is read from the old directory and prints the `mv` command that moves it. New exports `oldDataDir`, `oldDataDirHits` (also from `searchcast/install`, with `recipeSetDir` and `formatInstalledRecipeSets`) let an embedder show the same notice, and the doctor report gains `oldDataDir`.
- The state-store key `serpcast/sessions` is unchanged, so stored sessions are kept.

The old names, the old environment variable and the old data directory are no longer read from the next minor after 0.2.x.
