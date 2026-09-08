// `npm run clean:state` — delete the per-user state.
//
// A separate script rather than a shell one-liner because it deletes a WALLET, its
// recovery phrase and the attester signing key, and none of those are recoverable.
// The confirmation gate is the whole point: `npm run clean` used to remove state as a
// side effect of clearing build artifacts, which was survivable while state lived in
// the repo next to a gitignored devnet wallet. Now that state is a per-user directory
// holding a mnemonic, deleting it silently is not acceptable.
//
// Losing .midnight-attester.json also means every existing deployment is dead: the
// contract bakes the verifying key into its constructor and has no rotation circuit,
// so attestations signed by a new key fail the in-circuit assert forever.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ATTESTER_STATE_FILE } from './attester.js';
import { STATE_FILE_NAME } from './network.js';
import { privateStateDbPath, stateHome } from './paths.js';
import { RESULTS_FILE } from './results-cache.js';
import { WALLET_STATE_DIR } from './wallet-state.js';

const home = stateHome();
const out = (s: string): void => {
  process.stdout.write(s);
};

/** Everything this command is willing to remove, and what each one costs. */
const targets: Array<{ p: string; what: string }> = [
  { p: path.join(home, STATE_FILE_NAME), what: 'wallet seed + recovery phrase, and every deploy record' },
  { p: path.join(home, ATTESTER_STATE_FILE), what: 'attester SIGNING KEY — every existing deployment becomes unusable' },
  { p: path.join(home, WALLET_STATE_DIR), what: 'wallet sync cache (costs a full re-sync, nothing more)' },
  { p: path.join(home, RESULTS_FILE), what: 'proved-once scenario records' },
  { p: privateStateDbPath(), what: 'private-state store' },
];

// Recovery phrase files are per-network, so they are matched rather than listed.
const phraseFiles = fs.existsSync(home)
  ? fs
      .readdirSync(home)
      .filter((f) => /^recovery-phrase\..*\.txt$/.test(f))
      .map((f) => ({ p: path.join(home, f), what: 'a 24-word recovery phrase' }))
  : [];

const present = [...targets, ...phraseFiles].filter((t) => fs.existsSync(t.p));

out(`\n  State home: ${home}\n\n`);

if (present.length === 0) {
  out('  Nothing to delete.\n\n');
  process.exit(0);
}

for (const { p, what } of present) {
  out(`    ${path.relative(home, p).padEnd(28)} ${what}\n`);
}

if (process.env.FREEBOARD_CLEAN_CONFIRM !== '1') {
  out('\n  Not deleted. This is irreversible, so it needs an explicit confirmation:\n');
  out('    FREEBOARD_CLEAN_CONFIRM=1 npm run clean:state\n\n');
  process.exit(1);
}

for (const { p } of present) fs.rmSync(p, { recursive: true, force: true });
out(`\n  Deleted ${present.length} item${present.length === 1 ? '' : 's'}.\n\n`);
