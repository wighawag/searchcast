import {spawn, type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/**
 * A private virtual X display for a headful browser on a machine without one.
 *
 * - Authenticated: a fresh MIT-MAGIC-COOKIE in a private auth file, so other
 *   local users cannot connect to the display.
 * - No TCP and no abstract-namespace socket (`-nolisten tcp -nolisten local`):
 *   only the filesystem socket in /tmp/.X11-unix, which the cookie guards.
 */
export interface Xvfb {
	/** Environment for clients: `DISPLAY` and `XAUTHORITY`. */
	env: {DISPLAY: string; XAUTHORITY: string};
	close(): Promise<void>;
}

export interface XvfbOptions {
	/** Path to the Xvfb executable. */
	executable: string;
	/** Screen geometry, `WIDTHxHEIGHTxDEPTH`. Default `1366x900x24`. */
	screen?: string;
	/** First display number to try. Default 99. */
	firstDisplay?: number;
	/** How long to wait for the server. Default 10000 ms. */
	startTimeoutMs?: number;
}

/** One Xauthority entry: FamilyWild, so it matches the local display by number. */
function xauthEntry(display: number, cookie: Buffer): Buffer {
	const field = (b: Buffer) => {
		const len = Buffer.alloc(2);
		len.writeUInt16BE(b.length);
		return Buffer.concat([len, b]);
	};
	const family = Buffer.alloc(2);
	family.writeUInt16BE(0xffff);
	return Buffer.concat([
		family,
		field(Buffer.alloc(0)),
		field(Buffer.from(String(display))),
		field(Buffer.from('MIT-MAGIC-COOKIE-1')),
		field(cookie),
	]);
}

function tryStart(
	options: XvfbOptions,
	display: number,
	authFile: string,
): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			options.executable,
			[
				`:${display}`,
				'-screen',
				'0',
				options.screen ?? '1366x900x24',
				'-auth',
				authFile,
				'-nolisten',
				'tcp',
				'-nolisten',
				'local',
				'-displayfd',
				'3',
			],
			{stdio: ['ignore', 'ignore', 'pipe', 'pipe']},
		);
		let stderr = '';
		child.stderr?.on('data', (chunk) => {
			stderr = (stderr + chunk).slice(-2000);
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`Xvfb :${display} did not start in time\n${stderr}`));
		}, options.startTimeoutMs ?? 10_000);
		// Xvfb writes the display number to fd 3 once it accepts connections.
		(child.stdio[3] as NodeJS.ReadableStream).once('data', () => {
			clearTimeout(timer);
			resolve(child);
		});
		child.once('exit', (code, signal) => {
			clearTimeout(timer);
			reject(
				new Error(
					`Xvfb :${display} exited with ${signal ?? `code ${code}`}\n${stderr}`,
				),
			);
		});
		child.once('error', (e) => {
			clearTimeout(timer);
			reject(e);
		});
	});
}

export async function startXvfb(options: XvfbOptions): Promise<Xvfb> {
	const dir = mkdtempSync(join(tmpdir(), 'searchcast-x11-'));
	const authFile = join(dir, 'Xauthority');
	const cookie = randomBytes(16);
	let lastError: Error | undefined;
	for (
		let display = options.firstDisplay ?? 99, tries = 0;
		tries < 20;
		display++, tries++
	) {
		if (existsSync(`/tmp/.X${display}-lock`)) continue;
		writeFileSync(authFile, xauthEntry(display, cookie), {mode: 0o600});
		try {
			const child = await tryStart(options, display, authFile);
			const kill = () => child.kill('SIGKILL');
			process.once('exit', kill);
			return {
				env: {DISPLAY: `:${display}`, XAUTHORITY: authFile},
				close: async () => {
					process.removeListener('exit', kill);
					if (child.exitCode === null && child.signalCode === null) {
						const exited = new Promise((r) => child.once('exit', r));
						child.kill('SIGTERM');
						await Promise.race([
							exited,
							new Promise((r) => setTimeout(r, 3000)),
						]);
						child.kill('SIGKILL');
					}
					rmSync(dir, {recursive: true, force: true});
				},
			};
		} catch (e) {
			// Most likely another server took this display between the lock
			// check and the bind; try the next number.
			lastError = e as Error;
		}
	}
	rmSync(dir, {recursive: true, force: true});
	throw lastError ?? new Error('no free X display found');
}
