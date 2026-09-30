import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Browser, type BrowserOptions} from '../src/browser.js';
import {Searchcast} from '../src/searchcast.js';
import {createSearchcastServer} from '../src/server.js';

// Never two browsers on one profile. A second Chromium on a profile that is
// still held aborts with exit code 21 ("Failed to create a ProcessSingleton"),
// which is how the CI unix-socket test failed: the server went idle during a
// slow browser warmup, and the first search launched a second browser while
// the first was still closing. These tests use a fake browser that holds its
// profile the same way, so they need no Chrome.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let work: string;
let executable: string;

beforeAll(() => {
	work = mkdtempSync(join(tmpdir(), 'searchcast-launch-'));
	// A shell wrapper around the real program, like /usr/bin/google-chrome.
	executable = join(work, 'fake-chrome');
	const fake = resolve(import.meta.dirname, 'fake-browser.mjs');
	writeFileSync(
		executable,
		`#!/bin/sh\nexec '${process.execPath}' '${fake}' "$@"\n`,
	);
	chmodSync(executable, 0o755);
});

afterAll(() => {
	if (work) rmSync(work, {recursive: true, force: true});
});

function browserOptions(env: Record<string, string> = {}): BrowserOptions {
	return {
		executable,
		userDataDir: mkdtempSync(join(work, 'profile-')),
		headless: true,
		env,
		launchTimeoutMs: 10_000,
	};
}

describe('never two browsers on one profile', () => {
	it('a launch after close() waits for the closed browser to exit', async () => {
		const searchcast = new Searchcast({
			browser: browserOptions({FAKE_CLOSE_MS: '500'}),
		});
		await searchcast.warmup();
		const closing = searchcast.close();
		// e.g. a request arriving while the server shuts down.
		await searchcast.warmup();
		await closing;
		await searchcast.close();
	});

	it('relaunching a browser that died waits for its process to exit', async () => {
		const searchcast = new Searchcast({
			browser: browserOptions({FAKE_DIE_MS: '200', FAKE_LINGER_MS: '500'}),
		});
		await searchcast.warmup();
		// Its pipe is closed, but its process still holds the profile.
		await sleep(300);
		await searchcast.warmup();
		await searchcast.close();
	});

	it('a launch that failed has exited before it is reported', async () => {
		const options = browserOptions();
		await expect(
			Browser.launch({
				...options,
				env: {FAKE_START_MS: '5000'},
				launchTimeoutMs: 200,
			}),
		).rejects.toThrow('did not start in time');
		const browser = await Browser.launch(options);
		await browser.close();
	});
});

describe('the idle clock', () => {
	it('starts when the server listens, not when it is created', async () => {
		let idle = 0;
		const server = createSearchcastServer({} as Searchcast, new Map(), {
			idleMs: 100,
			onIdle: () => idle++,
		});
		// A slow browser warmup happens between creating and listening.
		await sleep(300);
		expect(idle).toBe(0);
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		await sleep(300);
		expect(idle).toBe(1);
		server.close();
	});
});
