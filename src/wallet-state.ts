// Wallet sync-state persistence.
//
// Mirrors network.ts: no template substitutions, all I/O via function
// parameters, no SDK imports — keeps the module unit-testable from the
// create-mn-app workspace (which doesn't install @midnight-ntwrk/* packages).
//
// Why: without persistence, every `npm run deploy` / `npm run cli` rebuilds
// each child wallet from seed and re-syncs against the chain. On public
// networks (preview, preprod) that's minutes per run — and painful on retries
// after a transient failure. The SDK exposes serializeState() and restore()
// on each child wallet class; wallet.ts is the glue that uses them, and this
// file is the on-disk format underneath.
//
// A cache is only valid for the chain it was built against, and nothing in the
// serialized blobs says which chain that was. Restoring a cache onto a
// different chain does not error — it HANGS, because the wallet waits for a
// checkpoint the new genesis has never heard of (measured 2026-09-01: 16
// minutes of `Still syncing...` with zero CPU, versus 45s from scratch). Local
// devnets declare no volumes, so every restart is a new chain and reproduces
// this. So the genesis hash is stored alongside the child states in `chain.json`
// and `loadWalletState` REQUIRES the caller to pass the current one. It is a
// positional parameter, not an option, specifically so the precondition cannot
// be forgotten: there is no way to read this cache without saying which chain
// you are on.

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { NetworkId } from './network';

export const WALLET_STATE_DIR = '.midnight-wallet-state';
export const WALLET_STATE_VERSION = 1 as const;

export type ChildKind = 'shielded' | 'unshielded' | 'dust';
export const CHILD_KINDS: readonly ChildKind[] = ['shielded', 'unshielded', 'dust'] as const;

export interface PersistedWalletState {
  shielded?: unknown;
  unshielded?: unknown;
  dust?: string;
}

/** Why a cache on disk was not used. `null` means it was (or there was none). */
export type DiscardReason = 'chain-mismatch' | 'no-chain-record';

export interface WalletStateLoad {
  state: PersistedWalletState;
  discarded: DiscardReason | null;
  /** The genesis hash the on-disk cache was built against, when one is recorded. */
  cachedGenesisHash?: string;
}

export interface FsOptions {
  cwd?: string;
}

function networkDir(network: NetworkId, opts: FsOptions = {}): string {
  return path.join(opts.cwd ?? process.cwd(), WALLET_STATE_DIR, network);
}

function statePath(network: NetworkId, kind: ChildKind, opts: FsOptions = {}): string {
  return path.join(networkDir(network, opts), `${kind}.json`);
}

function chainPath(network: NetworkId, opts: FsOptions = {}): string {
  return path.join(networkDir(network, opts), 'chain.json');
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

interface VersionedState<T> {
  version: typeof WALLET_STATE_VERSION;
  state: T;
}

function readVersionedState<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as VersionedState<T>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== WALLET_STATE_VERSION) {
      return undefined;
    }
    return parsed.state;
  } catch {
    // Corrupt file — caller falls back to from-seed sync; we'll overwrite on save.
    return undefined;
  }
}

function writeVersionedState<T>(file: string, state: T): void {
  const payload: VersionedState<T> = { version: WALLET_STATE_VERSION, state };
  atomicWrite(file, `${JSON.stringify(payload)}\n`);
}

/**
 * Read the cache for `network`, but only if it was built against
 * `genesisHash`. A cache with no chain record is treated as untrustworthy
 * rather than assumed-current: it predates this check, so nothing proves which
 * chain it came from, and guessing wrong costs a silent hang.
 */
export function loadWalletState(
  network: NetworkId,
  genesisHash: string,
  opts: FsOptions = {},
): WalletStateLoad {
  const cached = readVersionedState<string>(chainPath(network, opts));

  if (cached === undefined) {
    // No record at all. If there is also no cache, this is a clean first run and
    // there is nothing to report; only call it a discard if state exists.
    const hasState = CHILD_KINDS.some((k) => fs.existsSync(statePath(network, k, opts)));
    return { state: {}, discarded: hasState ? 'no-chain-record' : null };
  }

  if (cached !== genesisHash) {
    return { state: {}, discarded: 'chain-mismatch', cachedGenesisHash: cached };
  }

  return {
    state: {
      shielded: readVersionedState(statePath(network, 'shielded', opts)),
      unshielded: readVersionedState(statePath(network, 'unshielded', opts)),
      dust: readVersionedState<string>(statePath(network, 'dust', opts)),
    },
    discarded: null,
    cachedGenesisHash: cached,
  };
}

/**
 * Persist the cache together with the genesis hash it belongs to. The chain
 * record is written LAST: if the process dies mid-write, the next run sees a
 * chain record that does not match the half-written children (or none at all)
 * and re-syncs, rather than restoring a torn cache.
 */
export function saveWalletState(
  network: NetworkId,
  state: PersistedWalletState,
  genesisHash: string,
  opts: FsOptions = {},
): void {
  if (state.shielded !== undefined) writeVersionedState(statePath(network, 'shielded', opts), state.shielded);
  if (state.unshielded !== undefined) writeVersionedState(statePath(network, 'unshielded', opts), state.unshielded);
  if (state.dust !== undefined) writeVersionedState(statePath(network, 'dust', opts), state.dust);
  writeVersionedState(chainPath(network, opts), genesisHash);
}

export function clearWalletState(network: NetworkId, opts: FsOptions = {}): void {
  const dir = networkDir(network, opts);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
