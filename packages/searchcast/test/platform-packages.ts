// Test helpers for the platform packages `@searchcast/libcurl-<platform>`.
// This workspace links every one of them into searchcast's node_modules, and CI
// builds the linux-x64 library (the native tests load it), so a test that needs
// "no library anywhere" must hide them: CLI runs with the `hide-modules.mjs`
// preload, in-process tests by mocking `node:module` with
// `hidingPlatformPackages` (hide-platform-packages.ts).

import {resolve} from 'node:path';
import {LIBCURL_IMPERSONATE, platformPackageName} from '../src/libcurl.js';

/** Every platform package name. */
export const PLATFORM_PACKAGES = Object.keys(LIBCURL_IMPERSONATE.assets).map(
	platformPackageName,
);

/** Node arguments for a CLI run that hides the platform packages (with `hideEnv`). */
export const HIDE_ARGS = [
	'--import',
	resolve(import.meta.dirname, 'hide-modules.mjs'),
];

/** `env` plus what makes `HIDE_ARGS` hide the platform packages. */
export function hideEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return {...env, SEARCHCAST_TEST_HIDE: PLATFORM_PACKAGES.join(',')};
}
