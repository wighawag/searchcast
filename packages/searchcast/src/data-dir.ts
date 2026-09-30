// searchcast's data directory, `$XDG_DATA_HOME/searchcast` (default
// `~/.local/share/searchcast`): where `searchcast install-libcurl` puts the
// library and `searchcast install-recipes` puts recipe sets. The writers write
// only here.
//
// For one release (0.2.x, ADR 0005) the readers also look in serpcast's old
// directory, `$XDG_DATA_HOME/serpcast`, for an item the new one lacks: the
// library file (libcurl.ts) and a recipe set by name (recipes.ts). Nothing
// ever moves a file: `oldDataDirHits` lists what is read from the old
// directory and the exact `mv` command the user can run, for `doctor` and for
// an embedder that wants to show the same notice. Everything here only reads.

import {existsSync, readdirSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const base = (env: NodeJS.ProcessEnv) =>
	env.XDG_DATA_HOME || join(homedir(), '.local', 'share');

/** searchcast's data directory: `$XDG_DATA_HOME/searchcast`, default `~/.local/share/searchcast`. */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(base(env), 'searchcast');
}

/**
 * serpcast's data directory, `$XDG_DATA_HOME/serpcast` (default
 * `~/.local/share/serpcast`), read when the new one lacks an item. Read-only:
 * nothing is ever written or moved there.
 * @deprecated The fallback (and this function) goes in the next minor after 0.2.x.
 */
export function oldDataDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(base(env), 'serpcast');
}

/** The library's file name inside the data directory, for this platform. */
export function libraryFileName(
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform === 'darwin') return 'libcurl-impersonate.dylib';
	if (platform === 'win32') return 'libcurl-impersonate.dll';
	return 'libcurl-impersonate.so';
}

/** The recipe set names (directories, no hidden entries) in `base`. */
export function setNames(base: string): string[] {
	if (!existsSync(base)) return [];
	return readdirSync(base)
		.filter((name) => !name.startsWith('.'))
		.filter((name) => statSync(join(base, name)).isDirectory())
		.sort();
}

/** What the readers take from the old data directory, and how to move it. */
export interface OldDataDirHits {
	/** The old directory (`oldDataDir(env)`). */
	dir: string;
	/** The new one (`dataDir(env)`). */
	newDir: string;
	/** Paths relative to `dir` read from there: the library file, `recipes/<set>` for each set. */
	items: string[];
	/** A POSIX shell command that moves exactly those items to the new directory. */
	command: string;
}

const quote = (path: string) => `'${path.replace(/'/g, `'\\''`)}'`;

/**
 * The items of the old data directory that the readers use because the new
 * one lacks them (an item present in both is read from the new one), or
 * undefined when there is none. Only reads; never moves anything.
 */
export function oldDataDirHits(
	env: NodeJS.ProcessEnv = process.env,
): OldDataDirHits | undefined {
	const dir = oldDataDir(env);
	const newDir = dataDir(env);
	const items: string[] = [];
	const library = libraryFileName();
	if (existsSync(join(dir, library)) && !existsSync(join(newDir, library))) {
		items.push(library);
	}
	const present = new Set(setNames(join(newDir, 'recipes')));
	const sets = setNames(join(dir, 'recipes')).filter((s) => !present.has(s));
	items.push(...sets.map((set) => `recipes/${set}`));
	if (!items.length) return undefined;
	const command = !existsSync(newDir)
		? `mv ${quote(dir)} ${quote(newDir)}`
		: [
				...(sets.length ? [`mkdir -p ${quote(join(newDir, 'recipes'))}`] : []),
				...items.map(
					(item) => `mv ${quote(join(dir, item))} ${quote(join(newDir, item))}`,
				),
			].join(' && ');
	return {dir, newDir, items, command};
}
