// Where Freeboard keeps its state.
//
// WHY THIS EXISTS. Every state module used to default to `process.cwd()`. That is
// right for a repo-local dev tool and wrong for a globally installed CLI, in three
// ways that were all measured before this file was written:
//
// 1. IDENTITY FOLLOWED THE SHELL. `freeboard` in ~/work and `freeboard` in ~/tmp
//    generated two different wallets, each silently created, each printing its own
//    recovery phrase. Fund one, run from the other, and the balance reads zero with
//    no explanation.
// 2. SECRETS SCATTERED. A signing key and a 24-word mnemonic landed in whatever
//    directory happened to be current — including, easily, a git repo that is not
//    this one and does not gitignore them.
// 3. NOTHING WAS SHAREABLE. The wallet sync cache is the expensive thing to rebuild
//    (minutes on a public network), and keying it to a directory threw it away every
//    time you moved.
//
// So state is per-user, in one place, following the XDG Base Directory spec:
// $XDG_CONFIG_HOME/freeboard, else ~/.config/freeboard.
//
// FREEBOARD_HOME overrides it outright. That is the seam the tests use, and the way
// to run two isolated identities on one machine on purpose rather than by accident.
//
// Every state function still takes an explicit `cwd`, unchanged — this only moves
// the DEFAULT. Nothing here reads or writes; it resolves paths and creates the
// directory, so it stays importable with no chain, no wallet and no network.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The env var that overrides the state directory outright. */
export const HOME_ENV = 'FREEBOARD_HOME';

/**
 * The directory Freeboard keeps its state in.
 *
 * Not memoized: `FREEBOARD_HOME` is read on every call so a test can set it after
 * this module has already been imported. Resolving a path is cheap; a stale cached
 * home is a bug that only shows up under test.
 */
export function stateHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[HOME_ENV]?.trim();
  if (override) return path.resolve(override);

  const xdg = env.XDG_CONFIG_HOME?.trim();
  // XDG requires an absolute path and says to ignore a relative one.
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, 'freeboard');

  return path.join(os.homedir(), '.config', 'freeboard');
}

/**
 * The state directory, created if absent, mode 0700.
 *
 * 0700 because this directory holds a wallet seed, a recovery phrase and the
 * attester signing key. The individual files are written 0600 by their own modules;
 * the directory bit is what stops another user listing them at all.
 *
 * `mkdirSync` with `recursive: true` applies the mode only to directories it
 * actually creates, so an existing directory keeps whatever the user set. That is
 * deliberate: silently tightening a directory someone widened on purpose is not
 * this function's business.
 */
export function ensureStateHome(env: NodeJS.ProcessEnv = process.env): string {
  const dir = stateHome(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * The LevelDB directory for the private-state store.
 *
 * The SDK's level provider defaults `midnightDbName` to `midnight-level-db`,
 * relative to cwd, and that name is NOT the `privateStateStoreName` — passing a
 * different store name still writes into the same directory (measured: a probe with
 * `privateStateStoreName: 'locktest-state'` landed its keys inside the real
 * `midnight-level-db`, alongside the freeboard ones). So the path has to be set
 * explicitly via `midnightDbName`, which the provider does accept.
 */
export function privateStateDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateHome(env), 'private-state-db');
}

/**
 * Where a freshly generated recovery phrase is written.
 *
 * A mnemonic on stdout is a wallet-controlling secret in every log, pipe and
 * screenshare that captures it, so the phrase goes to a 0600 file and the CLI
 * prints the PATH. See `writeRecoveryPhrase`.
 */
export function recoveryPhrasePath(network: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateHome(env), `recovery-phrase.${network}.txt`);
}

/**
 * True when running from an installed package rather than a repo checkout.
 *
 * This decides what REMEDY an error message is allowed to suggest. "Run
 * `npm run compile`" is correct advice in the repo and a dead end for someone who
 * installed the CLI — they have no package.json with those scripts, and telling them
 * to run one is worse than saying nothing.
 *
 * Detected by the absence of `src/`: the published `files` allowlist ships `bin/`,
 * `dist/` and `contracts/`, deliberately not `src/`, so its absence beside the package
 * root is a reliable signal. Cheaper and more robust than string-matching
 * `node_modules` in a path, which breaks for `npm link` and global prefixes.
 */
export function isInstalledPackage(): boolean {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return !fs.existsSync(path.join(packageRoot, 'src'));
}
