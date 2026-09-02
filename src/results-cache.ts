// Proved-once check results, cached on disk.
//
// WHY A CACHE. One check is a ZK proof plus a transaction plus an indexer read:
// about 45 seconds against the local devnet (measured 2026-09-01). Three preset
// scenarios behind three clicks is minutes of spinner in a demo whose whole point
// is a fast, private answer. So the presets are proved once, ahead of time, and
// the page serves the records.
//
// WHY THE RECORDS ARE AUTHORITATIVE RATHER THAN RE-READ FROM THE LEDGER. The
// contract keeps ONE verdict (`lastVerdict`), not one per scenario. Prove the
// healthy position and then the undercollateralised one and the ledger reads
// `at_risk`; re-reading it for the healthy scenario would answer with the other
// scenario's verdict. Each record is therefore the authority for its own
// scenario, and the live ledger read (`GET /verdict`) is a SEPARATE
// current-chain-state view that corroborates whichever check landed last. The two
// must never be conflated in the UI.
//
// WHY IT IS BOUND TO THE CHAIN. Local devnets declare no volumes, so every
// restart is a new chain: new genesis hash, new deployment, and no record of
// these transactions. A cached record naming a txId from a dead chain is worse
// than no record, because it still looks verified. That is the same failure the
// wallet cache has (wallet-state.ts, where restoring across chains hangs instead
// of erroring), so it gets the same guard — the genesis hash and the contract
// address are stored with the records and REQUIRED positionally to read them
// back, so the precondition cannot be forgotten.
//
// Pure fs, no SDK imports, `cwd` injectable — like network.ts and wallet-state.ts
// — so the format is assertable with no chain running (scripts/cache-check.ts).

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { NetworkId } from './network';
import type { ScenarioId } from './scenarios';

export const RESULTS_FILE = '.midnight-results.json';
export const RESULTS_VERSION = 1 as const;

/**
 * Circuit and chain values are decimal STRINGS, not numbers: a `Uint<64>`
 * collateral and a block height both exceed `Number.MAX_SAFE_INTEGER`, and this
 * file is served to the browser verbatim. `provedAt` is our own wall clock and
 * stays a number.
 */
export interface PositionRecord {
  collateral: string;
  debt: string;
  liquidationThresholdBps: string;
  /** Unix seconds, as fixed by the attester and mirrored to the ledger. */
  asOf: string;
}

export interface ScenarioRecord {
  id: ScenarioId;
  label: string;
  summary: string;
  /** The public input: the bar the verifier set. */
  minHealthFactorBps: string;
  /** What the attester signed. For a cached record this is also what was sent. */
  signed: PositionRecord;
  /** Rendered off-circuit for display only; the circuit's answer is `verdict`. */
  healthFactor: string;
  verdict: 'safe' | 'at_risk';
  txId: string;
  blockHeight: string;
  /** Unix seconds when this proof was made. */
  provedAt: number;
}

export interface ResultsCache {
  version: typeof RESULTS_VERSION;
  network: NetworkId;
  /** The chain these transactions live on. */
  genesisHash: string;
  /** The deployment they were proved against. */
  contractAddress: string;
  scenarios: ScenarioRecord[];
}

/**
 * Why the cached records are (or are not) trustworthy right now.
 *
 * `chain-unknown` is deliberately not fatal: the records are real history and are
 * still worth showing, but nothing may claim they are current until the node
 * answers. The UI must say which of these it is looking at.
 */
export type ResultsStatus =
  | 'current'
  | 'chain-mismatch'
  | 'contract-mismatch'
  | 'chain-unknown'
  | 'no-cache'
  | 'unreadable';

export interface ResultsLoad {
  /** Present whenever the file parsed, even when the binding no longer holds. */
  cache: ResultsCache | null;
  status: ResultsStatus;
}

export interface FsOptions {
  cwd?: string;
}

function resultsPath(opts: FsOptions = {}): string {
  return path.join(opts.cwd ?? process.cwd(), RESULTS_FILE);
}

// Deliberately duplicated from wallet-state.ts rather than shared: both modules
// are standalone by design, importing nothing but types.
function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function isCache(value: unknown): value is ResultsCache {
  const c = value as ResultsCache | null;
  return (
    !!c &&
    typeof c === 'object' &&
    c.version === RESULTS_VERSION &&
    typeof c.genesisHash === 'string' &&
    typeof c.contractAddress === 'string' &&
    Array.isArray(c.scenarios)
  );
}

/**
 * Read the cached records, but only call them current if they were proved against
 * this chain AND this deployment.
 *
 * `genesisHash` is `null` when the node could not be identified at all; that is
 * reported as `chain-unknown` rather than silently accepted, because a cache that
 * cannot be checked is not a cache that passed.
 */
export function loadResults(
  genesisHash: string | null,
  contractAddress: string | null,
  opts: FsOptions = {},
): ResultsLoad {
  const file = resultsPath(opts);
  if (!fs.existsSync(file)) return { cache: null, status: 'no-cache' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return { cache: null, status: 'unreadable' };
  }
  // A wrong version or a torn file is the same situation as no cache: re-prove.
  if (!isCache(parsed)) return { cache: null, status: 'unreadable' };

  if (genesisHash === null) return { cache: parsed, status: 'chain-unknown' };
  if (parsed.genesisHash !== genesisHash) return { cache: parsed, status: 'chain-mismatch' };
  if (contractAddress !== null && parsed.contractAddress !== contractAddress) {
    return { cache: parsed, status: 'contract-mismatch' };
  }
  return { cache: parsed, status: 'current' };
}

export function saveResults(cache: ResultsCache, opts: FsOptions = {}): void {
  atomicWrite(resultsPath(opts), `${JSON.stringify(cache, null, 2)}\n`);
}

export function clearResults(opts: FsOptions = {}): void {
  fs.rmSync(resultsPath(opts), { force: true });
}
