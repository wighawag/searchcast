# The recipe schema lives in serpcast-recipe, MIT, and searchcast depends on it

## Status

accepted

One recipe file should describe a site for both runners: serpcast (over HTTP) and searchcast (in a real browser). So the schema, its types and its validator live in one zero-dependency package, `serpcast-recipe`, which both depend on, instead of two copies that drift. It is MIT while the rest of the repo is AGPL-3.0-only, so projects under any license can share the format; it contains only the schema and validation, no scraping logic. Its meaning starts as an exact extraction of searchcast's existing recipe format, so existing recipes stay valid; a feature one runner cannot honour (for example `form` over HTTP) is rejected by that runner with a clear error, not silently ignored.

## Considered Options

- **Copy the schema into serpcast**: rejected, the two copies would drift.
- **Schema package inside the searchcast repo**: rejected, searchcast is a single package with a zero-dependency identity; the monorepo here already has the publishing setup.
