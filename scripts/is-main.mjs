// Whether the script at `moduleUrl` (its `import.meta.url`) is the one Node was
// asked to run, as opposed to imported by another module (a test, another
// script). Every root script with a CLI decides with this, and only this.
//
// Compared through realpath: Node reports `import.meta.url` as the real path,
// so comparing it with the unresolved `process.argv[1]` is false when the
// script is run through a symlink, and the script would exit 0 having done
// nothing, which for a guard reads as "passed".
//
// When `process.argv[1]` cannot be resolved (no such path, e.g. `node -e`),
// the plain resolved paths are compared instead of throwing: that is never
// true for a module that is merely imported, and it is the comparison the
// scripts made before.

import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

function real(path) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/** True when the module at `moduleUrl` is the entry point of this process. */
export function isMain(moduleUrl, argv = process.argv) {
	if (!argv[1]) return false;
	return real(resolve(argv[1])) === real(fileURLToPath(moduleUrl));
}
