// The CLI's usage text and usage errors: `runCli` from the built `./cli` entry,
// run in a process of its own with the arguments given. These need no browser:
// every case here fails or answers before one is started. The `searchcast`
// bin's delegation to it (`searchcast serve`, `searchcast browser-query`) and
// the end-to-end cases are tested in packages/searchcast.
// The usage text is searchcast 0.1.2's, except
// the one-shot query line, now spelled `browser-query` (the `searchcast` bin's
// `query` is the HTTP query).
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterAll, describe, expect, it} from 'vitest';
import {browserCommand} from '../src/cli.js';

const cli = pathToFileURL(resolve(import.meta.dirname, '..', 'dist', 'cli.js'));
// `node -e <script> -- <args>`: process.argv is [node, ...args].
const script = `import {runCli} from ${JSON.stringify(cli.href)};
runCli(process.argv.slice(1));`;
const work = mkdtempSync(join(tmpdir(), 'searchcast-cli-usage-'));
afterAll(() => rmSync(work, {recursive: true, force: true}));

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
	return spawnSync(
		process.execPath,
		['--input-type=module', '-e', script, '--', ...args],
		{
			encoding: 'utf8',
			env: {...process.env, ...env},
			timeout: 20_000,
		},
	);
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

describe('the CLI usage', () => {
	it('prints the usage on --help and with no command, exit 0', () => {
		for (const args of [['--help'], ['-h'], []]) {
			const out = run(args);
			expect(out.stdout).toBe(USAGE);
			expect(out.stderr).toBe('');
			expect(out.status).toBe(0);
		}
	});

	it('refuses an unknown command with the usage, exit 2', () => {
		const out = run(['nope', ...chrome, '--profile', join(work, 'p')]);
		expect(out.stderr).toBe(`searchcast: unknown command nope\n\n${USAGE}\n`);
		expect(out.status).toBe(2);
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
	])('refuses %j with exit 2', (args, message) => {
		const out = run(['serve', ...chrome, ...args]);
		expect(out.stderr).toBe(`searchcast: ${message}\n`);
		expect(out.status).toBe(2);
	});

	it('refuses --listen systemd without LISTEN_FDS before starting anything', () => {
		const out = run(['serve', ...chrome, '--listen', 'systemd'], {
			LISTEN_FDS: '',
			LISTEN_PID: '',
		});
		expect(out.stderr).toBe(
			'searchcast: --listen systemd needs a socket from systemd socket activation (LISTEN_FDS)\n',
		);
		expect(out.status).toBe(2);
	});

	it('refuses --listen systemd when LISTEN_PID is another process', () => {
		const out = run(['serve', ...chrome, '--listen', 'systemd'], {
			LISTEN_FDS: '1',
			LISTEN_PID: '1',
		});
		expect(out.status).toBe(2);
		expect(out.stderr).toContain('--listen systemd needs a socket');
	});

	it.each(['browser-query', 'query'])(
		'runs the one-shot query as %s (it needs --recipe)',
		(command) => {
			const out = run([command, ...chrome, '--profile', join(work, 'p'), 'q']);
			expect(out.stderr).toBe('searchcast: query needs --recipe <file>\n');
			expect(out.status).toBe(2);
		},
	);

	it('says so when no browser is found', () => {
		const out = run(['serve'], {SEARCHCAST_CHROME: '', PATH: work});
		expect(out.stderr).toBe(
			'searchcast: no browser found: pass --chrome or set SEARCHCAST_CHROME\n',
		);
		expect(out.status).toBe(2);
	});
});

// What the `searchcast` bin asks to find `serve` or `browser-query` after
// options (`searchcast --ephemeral serve ...`), with this runner's own option
// table: which options take a value decides what the first positional is.
describe('browserCommand', () => {
	it.each([
		[['serve', '--recipes', 'r'], 'serve'],
		[['--ephemeral', 'serve', '--recipes', 'r'], 'serve'],
		[['--listen', 'systemd', 'serve'], 'serve'],
		[['--headless', 'browser-query', '--recipe', 'r', 'q'], 'browser-query'],
		[['--chrome-arg=--no-sandbox', '--recipes', 'serve', 'x'], 'x'],
		[['--proxy', 'serve', 'query', 'q'], 'query'],
		[['--headless'], undefined],
		[[], undefined],
	])('finds the command of %j', (argv, command) => {
		expect(browserCommand(argv)).toBe(command);
	});

	it('is undefined when argv does not parse under the browser options', () => {
		expect(browserCommand(['--libcurl', 'l', 'serve'])).toBeUndefined();
		expect(browserCommand(['--ephemeral=yes', 'serve'])).toBeUndefined();
	});
});
