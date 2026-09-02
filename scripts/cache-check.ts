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

import { TAGLINE, WORDMARK, WORDMARK_WIDTH } from '../src/banner';
import { toHttpRpcUrl } from '../src/chain-identity';
import {
  clearResults,
  loadResults,
  RESULTS_FILE,
  saveResults,
  type ResultsCache,
} from '../src/results-cache';
import { CACHEABLE_SCENARIOS, SCENARIOS } from '../src/scenarios';
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

  console.log('\nScenario set');
  // The split is load-bearing, not cosmetic: the tampered case writes nothing to
  // the ledger, so it can never be served from a cache. Asserted so a later edit
  // cannot quietly make it cacheable.
  check('exactly one scenario is live-only', SCENARIOS.filter((s) => s.liveOnly).length === 1);
  check('the tampered scenario is the live-only one',
    SCENARIOS.find((s) => s.liveOnly)?.id === 'tampered');
  check('nothing cacheable is live-only', CACHEABLE_SCENARIOS.every((s) => !s.liveOnly));
  check('every cacheable scenario has a bar to clear',
    CACHEABLE_SCENARIOS.every((s) => s.input.minHealthFactorBps > 0n));

  console.log('\nResults cache binding');
  const RESULT_CONTRACT = 'c0ffee';
  const record = {
    id: 'safe' as const,
    label: 'Healthy position',
    summary: 'x',
    minHealthFactorBps: '15000',
    signed: { collateral: '1000000', debt: '400000', liquidationThresholdBps: '8500', asOf: '1788300000' },
    healthFactor: '2.1250',
    verdict: 'safe' as const,
    txId: '0xdeadbeef',
    blockHeight: '42',
    provedAt: 1788300000,
  };
  const cache: ResultsCache = {
    version: 1,
    network: NET,
    genesisHash: A,
    contractAddress: RESULT_CONTRACT,
    scenarios: [record],
  };

  const none = loadResults(A, RESULT_CONTRACT, { cwd });
  check('no file: no-cache, nothing returned', none.status === 'no-cache' && none.cache === null);

  saveResults(cache, { cwd });
  const current = loadResults(A, RESULT_CONTRACT, { cwd });
  check('same chain and contract: current',
    current.status === 'current' && current.cache?.scenarios[0]?.txId === '0xdeadbeef', current.status);

  const wrongChain = loadResults(B, RESULT_CONTRACT, { cwd });
  // The records still come back so the UI can say "re-run prime" rather than
  // showing an empty page; it is the STATUS that withholds trust.
  check('different chain: chain-mismatch, records still readable',
    wrongChain.status === 'chain-mismatch' && wrongChain.cache?.scenarios.length === 1, wrongChain.status);

  const wrongContract = loadResults(A, 'deadbeef', { cwd });
  check('redeployed contract: contract-mismatch',
    wrongContract.status === 'contract-mismatch', wrongContract.status);

  const noChainId = loadResults(null, RESULT_CONTRACT, { cwd });
  check('unidentifiable chain: chain-unknown, never current',
    noChainId.status === 'chain-unknown', noChainId.status);

  fs.writeFileSync(path.join(cwd, RESULTS_FILE), '{ not json');
  check('corrupt file: unreadable, nothing returned',
    loadResults(A, RESULT_CONTRACT, { cwd }).status === 'unreadable');

  saveResults({ ...cache, version: 99 as unknown as 1 }, { cwd });
  check('wrong version: unreadable rather than half-trusted',
    loadResults(A, RESULT_CONTRACT, { cwd }).status === 'unreadable');

  clearResults({ cwd });
  check('clearResults removes the file', !fs.existsSync(path.join(cwd, RESULTS_FILE)));

  console.log('\nWordmark');
  // The per-glyph table lives HERE, not in banner.ts, so the shipped constant has
  // something independent to be checked against. Comparing letterforms rather than
  // row widths is the only check that works: the first draft of row 4 carried B's
  // third row where R's fourth belonged, and both forms are 8 columns wide, so a
  // width assertion passed a visibly broken mark.
  const GLYPHS: Record<string, string[]> = {
    F: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '██║     ', '╚═╝     '],
    R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
    E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
    B: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██████╔╝', '╚═════╝ '],
    O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
    A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  };
  const word = [...'FREEBOARD'];
  const composed = [0, 1, 2, 3, 4, 5].map((i) => word.map((c) => GLYPHS[c][i]).join(''));

  check('six rows', WORDMARK.length === 6, String(WORDMARK.length));
  check(
    `every row is ${WORDMARK_WIDTH} columns`,
    WORDMARK.every((r) => [...r].length === WORDMARK_WIDTH),
    [...new Set(WORDMARK.map((r) => [...r].length))].join(','),
  );
  for (let i = 0; i < composed.length; i++) {
    // On failure, name the glyph and column rather than printing two 73-column
    // strings and leaving the reader to diff them by eye.
    let detail = '';
    if (WORDMARK[i] !== composed[i]) {
      let off = 0;
      for (const c of word) {
        const n = [...GLYPHS[c][i]].length;
        const got = [...(WORDMARK[i] ?? '')].slice(off, off + n).join('');
        if (got !== GLYPHS[c][i]) detail += `${c} at col ${off}: "${got}" should be "${GLYPHS[c][i]}" `;
        off += n;
      }
    }
    check(`row ${i + 1} letterforms`, WORDMARK[i] === composed[i], detail.trim());
  }
  check('taglines fit under the mark', TAGLINE.every((t) => [...t].length <= WORDMARK_WIDTH),
    TAGLINE.map((t) => [...t].length).join(','));
  check('the wordmark carries no newlines (chalk would emit coloured blank lines)',
    WORDMARK.every((r) => !r.includes('\n')));

  fs.rmSync(cwd, { recursive: true, force: true });

  console.log(failures === 0 ? '\n✅ cache-check passed\n' : `\n❌ cache-check: ${failures} failed\n`);
  if (failures > 0) process.exit(1);
}

await main();
