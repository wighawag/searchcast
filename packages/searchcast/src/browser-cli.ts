// `searchcast serve` and `searchcast browser-query`: the browser runner's
// command line (searchcast 0.1.x's `serve` and `query`), run by
// `@searchcast/browser`'s `./cli` entry with the arguments unchanged, so its
// flags, defaults, messages, exit codes and signal handling are exactly
// 0.1.2's. `@searchcast/browser` is an optional peer dependency, imported here
// only, and only for these two commands. This module imports nothing itself:
// neither these commands nor a missing `@searchcast/browser` load koffi or the
// libcurl-impersonate library (test/serve-usage.test.ts proves it).
//
// Decisions (recorded in
// work/notes/observations/2026-09-30-searchcast-serve-command-decisions.md):
// - A browser command is recognised as the first argument (`searchcast serve
//   ...`, as documented and as every systemd unit spells it) and, as
//   searchcast 0.1.2 accepted, after options (`searchcast --ephemeral serve
//   ...`): when the first argument is an option and argv names no HTTP command,
//   `@searchcast/browser/cli`'s `browserCommand` finds the command with the
//   browser runner's own option table (not copied here). Recorded in
//   work/notes/observations/2026-09-30-serve-options-before-command-decisions.md.
// - A missing `@searchcast/browser` exits with 1 (a failure, like a failed
//   install), not 2 (the command line was right; the machine lacks a package),
//   with one line naming the package and the install command.

/** The commands delegated to `@searchcast/browser`, as typed after `searchcast`. */
export const BROWSER_COMMANDS = ['serve', 'browser-query'] as const;

/** Whether `argv` (after `searchcast`) is a browser command. */
export function isBrowserCommand(argv: string[]): boolean {
	return (BROWSER_COMMANDS as readonly string[]).includes(argv[0] ?? '');
}

const PACKAGE = '@searchcast/browser';

/** The one line written when `@searchcast/browser` is not installed. */
export function browserMissingMessage(command: string): string {
	return `searchcast: ${command} needs ${PACKAGE}, which is not installed: install it next to searchcast (npm install -g ${PACKAGE})`;
}

interface BrowserCli {
	runCli(argv: string[]): Promise<void>;
	browserCommand(argv: string[]): string | undefined;
}

/**
 * Import `@searchcast/browser/cli`. When the package is missing, write
 * {@link browserMissingMessage} for `command` and exit with 1.
 */
async function loadBrowserCli(command: string): Promise<BrowserCli> {
	// A variable specifier, so tsc does not resolve it: the package is an
	// optional peer dependency.
	const specifier = `${PACKAGE}/cli`;
	try {
		return (await import(specifier)) as BrowserCli;
	} catch (error) {
		const {code, message} = error as {code?: string; message?: string};
		// Only the package itself missing; a broken install is reported as is.
		if (
			code !== 'ERR_MODULE_NOT_FOUND' ||
			!String(message).includes(`'${PACKAGE}'`)
		) {
			throw error;
		}
		process.stderr.write(browserMissingMessage(command) + '\n');
		process.exit(1);
	}
}

/**
 * Run a browser command (`argv[0]`) through `@searchcast/browser`'s `runCli`,
 * which owns the process from there (it writes its own errors and sets the
 * exit code). When the package is missing, write {@link browserMissingMessage}
 * and exit with 1.
 */
export async function runBrowserCli(argv: string[]): Promise<void> {
	const cli = await loadBrowserCli(argv[0]!);
	await cli.runCli(argv);
}

/**
 * For an `argv` that starts with an option and names no HTTP command: run it
 * through `runCli`, unchanged, when the browser runner's option table finds
 * `serve` or `browser-query` as its command (`searchcast --ephemeral serve
 * ...`, as searchcast 0.1.2 accepted), and resolve `true`; otherwise resolve
 * `false` and the HTTP commands' parser reports the usage error. The package
 * is only imported when one of those words is in `argv`, so other usage errors
 * never load it. When it is missing, the first such word is taken as the
 * command: {@link browserMissingMessage} for it, exit 1.
 */
export async function runBrowserCliAfterOptions(
	argv: string[],
): Promise<boolean> {
	const named = argv.find((arg) =>
		(BROWSER_COMMANDS as readonly string[]).includes(arg),
	);
	if (!named) return false;
	const cli = await loadBrowserCli(named);
	const command = cli.browserCommand(argv);
	if (!(BROWSER_COMMANDS as readonly string[]).includes(command ?? '')) {
		return false;
	}
	await cli.runCli(argv);
	return true;
}
