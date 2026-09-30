// Test-only launcher: runs the built `./cli` entry the way the `searchcast` 0.1.x
// bin ran its CLI (`node cli.js <args>`), so the end-to-end CLI tests exercise
// `runCli` as a real process. Imported through the package's own `exports`
// (a self-reference), so the `./cli` subpath is what is tested. Deleted when
// the `searchcast` bin delegates to it (task `searchcast-serve-command`).
import {runCli} from '@searchcast/browser/cli';

runCli(process.argv.slice(2));
