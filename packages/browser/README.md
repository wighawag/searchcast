# @searchcast/browser

The real-browser runner of [searchcast](https://github.com/wighawag/searchcast), as a library: turn a web search form into a JSON API by driving a real browser.

You describe a site in a small JSON **recipe**: how to get a query in (a URL template, or an input to type into and a way to submit), which element means the results are ready, which elements mean a challenge page, and how to read each result out. `Searchcast` keeps one long-lived Chromium with a persistent profile, runs each query in its own tab, and returns the results as JSON.

It talks to Chromium over the DevTools protocol directly, with no automation framework. Its one runtime dependency is [`@searchcast/recipe`](https://github.com/wighawag/searchcast/tree/main/packages/recipe), the recipe schema it shares with `searchcast`'s HTTP runner.

Formerly the `searchcast` package 0.1.x (same API, same names). The command line is now `searchcast serve` and `searchcast browser-query` from the [`searchcast`](https://github.com/wighawag/searchcast) package, which runs this package's `./cli` entry.

## Install

```sh
npm install @searchcast/browser
```

Requires Node 22+ and a Chromium or Chrome executable (`$SEARCHCAST_CHROME`, or `chromium`/`chrome` on `PATH`; `findChrome()` looks there).

## Use

```ts
import {Searchcast, findChrome, loadRecipeFile} from '@searchcast/browser';

const searchcast = new Searchcast({
	browser: {executable: findChrome()!, userDataDir: './profile'},
});
const {results} = await searchcast.search(
	loadRecipeFile('./recipes/web.json'),
	'some query',
);
await searchcast.close();
```

A failure is never an empty result list: `search` rejects with a `SearchcastError` whose `code` is `blocked` (a `blocked` selector or `blockedUrl` pattern matched), `recipe` (the page does not match the recipe), `timeout` (neither `ready` nor `empty` appeared within `timeoutMs`) or `browser` (the browser could not be started or reached). An empty list only comes back when the recipe's `empty` selector matched.

The browser runs headful by default. On a server without a display, `startXvfb({executable})` starts a private virtual display for it (authenticated with a fresh cookie, no TCP or abstract socket); pass its `env` as the browser's `env`. `headless: true` works too, but is easier for sites to tell apart from a person. The browser only loads the pages it is asked for: background networking, component updates, sync and pings are off.

The main entry also exports `Browser`, `Page` and `CdpConnection` (the DevTools layer), `createSearchcastServer` (the HTTP API, as a Node `http.Server`), and the recipe helpers `parseRecipe`, `loadRecipeFile`, `loadRecipes` and `RecipeError`.

## HTTP API

`createSearchcastServer(searchcast, recipes)` serves `GET /search`, `GET /recipes` and `GET /health`, the API that `searchcast serve` serves: see [its HTTP API](https://github.com/wighawag/searchcast#http-api) in the searchcast README.

## Recipes

The recipe format and its validator are the [`@searchcast/recipe`](https://github.com/wighawag/searchcast/tree/main/packages/recipe) package: see its README for every field. The same recipe file describes a site for this browser runner and for `searchcast`'s HTTP runner (which runs `navigate` recipes only; `form` recipes need a real browser). When loading a directory, each `*.json` file is one recipe, named by its `name` field or else its file name.

## The `./cli` entry

```ts
import {runCli} from '@searchcast/browser/cli';

await runCli(['serve', '--recipes', './recipes', '--listen', '127.0.0.1:8931']);
```

`runCli(argv)` is the command line that the `searchcast` 0.1.x bin ran, as a function: `searchcast serve` and `searchcast browser-query` (the one-shot query that 0.1.x called `searchcast query`) from the `searchcast` package call it with their arguments unchanged. It writes errors as `searchcast: <message>` and exits the process with code 2 on a usage error; `serve` exits with 0 on SIGINT, SIGTERM or `--idle-exit`. Nothing runs on import.

To run it as a service, install `searchcast` and `@searchcast/browser` side by side (`npm install -g searchcast @searchcast/browser`). The flags, the systemd socket activation example, the HTTP API and the SearXNG engine (shipped in the `searchcast` package at `integrations/searxng/searchcast.py`) are documented in the searchcast README: [Serving from a real browser (`searchcast serve`)](https://github.com/wighawag/searchcast#serving-from-a-real-browser-searchcast-serve).

## Develop

```sh
pnpm install
pnpm build
SEARCHCAST_CHROME=/path/to/chromium pnpm test
```

The browser tests run against a local fixture site and are skipped when no browser is found. The end-to-end tests of `searchcast serve` and `searchcast browser-query` (which run this package through the `searchcast` bin) are in `packages/searchcast`.

## License

AGPL-3.0-only
