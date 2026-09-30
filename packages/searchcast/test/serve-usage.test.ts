// `searchcast serve` and `searchcast browser-query` through the real bin (the
// built dist/cli.js), which delegates them to `@searchcast/browser`'s `./cli`
// entry with the arguments unchanged. These need no browser: every case here
// fails or answers before one is started (the end-to-end cases are in
// serve.test.ts). The usage text and messages are searchcast 0.1.2's, except
// the one-shot query line, now spelled `browser-query`.
//
// Every run hides koffi (test/hide-modules.mjs) and asserts it was never even
// asked for: a machine running only the browser server needs neither koffi
// nor the libcurl-impersonate library it loads. Options may also come before
// the command (`searchcast --ephemeral serve ...`), as searchcast 0.1.2
// accepted; HTTP commands with options first are unaffected.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {usage} from '../src/index.js';

const bin = resolve(import.meta.dirname, '..', 'dist', 'cli.js');
const hook = resolve(import.meta.dirname, 'hide-modules.mjs');
const work = mkdtempSync(join(tmpdir(), 'searchcast-serve-usage-'));
afterAll(() => rmSync(work, {recursive: true, force: true}));

let runs = 0;
/** Run the bin with `hide` hidden (koffi always), asserting koffi was never imported. */
function run(args: string[], env: NodeJS.ProcessEnv = {}, hide: string[] = []) {
	const log = join(work, `hidden-${runs++}.log`);
	const out = spawnSync(process.execPath, ['--import', hook, bin, ...args], {
		encoding: 'utf8',
		env: {
			...process.env,
			SEARCHCAST_TEST_HIDE: ['koffi', ...hide].join(','),
			SEARCHCAST_TEST_HIDDEN_LOG: log,
			...env,
		},
		timeout: 20_000,
	});
	const asked = existsSync(log) ? readFileSync(log, 'utf8') : '';
	expect(asked, 'koffi was imported').not.toMatch(/^koffi/m);
	return {...out, asked};
}

const USAGE = `searchcast: turn a web search form into a JSON API by driving a real browser

Usage:
  searchcast serve --recipes <file|dir> [--recipes ...] [options]
  searchcast browser-query --recipe <file> [options] <query...>

Serve options:
  --listen <where>       host:port, /path.sock, or \`systemd\` for a socket passed by
                         systemd socket activation (default 127.0.0.1:8931)
  --idle-exit <seconds>  Exit after this long with no request in flight (pairs
                         with socket activation: systemd starts it again on demand)

Browser options:
  --chrome <path>        Browser executable (default $SEARCHCAST_CHROME, then chromium/chrome on PATH)
  --profile <dir>        Persistent profile (default $XDG_STATE_HOME/searchcast/profile)
  --ephemeral            Use a fresh profile in a temporary directory, deleted on exit
  --proxy <url>          Proxy for all browser traffic, e.g. socks5://127.0.0.1:1080
  --xvfb <path>          Start this Xvfb as a private, authenticated display for the browser
  --headless             Run headless (easier to detect; for tests and quick checks)
  --concurrency <n>      Maximum simultaneous tabs (default 2)
  --chrome-arg=<arg>     Extra browser argument, repeatable; use the = form (--chrome-arg=--no-sandbox)

Without --headless the browser needs a display: pass --xvfb on a machine without one.
`;

// A browser path is given so no case depends on a browser being installed;
// none of these cases starts it.
const chrome = ['--chrome', join(work, 'no-such-chrome')];

describe('searchcast --help', () => {
	it('lists serve and browser-query, pointing to their flags', () => {
		const out = run(['--help']);
		expect(out.stdout.trim()).toBe(usage());
		expect(out.status).toBe(0);
		for (const line of [
			'  serve --recipes <file|dir> [--recipes ...] [options]',
			'  browser-query --recipe <file> [options] <query...>',
			'see `searchcast serve --help`',
		])
			expect(out.stdout).toContain(line);
	});
});

