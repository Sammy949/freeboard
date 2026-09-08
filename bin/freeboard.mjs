#!/usr/bin/env node
// The `freeboard` command.
//
// A wrapper rather than a shebang on dist/cli.js, because a loader hook has to be
// registered BEFORE the CLI's module graph is built. See bin/register-fetch.mjs for
// what the hook does and bin/cross-fetch-shim.cjs for why.

import './register-fetch.mjs';

// Imported dynamically and AFTER the hook, so the SDK's module graph is built with
// the redirect already in place. A static import would be hoisted above the register()
// call inside register-fetch.mjs and the hook would arrive too late.
//
// `../dist/cli.js`, not `./cli.js`: this wrapper lives in bin/ and the compiled CLI in
// dist/. Both are in `files`, so the relative path holds in an installed package
// exactly as it does in the repo.
await import('../dist/cli.js');
