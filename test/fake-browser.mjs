// A stand-in for Chromium, enough to test how searchcast launches, retires and
// relaunches browsers without a real one. It speaks the DevTools pipe protocol
// (NUL-terminated JSON on fds 3 and 4) and, like Chromium, holds its profile
// with a SingletonLock symlink: a second instance on a held profile aborts with
// exit code 21 and Chromium's own message.
//
// Tuned by environment:
// - FAKE_START_MS: delay between taking the lock and answering (a slow start).
// - FAKE_CLOSE_MS: how long shutting down takes (on `Browser.close` or the
//   pipe closing) before the process exits and frees the lock.
// - FAKE_DIE_MS: die on its own this long after starting: the pipe closes at
//   once, the process (and its lock) lingers another FAKE_LINGER_MS.
import {createReadStream, createWriteStream} from 'node:fs';
import {readlinkSync, symlinkSync, unlinkSync} from 'node:fs';
import {hostname} from 'node:os';
import {join} from 'node:path';

const env = (name) => Number(process.env[name] ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = process.argv
	.find((a) => a.startsWith('--user-data-dir='))
	?.slice('--user-data-dir='.length);
if (!dir) {
	process.stderr.write('fake-browser: no --user-data-dir\n');
	process.exit(1);
}
const lock = join(dir, 'SingletonLock');

function takeLock() {
	try {
		symlinkSync(`${hostname()}-${process.pid}`, lock);
		return true;
	} catch (e) {
		if (e.code !== 'EEXIST') throw e;
	}
	// Like Chromium, take over a lock whose owner is gone.
	const owner = Number(readlinkSync(lock).split('-').pop());
	try {
		process.kill(owner, 0);
		return false;
	} catch {
		unlinkSync(lock);
		return takeLock();
	}
}

if (!takeLock()) {
	process.stderr.write(
		`Failed to create ${lock}: File exists (17)\n` +
			'Failed to create a ProcessSingleton for your profile directory.\n',
	);
	process.exit(21);
}
const exit = (code) => {
	try {
		unlinkSync(lock);
	} catch {}
	process.exit(code);
};

const input = createReadStream(null, {fd: 3, encoding: 'utf8'});
const output = createWriteStream(null, {fd: 4});
await sleep(env('FAKE_START_MS'));

if (process.env.FAKE_DIE_MS) {
	setTimeout(async () => {
		output.destroy();
		input.destroy();
		await sleep(env('FAKE_LINGER_MS'));
		exit(0);
	}, env('FAKE_DIE_MS'));
}

let buffer = '';
input.on('data', async (chunk) => {
	buffer += chunk;
	let end;
	while ((end = buffer.indexOf('\0')) !== -1) {
		const {id, method} = JSON.parse(buffer.slice(0, end));
		buffer = buffer.slice(end + 1);
		const reply = (result) => output.write(JSON.stringify({id, result}) + '\0');
		if (method === 'Browser.getVersion') {
			reply({product: 'FakeBrowser/1.0'});
		} else if (method === 'Browser.close') {
			reply({});
			await sleep(env('FAKE_CLOSE_MS'));
			exit(0);
		} else {
			output.write(
				JSON.stringify({id, error: {message: `unsupported ${method}`}}) + '\0',
			);
		}
	}
});
// The pipe closing is how searchcast lets go of a browser: shut down too.
input.on('end', async () => {
	await sleep(env('FAKE_CLOSE_MS'));
	exit(0);
});
