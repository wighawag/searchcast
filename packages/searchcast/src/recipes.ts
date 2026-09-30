// Where installed recipe sets live, and what is there. `searchcast
// install-recipes` (install-recipes.ts) puts each set in its own directory
// under `recipesDir()`, with a `.source.json` recording where it came from.
// Nothing here loads a recipe or looks anywhere on its own (ADR 0002): the
// caller (webveil, or `searchcast recipes list`) asks for the base directory
// or a set's directory and decides what to load.
//
// For one release (ADR 0005), a set is also found in serpcast's old data
// directory (`<old data dir>/recipes/<set>`) when the new one has no set of
// that name: `recipeSetDir` returns it, and `recipes list` shows both
// directories. A set in the new directory always wins. Nothing is moved.

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {dataDir, oldDataDir, setNames} from './data-dir.js';

/** The file install writes beside the recipes of a set; never a recipe itself. */
export const SOURCE_FILE = '.source.json';

/** What install records in a set's `.source.json`. */
export interface RecipeSetSource {
	/** The URL or file path given to install. */
	source: string;
	/** The URL the archive came from after redirects, for a URL source. */
	url?: string;
	/** The archive's sha256, as pinned with `--sha256`. */
	sha256: string;
	/** The archive's `manifest.json` name and version, when it had one. */
	manifest?: {name?: string; version?: string};
	/** Each installed file (all at the set's top level), with its sha256. */
	files: Record<string, string>;
	installedAt: string;
}

export interface RecipeSet {
	name: string;
	dir: string;
	/** The set's files (`.source.json` excluded). */
	files: string[];
	/** Undefined when `.source.json` is missing or unreadable. */
	source?: RecipeSetSource;
}

/**
 * The base directory of installed recipe sets: `recipes/` in the data
 * directory (`$XDG_DATA_HOME/searchcast`, default `~/.local/share/searchcast`).
 * Each set is a directory in it. Nothing is created. This is where
 * `installRecipes` writes; to find a set, prefer `recipeSetDir`.
 */
export function recipesDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(dataDir(env), 'recipes');
}

const oldRecipesDir = (env: NodeJS.ProcessEnv) =>
	join(oldDataDir(env), 'recipes');

const isDir = (path: string) => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

/**
 * The directory of the installed set `name`: in `recipesDir(env)` if it is
 * there, else in serpcast's old data directory (read for one release), else
 * undefined. A name that is not one set-name segment is never found.
 */
export function recipeSetDir(
	name: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return undefined;
	return [recipesDir(env), oldRecipesDir(env)]
		.map((base) => join(base, name))
		.find(isDir);
}

/** The sets installed in `base` (skipping install's temporary entries), by name. */
export function listRecipeSets(base: string): RecipeSet[] {
	return setNames(base).map((name) => {
		const dir = join(base, name);
		let source: RecipeSetSource | undefined;
		try {
			source = JSON.parse(readFileSync(join(dir, SOURCE_FILE), 'utf8'));
		} catch {
			source = undefined;
		}
		const files = readdirSync(dir, {withFileTypes: true})
			.filter((entry) => entry.isFile() && entry.name !== SOURCE_FILE)
			.map((entry) => entry.name)
			.sort();
		return {name, dir, files, source};
	});
}

/**
 * `searchcast recipes list` with no `--dir`: the sets of `recipesDir(env)`,
 * then, when there are any, those still in serpcast's old data directory,
 * each saying whether it is used or shadowed by a set of the same name.
 */
export function formatInstalledRecipeSets(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const base = recipesDir(env);
	const sets = listRecipeSets(base);
	const oldBase = oldRecipesDir(env);
	const old = listRecipeSets(oldBase);
	const text = formatRecipeSets(base, sets);
	if (!old.length) return text;
	const names = new Set(sets.map((set) => set.name));
	const header = `recipe sets in ${oldBase} (serpcast's old data directory, read for one release when ${base} has no set of the name; \`searchcast doctor\` prints the command that moves them):`;
	return `${text}\n\n${formatRecipeSets(oldBase, old, header, (set) =>
		names.has(set.name)
			? `  not used:  ${join(base, set.name)} wins`
			: '  used:      no set of this name in the new directory',
	)}`;
}

/** `searchcast recipes list` output for `sets` found in `base`. */
export function formatRecipeSets(
	base: string,
	sets: RecipeSet[],
	header = `recipe sets in ${base}:`,
	note?: (set: RecipeSet) => string,
): string {
	if (!sets.length) return `no recipe sets installed in ${base}`;
	const lines = [header];
	for (const set of sets) {
		const {manifest, source, url, sha256, files, installedAt} =
			set.source ?? ({} as Partial<RecipeSetSource>);
		const version = manifest?.version ? ` ${manifest.version}` : '';
		const named =
			manifest?.name && manifest.name !== set.name
				? ` (manifest: ${manifest.name}${version})`
				: version;
		lines.push('', `${set.name}${named}`, `  dir:       ${set.dir}`);
		if (note) lines.push(note(set));
		if (!set.source)
			lines.push(`  source:    unknown (no readable ${SOURCE_FILE})`);
		else {
			lines.push(`  source:    ${source}`);
			if (url && url !== source) lines.push(`  from:      ${url}`);
			lines.push(`  sha256:    ${sha256}`, `  installed: ${installedAt}`);
		}
		for (const file of set.files) {
			lines.push(`  ${file}${files?.[file] ? `  sha256 ${files[file]}` : ''}`);
		}
	}
	return lines.join('\n');
}
