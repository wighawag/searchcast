// Says, once per run and visibly, which native-library tests are skipped and
// how to run them (a message logged inside a skipped test file is swallowed).

import {platformPackageLibrary} from '../src/libcurl.js';

export default function setup(): void {
	if (!process.env.SEARCHCAST_LIBCURL_PATH) {
		process.stderr.write(
			'\n[searchcast] Skipping the native transport tests: no library configured. Set SEARCHCAST_LIBCURL_PATH to a libcurl-impersonate shared library to run them.\n',
		);
	}
	if (!process.env.SEARCHCAST_TEST_PLAIN_LIBCURL) {
		process.stderr.write(
			'[searchcast] Skipping the plain-libcurl strict-mode tests: set SEARCHCAST_TEST_PLAIN_LIBCURL to a plain libcurl shared library to run them.\n',
		);
	}
	if (!platformPackageLibrary()) {
		process.stderr.write(
			`[searchcast] Skipping the platform-package tests: this platform's @searchcast/libcurl-${process.platform}-${process.arch} has no library. Build it with \`node scripts/libcurl-packages.mjs build ${process.platform}-${process.arch}\` (downloads the pinned archive) to run them.\n`,
		);
	}
	process.stderr.write('\n');
}
