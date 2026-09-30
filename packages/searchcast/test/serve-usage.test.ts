// `searchcast serve` and `searchcast browser-query` through the real bin (the
// built dist/cli.js), which delegates them to `@searchcast/browser`'s `./cli`
// entry with the arguments unchanged. These need no browser: every case here
// fails or answers before one is started (the end-to-end cases are in
// serve.test.ts). The usage text and messages are searchcast 0.1.2's, except
// the one-shot query line, now spelled `browser-query`.
//
// Every run hides koffi (test/hide-modules.mjs) and asserts it was never even
// asked for: a machine running only the browser server needs neither koffi
// nor the libcurl-impersonate library it loads.
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

	it('serve refuses --listen systemd without LISTEN_FDS before starting anything', () => {
		const out = run(['serve', ...chrome, '--listen', 'systemd'], {
			LISTEN_FDS: '',
			LISTEN_PID: '',
		});
		expect(out.stderr).toBe(
			'searchcast: --listen systemd needs a socket from systemd socket activation (LISTEN_FDS)\n',
		);
		expect(out.status).toBe(2);
	});

	it('serve refuses --listen systemd when LISTEN_PID is another process', () => {
		const out = run(['serve', ...chrome, '--listen', 'systemd'], {
			LISTEN_FDS: '1',
			LISTEN_PID: '1',
		});
		expect(out.status).toBe(2);
		expect(out.stderr).toContain('--listen systemd needs a socket');
	});

	it('browser-query needs --recipe', () => {
		const out = run([
			'browser-query',
			...chrome,
			'--profile',
			join(work, 'p'),
			'q',
		]);
		expect(out.stderr).toBe('searchcast: query needs --recipe <file>\n');
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
	it.each(['serve', 'browser-query'])(
		'%s exits 1 with one line naming the package and the install command',
		(command) => {
			const out = run([command, ...chrome, '--listen', 'systemd'], {}, [
				'@searchcast/browser',
			]);
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
