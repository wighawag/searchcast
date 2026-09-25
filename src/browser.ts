import {spawn, type ChildProcess} from 'node:child_process';
import {accessSync, constants, mkdirSync} from 'node:fs';
import {delimiter, join} from 'node:path';
import {CdpConnection, CdpError} from './cdp.js';

export interface BrowserOptions {
	/** Path to a Chromium or Chrome executable. */
	executable: string;
	/** Persistent profile directory; cookies and history accumulate here. */
	userDataDir: string;
	/** Proxy URL passed to Chromium, e.g. `socks5://127.0.0.1:1080`. */
	proxy?: string;
	/** Run headless. Easier for sites to detect; meant for tests and quick checks. */
	headless?: boolean;
	/** Window size as `width,height`. Default `1366,900`. */
	windowSize?: string;
	/** Extra command-line arguments passed verbatim to Chromium. */
	extraArgs?: string[];
	/** Extra environment for the browser process, e.g. `DISPLAY` and `XAUTHORITY`. */
	env?: Record<string, string>;
	/** How long to wait for the browser to come up. Default 30000 ms. */
	launchTimeoutMs?: number;
}

const CANDIDATES = [
	'chromium',
	'chromium-browser',
	'google-chrome-stable',
	'google-chrome',
	'chrome',
];

/** Find a browser: `$SEARCHCAST_CHROME` first, then common names on `$PATH`. */
export function findChrome(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	if (env.SEARCHCAST_CHROME) return env.SEARCHCAST_CHROME;
	for (const dir of (env.PATH ?? '').split(delimiter)) {
		if (!dir) continue;
		for (const name of CANDIDATES) {
			const candidate = join(dir, name);
			try {
				accessSync(candidate, constants.X_OK);
				return candidate;
			} catch {}
		}
	}
	return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Browser {
	readonly cdp: CdpConnection;
	#process: ChildProcess;

	private constructor(cdp: CdpConnection, process: ChildProcess) {
		this.cdp = cdp;
		this.#process = process;
	}

	get closed(): boolean {
		return this.cdp.closed;
	}

	static async launch(options: BrowserOptions): Promise<Browser> {
		mkdirSync(options.userDataDir, {recursive: true});

		const args = [
			// DevTools over the inherited fds 3 and 4, NOT a TCP port: no other
			// process on the machine can reach the browser, and it works for a
			// user that may not use loopback TCP at all (a Tor-forced account).
			'--remote-debugging-pipe',
			`--user-data-dir=${options.userDataDir}`,
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-features=Translate',
			// Headless mode otherwise sets navigator.webdriver = true.
			'--disable-blink-features=AutomationControlled',
			// Only the pages it is asked for: no component updates, sync, metrics
			// or other traffic of its own, which through a proxy or Tor is just
			// noise that says "a Chromium lives here".
			'--disable-background-networking',
			'--disable-component-update',
			'--disable-sync',
			'--disable-domain-reliability',
			'--no-pings',
			`--window-size=${options.windowSize ?? '1366,900'}`,
		];
		if (options.proxy) args.push(`--proxy-server=${options.proxy}`);
		if (options.headless) args.push('--headless=new');
		args.push(...(options.extraArgs ?? []), 'about:blank');

		const child = spawn(options.executable, args, {
			// fd 3: we write, the browser reads; fd 4: the browser writes.
			stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
			// No session bus: given one, Chromium registers its own systemd scope
			// and moves out of the caller's cgroup, so stopping the service that
			// started it (and that service's memory limit) no longer reaches it.
			env: {
				...process.env,
				...options.env,
				DBUS_SESSION_BUS_ADDRESS: 'disabled:',
			},
		});
		let stderr = '';
		child.stderr?.on('data', (chunk) => {
			stderr = (stderr + chunk).slice(-4000);
		});
		let exited: string | undefined;
		child.once('exit', (code, signal) => {
			exited = `exited with ${signal ?? `code ${code}`}`;
		});
		child.once('error', (e) => {
			exited = e.message;
		});
		const killChild = () => child.kill('SIGKILL');
		// Prepended so it runs before any other exit handler, in particular one
		// deleting the profile directory the browser is still writing to.
		process.prependOnceListener('exit', killChild);
		child.once('exit', () => process.removeListener('exit', killChild));

		const fail = (reason: string): never => {
			child.kill('SIGKILL');
			throw new CdpError(`browser ${reason}\n${stderr.trim()}`.trim());
		};

		const cdp = CdpConnection.fromPipe(
			child.stdio[3] as NodeJS.WritableStream,
			child.stdio[4] as NodeJS.ReadableStream,
		);
		child.once('exit', () => cdp.close());
		// Ready when it answers. A browser that dies first closes the pipe, which
		// rejects this with "connection closed" and is reported with its stderr.
		let timer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				cdp.send('Browser.getVersion'),
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error('did not start in time')),
						options.launchTimeoutMs ?? 30_000,
					);
				}),
			]);
		} catch (e) {
			fail(exited ?? (e as Error).message);
		} finally {
			clearTimeout(timer);
		}
		return new Browser(cdp, child);
	}

	async newPage(): Promise<Page> {
		const {targetId} = await this.cdp.send<{targetId: string}>(
			'Target.createTarget',
			{url: 'about:blank'},
		);
		const {sessionId} = await this.cdp.send<{sessionId: string}>(
			'Target.attachToTarget',
			{
				targetId,
				flatten: true,
			},
		);
		return new Page(this.cdp, targetId, sessionId);
	}

	async close(): Promise<void> {
		if (!this.cdp.closed) {
			await Promise.race([
				this.cdp.send('Browser.close').catch(() => {}),
				sleep(3000),
			]);
		}
		this.cdp.close();
		if (this.#process.exitCode === null && this.#process.signalCode === null) {
			await Promise.race([
				new Promise((r) => this.#process.once('exit', r)),
				sleep(3000),
			]);
			this.#process.kill('SIGKILL');
		}
	}
}

