// Test-only preload (`node --import <this file> ...`): hides packages from the
// process the way Node reports a package that is not installed.
//
// SEARCHCAST_TEST_HIDE is a comma-separated list of package names; importing
// one of them, or a subpath of one, fails with ERR_MODULE_NOT_FOUND and
// Node's own "Cannot find package" message. When SEARCHCAST_TEST_HIDDEN_LOG
// names a file, every such attempt is appended to it (one specifier per line),
// so a test can assert a package was never even asked for, even by code that
// would catch the failure.
import {appendFileSync} from 'node:fs';
import {registerHooks} from 'node:module';

const hidden = (process.env.SEARCHCAST_TEST_HIDE ?? '')
	.split(',')
	.filter(Boolean);
const log = process.env.SEARCHCAST_TEST_HIDDEN_LOG;

registerHooks({
	resolve(specifier, context, nextResolve) {
		const name = hidden.find(
			(n) => specifier === n || specifier.startsWith(`${n}/`),
		);
		if (!name) return nextResolve(specifier, context);
		if (log) appendFileSync(log, specifier + '\n');
		throw Object.assign(
			new Error(
				`Cannot find package '${name}' imported from ${context.parentURL}`,
			),
			{code: 'ERR_MODULE_NOT_FOUND'},
		);
	},
});
