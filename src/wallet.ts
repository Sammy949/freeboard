// Wallet construction + sync-state restore.
//
// Mirrors network.ts in structure. The on-disk format and pure I/O live in
// wallet-state.ts (unit-tested from the scaffolder workspace, no SDK deps);
// this file is the glue between that format and the wallet SDK.

import { Buffer } from 'buffer';

// Ledger types now come from the midnight-js-protocol barrel, which re-exports
// ledger-v8 (8.1.0) under a stable subpath instead of depending on it directly.
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
// As of Midnight.js 4.1.x / ledger-v8 8.1.0 the wallet SDK is consolidated behind
// the single @midnight-ntwrk/wallet-sdk barrel, which re-exports the former
// wallet-sdk-facade / -hd / -shielded / -dust-wallet / -unshielded-wallet packages.
import {
  WalletFacade,
  DustWallet,
  HDWallet,
  Roles,
  ShieldedWallet,
  createKeystore,
  NoOpTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk';

import { fetchGenesisHash } from './chain-identity';
import type { NetworkConfig, NetworkId } from './network';
import {
  CHILD_KINDS,
  clearWalletState,
  loadWalletState,
  saveWalletState,
  type ChildKind,
  type DiscardReason,
  type PersistedWalletState,
} from './wallet-state';

export { unshieldedToken };
export type { PersistedWalletState };
export {
  loadWalletState,
  saveWalletState,
  clearWalletState,
  WALLET_STATE_DIR,
  WALLET_STATE_VERSION,
} from './wallet-state';

function deriveKeys(seed: string) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');
  const result = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();
  return result.keys;
}

export interface WalletContext {
  wallet: Awaited<ReturnType<typeof WalletFacade.init>>;
  shieldedSecretKeys: ReturnType<typeof ledger.ZswapSecretKeys.fromSeed>;
  dustSecretKey: ReturnType<typeof ledger.DustSecretKey.fromSeed>;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
  restored: { shielded: boolean; unshielded: boolean; dust: boolean };
  /**
   * Genesis hash of the chain this context was built against, or null when the
   * node would not say. Carried here so `persistWalletState` can stamp the cache
   * without every caller having to thread it through.
   */
  genesisHash: string | null;
}

export interface CreateWalletOptions {
  network: NetworkId;
  networkConfig: NetworkConfig;
  seed: string;
  /**
   * Whether to attempt to restore each child wallet from saved state.
   * Defaults to true. Pass false to force a from-seed sync (used by tests).
   */
  restore?: boolean;
  cwd?: string;
}

function warnRestoreFailure(kind: ChildKind, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`  ⚠ Could not restore ${kind} wallet state (${msg}); falling back to fresh sync.\n`);
}

const short = (hash: string) => `${hash.slice(0, 10)}…`;

/**
 * Explain a discarded cache. This has to be said out loud: the whole failure this
 * guard exists to prevent was silent, and a fresh sync with no explanation is how
 * you end up debugging the devnet instead of deleting a directory.
 */
function reportDiscard(reason: DiscardReason, current: string, cached?: string): void {
  const why = reason === 'chain-mismatch'
    ? `it was built against a different chain (cached genesis ${short(cached ?? '?')}, this chain ${short(current)})`
    : 'it carries no record of which chain it came from';
  process.stderr.write(`  ⚠ Discarded the wallet sync cache: ${why}.\n     Syncing from seed instead.\n`);
}

/**
 * Resolve the chain's identity so the cache can be validated against it. Failing
 * to read it is not fatal, but it does mean giving up the cache in both
 * directions: we neither restore one we cannot verify nor write one we could not
 * verify later. A slow sync is a cost; a silent hang is a bug.
 */
