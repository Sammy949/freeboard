// Regression check for wallet-cache chain binding — `npm run test:cache`.
//
// Guards the failure this logic exists to prevent: a wallet cache from a dead
// chain does not error when restored, it HANGS (16 minutes of `Still syncing...`
// with zero CPU, measured 2026-09-01). Every assertion below is pure — no node,
// no indexer, no proof server — so this runs on a clean clone and in CI. The
// live half (a real chain answering `chain_getBlockHash`) is covered by
// `npm run test:e2e` and by fetchGenesisHash's own shape validation.
//
// Follows the same hand-rolled style as e2e-check.ts rather than pulling in a
// test framework the project does not otherwise have.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { toHttpRpcUrl } from '../src/chain-identity';
import { persistWalletState, type WalletContext } from '../src/wallet';
import { clearWalletState, loadWalletState, saveWalletState } from '../src/wallet-state';

const A = `0x${'a'.repeat(64)}`;
const B = `0x${'b'.repeat(64)}`;
const NET = 'undeployed-l9' as const;

let failures = 0;

function check(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures += 1;
  // Detail is only interesting when something failed; on a pass it is noise.
  console.log(`  ${pass ? '✓' : '✗'} ${label}${!pass && detail ? ` (got: ${detail})` : ''}`);
}

async function main(): Promise<void> {
  console.log('\nURL normalisation (NETWORK_CONFIGS holds ws:// for devnets, https:// for public)');
  for (const [input, want] of [
    ['ws://127.0.0.1:19944', 'http://127.0.0.1:19944'],
    ['wss://rpc.example.network', 'https://rpc.example.network'],
    ['https://rpc.example.network', 'https://rpc.example.network'],
    ['http://127.0.0.1:9944', 'http://127.0.0.1:9944'],
  ] as const) {
    check(`${input} -> ${want}`, toHttpRpcUrl(input) === want, toHttpRpcUrl(input));
  }

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'freeboard-cache-check-'));
  const dir = path.join(cwd, '.midnight-wallet-state', NET);

  console.log('\nCache binding');
  // A clean first run must not report a discard: there is nothing to discard, and
  // a warning on a fresh clone would be noise.
  const fresh = loadWalletState(NET, A, { cwd });
  check('empty dir: no discard, empty state', fresh.discarded === null && fresh.state.shielded === undefined);

  saveWalletState(NET, { shielded: { s: 1 }, unshielded: { u: 2 }, dust: 'd3' }, A, { cwd });
  const written = fs.readdirSync(dir).sort().join(',');
  check('save stamps the chain alongside the children',
    written === 'chain.json,dust.json,shielded.json,unshielded.json', written);

  const same = loadWalletState(NET, A, { cwd });
  check('matching genesis restores',
    same.discarded === null && (same.state.shielded as { s?: number })?.s === 1 && same.state.dust === 'd3');

  const other = loadWalletState(NET, B, { cwd });
  check('different genesis discards, and no state leaks through',
    other.discarded === 'chain-mismatch' && other.state.shielded === undefined);
  check('mismatch reports which chain the cache was for', other.cachedGenesisHash === A);

  // Every cache written before chain binding existed looks like this.
  fs.rmSync(path.join(dir, 'chain.json'));
  const legacy = loadWalletState(NET, A, { cwd });
  check('children with no chain record are not trusted',
    legacy.discarded === 'no-chain-record' && legacy.state.dust === undefined);

  clearWalletState(NET, { cwd });
  check('clearWalletState empties the network dir', !fs.existsSync(dir));

  console.log('\nPersist guard');
  const ctx = {
    genesisHash: null,
    wallet: {
      shielded: { serializeState: async () => ({ s: 9 }) },
      unshielded: { serializeState: async () => ({ u: 9 }) },
      dust: { serializeState: async () => 'd9' },
    },
  } as unknown as WalletContext;

  await persistWalletState(NET, ctx, cwd);
  check('unidentified chain writes nothing rather than an unverifiable cache', !fs.existsSync(dir));

  await persistWalletState(NET, { ...ctx, genesisHash: B } as WalletContext, cwd);
  const back = loadWalletState(NET, B, { cwd });
  check('identified chain persists and round-trips', back.discarded === null && back.state.dust === 'd9');

  fs.rmSync(cwd, { recursive: true, force: true });

  console.log(failures === 0 ? '\n✅ cache-check passed\n' : `\n❌ cache-check: ${failures} failed\n`);
  if (failures > 0) process.exit(1);
}

await main();
