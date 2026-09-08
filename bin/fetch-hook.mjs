// Resolve hook: redirect `cross-fetch` to the local shim.
//
// Registered by bin/freeboard.mjs before the CLI is imported. See the long note there
// for why an npm `overrides` entry cannot do this job in a published package.
//
// Deliberately narrow: it matches the exact specifier and nothing else, and defers to
// the default resolver for everything. A hook that guesses is a hook that breaks an
// unrelated import six months from now.

import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHIM = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'cross-fetch-shim.cjs'),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cross-fetch') {
    // `format: 'commonjs'` because the shim is CJS; without it Node re-sniffs the
    // file and the .cjs extension already answers, but stating it skips the guess.
    return { url: SHIM, shortCircuit: true, format: 'commonjs' };
  }
  return nextResolve(specifier, context);
}