async function resolveGenesisHash(nodeUrl: string): Promise<string | null> {
  try {
    return await fetchGenesisHash(nodeUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  ⚠ ${msg}\n     Cannot verify the wallet cache against this chain, so syncing from seed.\n`);
    return null;
  }
}

/**
 * Build the wallet facade, restoring each child from saved state when
 * available and falling back to a from-seed start when not (or when restore
 * throws, e.g. after an SDK upgrade with an incompatible state format).
 *
 * Caller is responsible for `await wallet.waitForSyncedState()` afterwards.
 */
export async function createWallet(opts: CreateWalletOptions): Promise<WalletContext> {
  setNetworkId(opts.networkConfig.networkId);

  const keys = deriveKeys(opts.seed);
  const networkId = getNetworkId();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  // wallet-sdk 2.x takes a tagged UnshieldedSecretKey instead of a bare
  // Uint8Array, because ledger 9 supports two signature schemes ('schnorr' |
  // 'ecdsa') and the keystore has to know which one it holds — the scheme is
  // baked into the derived address and enforced at signature-provision time.
  // 'schnorr' is the NightExternal role's scheme (Roles.EcdsaUnshielded is the
  // separate ecdsa path), and matches what the SDK's own V1Builder uses.
  const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: keys[Roles.NightExternal] }, networkId);

  // Chain identity first: a cache is meaningless without knowing which chain it
  // belongs to, and asking costs one RPC round trip against a node we are about
  // to talk to anyway.
  const genesisHash = opts.restore === false
    ? null
    : await resolveGenesisHash(opts.networkConfig.node);

  let saved: PersistedWalletState = {};
  if (genesisHash !== null) {
    const load = loadWalletState(opts.network, genesisHash, { cwd: opts.cwd });
    if (load.discarded !== null) {
      reportDiscard(load.discarded, genesisHash, load.cachedGenesisHash);
      // Remove it rather than leave bytes that will be re-examined and re-rejected
      // on every future run. This is the caller `clearWalletState()` never had.
      clearWalletState(opts.network, { cwd: opts.cwd });
    }
    saved = load.state;
  }
  const restored = { shielded: false, unshielded: false, dust: false };

  const walletConfig = {
    networkId,
    indexerClientConnection: {
      indexerHttpUrl: opts.networkConfig.indexer,
      indexerWsUrl: opts.networkConfig.indexerWS,
    },
    provingServerUrl: new URL(opts.networkConfig.proofServer),
    relayURL: new URL(opts.networkConfig.node.replace(/^http/, 'ws')),
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: async (config) => {
      const cls = ShieldedWallet(config);
      if (saved.shielded !== undefined) {
        try {
          const restoredWallet = await (cls as any).restore(saved.shielded);
          restored.shielded = true;
          return restoredWallet;
        } catch (err) {
          warnRestoreFailure('shielded', err);
        }
      }
      return cls.startWithSecretKeys(shieldedSecretKeys);
    },
    unshielded: async (config) => {
      const cls = UnshieldedWallet(config);
      if (saved.unshielded !== undefined) {
        try {
          const restoredWallet = await (cls as any).restore(saved.unshielded);
          restored.unshielded = true;
          return restoredWallet;
        } catch (err) {
          warnRestoreFailure('unshielded', err);
        }
      }
      return cls.startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
    },
    dust: async (config) => {
      const cls = DustWallet(config);
      if (saved.dust !== undefined) {
        try {
          const restoredWallet = await (cls as any).restore(saved.dust);
          restored.dust = true;
          return restoredWallet;
        } catch (err) {
          warnRestoreFailure('dust', err);
        }
      }
      return cls.startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);
    },
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore, restored, genesisHash };
}

/**
 * Serialize each child wallet's current state and persist it for the next run.
 * Safe to call multiple times. Logs but does not throw on individual failures —
 * losing one child's state means the next run re-syncs that child only.
 *
 * No-ops when the chain could not be identified: an unstamped cache is exactly
 * the thing `loadWalletState` refuses to trust, so writing one would only
 * guarantee it is thrown away later.
 */
export async function persistWalletState(
  network: NetworkId,
  ctx: WalletContext,
  cwd?: string,
): Promise<void> {
  if (ctx.genesisHash === null) return;

  const next: PersistedWalletState = {};

  for (const kind of CHILD_KINDS) {
    try {
      const child = (ctx.wallet as unknown as Record<ChildKind, { serializeState: () => Promise<unknown> }>)[kind];
      const serialized = await child.serializeState();
      if (kind === 'dust') {
        next.dust = serialized as string;
      } else {
        next[kind] = serialized;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  ⚠ Could not serialize ${kind} wallet state (${msg}); next run will re-sync.\n`);
    }
  }

  saveWalletState(network, next, ctx.genesisHash, { cwd });
}
