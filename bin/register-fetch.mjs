// Registers the cross-fetch redirect. Import this for side effect, first.
//
// Two entry paths need the same hook and must not drift:
//   published:  bin/freeboard.mjs (the `freeboard` bin) imports this, then dist/cli.js
//   repo:       the npm scripts pass `--import ./bin/register-fetch.mjs` to tsx
//
// Keeping the register() call in one file is the point. A second copy would be a
// second thing to forget when the hook changes.
//
// NOTE that `cross-fetch` is no longer installed as a dependency at all — the old
// `overrides` entry that put a patched copy there is gone. So without this hook the
// SDK's `import fetch from 'cross-fetch'` fails with ERR_MODULE_NOT_FOUND. That is
// deliberate: a missing hook is now loud at startup rather than a silent fallback to
// the node-fetch behaviour that breaks on chunked indexer responses. See
// bin/cross-fetch-shim.cjs for the measurements.

import { register } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, 'fetch-hook.mjs')).href);