/**
 * One tab. Deliberately never calls `Runtime.enable`: some sites detect an
 * automation client through side effects of that domain being enabled, and
 * `Runtime.evaluate` works without it.
 */
export class Page {
	constructor(
		private readonly cdp: CdpConnection,
		readonly targetId: string,
		readonly sessionId: string,
	) {}

	send<T = any>(method: string, params: object = {}): Promise<T> {
		return this.cdp.send<T>(method, params, this.sessionId);
	}

	async navigate(url: string): Promise<void> {
		const result = await this.send<{errorText?: string}>('Page.navigate', {
			url,
		});
		if (result.errorText)
			throw new CdpError(`navigation to ${url} failed: ${result.errorText}`);
	}

	async evaluate<T>(expression: string): Promise<T> {
		const result = await this.send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.exceptionDetails) {
			const detail =
				result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text;
			throw new CdpError(`page script failed: ${detail}`);
		}
		return result.result?.value as T;
	}

	/** Click the centre of the first element matching `selector`, with real mouse events. */
	async click(selector: string): Promise<boolean> {
		const point = await this.evaluate<{x: number; y: number} | null>(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			el.scrollIntoView({block: 'center', inline: 'center'});
			const r = el.getBoundingClientRect();
			return {x: r.x + r.width / 2, y: r.y + r.height / 2};
		})()`);
		if (!point) return false;
		const base = {x: point.x, y: point.y, button: 'left', clickCount: 1};
		await this.send('Input.dispatchMouseEvent', {
			type: 'mouseMoved',
			x: point.x,
			y: point.y,
		});
		await this.send('Input.dispatchMouseEvent', {
			type: 'mousePressed',
			...base,
		});
		await sleep(40 + Math.random() * 60);
		await this.send('Input.dispatchMouseEvent', {
			type: 'mouseReleased',
			...base,
		});
		return true;
	}

	/** Type text into the focused element, one key at a time, with human-like gaps. */
	async type(text: string): Promise<void> {
		for (const ch of text) {
			await this.send('Input.dispatchKeyEvent', {
				type: 'keyDown',
				text: ch,
				key: ch,
				unmodifiedText: ch,
			});
			await this.send('Input.dispatchKeyEvent', {type: 'keyUp', key: ch});
			await sleep(35 + Math.random() * 75);
		}
	}

	async pressEnter(): Promise<void> {
		const key = {
			key: 'Enter',
			code: 'Enter',
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
		};
		await this.send('Input.dispatchKeyEvent', {
			type: 'keyDown',
			text: '\r',
			...key,
		});
		await this.send('Input.dispatchKeyEvent', {type: 'keyUp', ...key});
	}

	async close(): Promise<void> {
		await this.cdp
			.send('Target.closeTarget', {targetId: this.targetId})
			.catch(() => {});
	}
}
