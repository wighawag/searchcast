# searchcast

Turn a web search form into a JSON API by driving a real browser.

You describe a site in a small JSON **recipe**: how to get a query in (a URL template, or an input to type into and a way to submit), which element means the results are ready, which elements mean a challenge page, and how to read each result out. searchcast keeps one long-lived Chromium with a persistent profile, runs each query in its own tab, and returns the results as JSON.

It talks to Chromium over the DevTools protocol directly, with no automation framework and no runtime dependencies.

## Install

```sh
npm install -g searchcast
```

Requires Node 22+ and a Chromium or Chrome executable (`--chrome`, `$SEARCHCAST_CHROME`, or `chromium`/`chrome` on `PATH`).

## Use

One-shot, to develop a recipe:

```sh
searchcast query --recipe ./recipes/web.json "some query"
```

As a service:

```sh
searchcast serve --recipes ./recipes --listen 127.0.0.1:8931 --proxy socks5://127.0.0.1:1080
curl 'http://127.0.0.1:8931/search?recipe=web&q=some+query'
```

The browser runs headful by default. On a server without a display, pass `--xvfb $(command -v Xvfb)`: searchcast starts a private virtual display for it (authenticated with a fresh cookie, no TCP or abstract socket). `--headless` works too, but is easier for sites to tell apart from a person.

| Option                  | Default                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `--listen <where>`      | `127.0.0.1:8931`; also `/path.sock`, or `systemd` for a socket passed by systemd socket activation |
| `--idle-exit <seconds>` | never; exit after this long with no request in flight                                              |
| `--chrome <path>`       | `$SEARCHCAST_CHROME`, then `PATH`                                                                  |
| `--profile <dir>`       | `$XDG_STATE_HOME/searchcast/profile`                                                               |
| `--ephemeral`           | off; use a fresh profile in a temporary directory, deleted on exit                                 |
| `--xvfb <path>`         | none; run the browser on its own Xvfb display                                                      |
| `--proxy <url>`         | none                                                                                               |
| `--concurrency <n>`     | `2` tabs                                                                                           |
| `--chrome-arg <arg>`    | extra browser argument, repeatable                                                                 |

The browser only loads the pages it is asked for: background networking, component updates, sync and pings are off.

### On demand, with systemd

`--listen systemd` and `--idle-exit` together make an instance that costs nothing until used: a `.socket` unit holds the listening socket, the first connection starts the service, and it exits after the idle period, to be started again by the next connection.

```ini
# searchcast.socket
[Socket]
ListenStream=/run/searchcast/searchcast.sock

# searchcast.service
[Service]
ExecStart=/usr/bin/searchcast serve --listen systemd --idle-exit 600 --ephemeral --xvfb /usr/bin/Xvfb --recipes /etc/searchcast/recipes
PrivateTmp=true
```

## HTTP API

- `GET /search?q=<query>&recipe=<name>`: `recipe` may be omitted when only one is loaded. Returns `{recipe, query, results: [{title, url, ...}], elapsedMs}`.
- `GET /recipes`: `{recipes: [names]}`.
- `GET /health`: `{ok: true}`.

A failure is never an empty result list. It is an error status with `{error, message}`:

| `error`   | Status | Meaning                                                          |
| --------- | ------ | ---------------------------------------------------------------- |
| `blocked` | 502    | a `blocked` selector or `blockedUrl` pattern matched             |
| `recipe`  | 502    | the page does not match the recipe (e.g. submit element missing) |
| `timeout` | 504    | neither `ready` nor `empty` appeared within `timeoutMs`          |
| `browser` | 503    | the browser could not be started or reached                      |

An empty list only comes back when the recipe's `empty` selector matched.

## Recipes

A recipe is a JSON file. When loading a directory, each `*.json` file is one recipe, named by its `name` field or else its file name.

```json
{
	"name": "web",
	"navigate": {"url": "https://search.example/?q={query}"},
	"ready": "article.result a.title",
	"empty": ".no-results",
	"blocked": ["#captcha", ".challenge"],
	"blockedUrl": ["/challenge"],
	"results": {
		"item": "article.result",
		"fields": {
			"title": {"selector": "a.title"},
			"url": {"selector": "a.title", "attr": "href"},
			"content": {"selector": ".snippet"}
		}
	},
	"limit": 10,
	"timeoutMs": 15000
}
```

| Field            | Meaning                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigate.url`   | URL template; `{query}` becomes the URL-encoded query.                                                                                                                                                                                                                                |
| `form`           | Instead of `navigate`: `{"url", "input", "submit"}`. Loads `url`, clicks `input`, replaces its value by typing the query key by key, then submits. `submit` is `"enter"` (default) or `{"click": "<selector>"}`.                                                                      |
| `ready`          | Selector that means results are rendered.                                                                                                                                                                                                                                             |
| `empty`          | Optional selector that means the site found nothing.                                                                                                                                                                                                                                  |
| `blocked`        | Optional selectors that mean a challenge or block page.                                                                                                                                                                                                                               |
| `blockedUrl`     | Optional regular expressions over the page URL that mean blocked.                                                                                                                                                                                                                     |
| `results.item`   | Selector for each result.                                                                                                                                                                                                                                                             |
| `results.fields` | Field name to `{selector?, attr?}`. `selector` is relative to the item (omitted: the item itself). `attr` omitted reads visible text; `href` and `src` resolve to absolute URLs. `title` and `url` are required; results missing either are skipped. Other fields are passed through. |
| `limit`          | Maximum results, default 10.                                                                                                                                                                                                                                                          |
| `timeoutMs`      | Per-query budget, default 15000.                                                                                                                                                                                                                                                      |

Exactly one of `navigate` and `form` must be set.

## SearXNG

`integrations/searxng/searchcast.py` (shipped in the package) is a SearXNG engine that queries a searchcast socket, so searchcast results merge with SearXNG's other engines. SearXNG loads it from an absolute path, so nothing is copied into SearXNG itself:

```yaml
engines:
  - name: searchcast-web
    engine: /path/to/node_modules/searchcast/integrations/searxng/searchcast
    shortcut: scw
    socket_path: /run/searchcast/searchcast.sock
    recipe: web
    timeout: 15.0
```

`socket_path` may reference environment variables (`$VAR`), so one settings file can serve several instances. A `blocked` answer raises SearXNG's CAPTCHA exception and any other failure an API exception, so both appear in `unresponsive_engines` rather than as missing results.

## Library

```ts
import {Searchcast, loadRecipeFile} from 'searchcast';

const searchcast = new Searchcast({
	browser: {executable: '/usr/bin/chromium', userDataDir: './profile'},
});
const {results} = await searchcast.search(
	loadRecipeFile('./recipes/web.json'),
	'some query',
);
await searchcast.close();
```

## Develop

```sh
pnpm install
pnpm build
SEARCHCAST_CHROME=/path/to/chromium pnpm test
```

The browser tests run against a local fixture site and are skipped when no browser is found.

## License

AGPL-3.0-only
