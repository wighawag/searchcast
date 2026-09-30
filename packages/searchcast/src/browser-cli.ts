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
// - A browser command is recognised only as the FIRST argument
//   (`searchcast serve ...`, as documented and as every systemd unit spells
//   it). searchcast 0.1.2 also accepted options before the command; that form
//   now reaches the HTTP commands' parser and is a usage error.
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
}

/**
 * Run a browser command through `@searchcast/browser`'s `runCli`, which owns
 * the process from there (it writes its own errors and sets the exit code). When
 * the package is missing, write {@link browserMissingMessage} and exit with 1.
 */
export async function runBrowserCli(argv: string[]): Promise<void> {
	// A variable specifier, so tsc does not resolve it: the package is an
	// optional peer dependency.
	const specifier = `${PACKAGE}/cli`;
	let cli: BrowserCli;
	try {
		cli = (await import(specifier)) as BrowserCli;
	} catch (error) {
		const {code, message} = error as {code?: string; message?: string};
		// Only the package itself missing; a broken install is reported as is.
		if (
			code !== 'ERR_MODULE_NOT_FOUND' ||
			!String(message).includes(`'${PACKAGE}'`)
		) {
			throw error;
		}
		process.stderr.write(browserMissingMessage(argv[0]!) + '\n');
		process.exit(1);
	}
	await cli.runCli(argv);
}
