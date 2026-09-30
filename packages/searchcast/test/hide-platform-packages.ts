// `vi.mock('node:module', ...)` for in-process tests that need "no library
// anywhere" although the platform packages are linked in this workspace (see
// platform-packages.ts). No imports: the mock factory must not load src.

/**
 * `node:module` whose `createRequire(...).resolve` fails for the platform
 * packages the way it fails for a package that is not installed. For
 * `vi.mock('node:module', ...)`.
 */
export function hidingPlatformPackages(
	mod: typeof import('node:module'),
): typeof import('node:module') {
	const createRequire = (from: string | URL) => {
		const require = mod.createRequire(from);
		const real = require.resolve;
		const resolve = (id: string, options?: {paths?: string[]}) => {
			if (id.startsWith('@searchcast/libcurl-'))
				throw Object.assign(new Error(`Cannot find module '${id}'`), {
					code: 'MODULE_NOT_FOUND',
				});
			return real(id, options);
		};
		return Object.assign(require, {resolve});
	};
	const hiding = {...mod, createRequire} as typeof import('node:module');
	return {...hiding, default: hiding} as typeof import('node:module');
}