describe('searchcast serve and browser-query', () => {
	it('print the browser usage on --help, exit 0', () => {
		for (const args of [
			['serve', '--help'],
			['serve', '-h'],
			['browser-query', '--help'],
		]) {
			const out = run(args);
			expect(out.stdout).toBe(USAGE);
			expect(out.stderr).toBe('');
			expect(out.status).toBe(0);
		}
	});

	it.each([
		[['--concurrency', '0'], '--concurrency must be a positive integer'],
		[
			['--ephemeral', '--profile', '/tmp/x'],
			'--ephemeral and --profile are mutually exclusive',
		],
		[
			['--headless', '--xvfb', '/usr/bin/Xvfb'],
			'--headless and --xvfb are mutually exclusive',
		],
		[['--idle-exit', '0'], '--idle-exit must be a positive number of seconds'],
	])('serve refuses %j with exit 2', (args, message) => {
		const out = run(['serve', ...chrome, ...args]);
		expect(out.stderr).toBe(`searchcast: ${message}\n`);
		expect(out.status).toBe(2);
	});

	it.each([
		[['--ephemeral', 'serve', ...chrome, '--profile', '/tmp/x']],
		[['--ephemeral', ...chrome, 'serve', '--profile', '/tmp/x']],
		[['--profile', '/tmp/x', '--ephemeral', 'serve', ...chrome]],
	])('serve after options (%j) is serve, as in 0.1.2', (args) => {
		const out = run(args);
		expect(out.stderr).toBe(
			'searchcast: --ephemeral and --profile are mutually exclusive\n',
		);
		expect(out.status).toBe(2);
	});

	it.each([
		[['serve', ...chrome, '--listen', 'systemd']],
		[['--listen', 'systemd', 'serve', ...chrome]],
		[['--listen', 'systemd', ...chrome, '--headless', 'serve']],
	])(
		'serve refuses --listen systemd without LISTEN_FDS before starting anything (%j)',
		(args) => {
			const out = run(args, {LISTEN_FDS: '', LISTEN_PID: ''});
			expect(out.stderr).toBe(
				'searchcast: --listen systemd needs a socket from systemd socket activation (LISTEN_FDS)\n',
			);
			expect(out.status).toBe(2);
		},
	);

	it('prints the browser usage for --help before serve', () => {
		const out = run(['--help', 'serve']);
		expect(out.stdout).toBe(USAGE);
		expect(out.status).toBe(0);
	});

	it('serve refuses --listen systemd when LISTEN_PID is another process', () => {
		const out = run(['serve', ...chrome, '--listen', 'systemd'], {
			LISTEN_FDS: '1',
			LISTEN_PID: '1',
		});
		expect(out.status).toBe(2);
		expect(out.stderr).toContain('--listen systemd needs a socket');
	});

	it.each([
		[['browser-query', ...chrome, '--profile', 'P', 'q']],
		[['--headless', 'browser-query', ...chrome, '--profile', 'P', 'q']],
		[['--profile', 'P', ...chrome, 'browser-query', 'q']],
	])('browser-query needs --recipe (%j)', (args) => {
		const out = run(args.map((a) => (a === 'P' ? join(work, 'p') : a)));
		expect(out.stderr).toBe('searchcast: query needs --recipe <file>\n');
		expect(out.status).toBe(2);
	});

	it('an argv that parses under neither table stays a usage error of searchcast', () => {
		const out = run(['--no-such-option', 'serve']);
		expect(out.stderr).toMatch(
			/^searchcast: Unknown option '--no-such-option'/,
		);
		expect(out.stderr).toContain(usage());
		expect(out.status).toBe(2);
	});

	it('says so when no browser is found', () => {
		const out = run(['serve'], {SEARCHCAST_CHROME: '', PATH: work});
		expect(out.stderr).toBe(
			'searchcast: no browser found: pass --chrome or set SEARCHCAST_CHROME\n',
		);
		expect(out.status).toBe(2);
	});
});

describe('without @searchcast/browser installed', () => {
	it.each([
		['serve', ['serve', ...chrome, '--listen', 'systemd']],
		['browser-query', ['browser-query', ...chrome, '--listen', 'systemd']],
		['serve', ['--listen', 'systemd', 'serve', ...chrome]],
		['browser-query', ['--headless', 'browser-query', '--recipe', 'r', 'q']],
	])(
		'%s exits 1 with one line naming the package and the install command (%j)',
		(command, args) => {
			const out = run(args, {}, ['@searchcast/browser']);
			// The package was asked for, and hidden, so the test is real.
			expect(out.asked).toBe('@searchcast/browser/cli\n');
			expect(out.stdout).toBe('');
			expect(out.stderr).toBe(
				`searchcast: ${command} needs @searchcast/browser, which is not installed: install it next to searchcast (npm install -g @searchcast/browser)\n`,
			);
			expect(out.status).toBe(1);
		},
	);

	it('the HTTP commands do not need it', () => {
		const out = run(['--help'], {}, ['@searchcast/browser']);
		expect(out.status).toBe(0);
		expect(out.asked).toBe('');
	});
});

// HTTP commands with options first, even with `serve` as the query text or an
// option value, never reach the browser runner: `@searchcast/browser` is not
// even asked for. These may load koffi (doctor does), so they do not use run().
describe('HTTP commands with options first', () => {
	function http(args: string[]) {
		const log = join(work, `hidden-${runs++}.log`);
		const out = spawnSync(process.execPath, ['--import', hook, bin, ...args], {
			encoding: 'utf8',
			env: {
				...process.env,
				SEARCHCAST_TEST_HIDE: '@searchcast/browser',
				SEARCHCAST_TEST_HIDDEN_LOG: log,
			},
			timeout: 20_000,
		});
		expect(existsSync(log) ? readFileSync(log, 'utf8') : '').toBe('');
		return out;
	}
	const missing = join(work, 'no-such-recipe.json');

	it.each([
		[['--proxy', 'x', 'query', '--recipe', missing, 'serve']],
		[['--recipe', missing, 'query', 'serve']],
		[['--proxy', 'serve', 'query', '--recipe', missing, 'browser-query']],
	])('%j is the HTTP query', (args) => {
		const out = http(args);
		expect(out.stderr).toMatch(/^searchcast: recipe: .*no-such-recipe\.json/);
		expect(out.status).toBe(1);
	});

	it('--libcurl <path> doctor is doctor', () => {
		const out = http(['--libcurl', join(work, 'no-such-lib'), 'doctor']);
		expect(out.stdout).toContain('impersonation: NOT active');
		expect(out.status).toBe(1);
	});

	it('a usage error naming serve as an option value stays an HTTP usage error', () => {
		const out = http(['--proxy', 'serve', 'install-libcurl', 'extra']);
		expect(out.stderr).toMatch(
			/^searchcast: install-libcurl takes no arguments/,
		);
		expect(out.status).toBe(2);
	});
});
