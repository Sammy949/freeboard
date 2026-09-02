/**
 * The Freeboard client: one place that knows how to talk to the contract.
 *
 * This module exists because there are now two front ends — the CLI and the web
 * dashboard — and exactly one correct way to run a check. Duplicating the
 * attest → stage → prove → interpret sequence in a second place would mean two
 * subtly different demos, and the one that drifted would be the one on screen.
 *
 * It deliberately prints NOTHING. Every function either returns data or throws;
 * how that reads is the caller's problem. The CLI keeps its chalk/ora/boxen
 * presentation, the web route serialises to JSON, and neither has to know what
 * the other renders.
 *
 * The other reason it exists: the per-call witness slot. The contract instance is
 * built once with a supplier that reads a mutable slot, and every call must fill
 * that slot immediately before proving and clear it afterwards. Getting that
 * wrong means a stale position silently serving a later call. So the slot lives
 * here, private to the module, and nothing outside can touch it — the only way
 * to reach it is `submitCheck`, which always clears in a `finally`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { JubjubPoint, JubjubSchnorrSignature } from '@midnight-ntwrk/compact-runtime';

import {
  getDeployment,
  resolveNetwork,
  getOrCreateWallet,
  type DeploymentRecord,
  type NetworkConfig,
  type NetworkId,
} from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { loadOrCreateAttesterKey, signPosition, verifyPosition, type Position } from './attester';
import { freeboardWitnesses, type AttestedPosition } from './witnesses';

// Must match the privateStateId used at deploy time, or a reconnect lands on a
// different private-state store than the one the deployment registered.
export const PRIVATE_STATE_ID = 'freeboardPrivateState';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZK_CONFIG_PATH = path.resolve(__dirname, '..', 'contracts', 'managed', 'freeboard');
const CONTRACT_ENTRY = path.join(ZK_CONFIG_PATH, 'contract', 'index.js');

/** Thrown when the Compact output is missing, so callers can say "run compile". */
export class ContractNotCompiledError extends Error {
  constructor() {
    super(`Contract not compiled — no artifacts at ${path.relative(process.cwd(), CONTRACT_ENTRY)}. Run: npm run compile`);
    this.name = 'ContractNotCompiledError';
  }
}

/** Thrown when the requested network has no deployment on file. */
export class NoDeploymentError extends Error {
  constructor(public readonly network: NetworkId) {
    super(`No deploy on file for network ${network}. Run \`npm run setup -- --network ${network}\` first.`);
    this.name = 'NoDeploymentError';
  }
}

// ─── The contract module (dynamically imported) ────────────────────────────────

type ContractModule = {
  Contract: unknown;
  ledger: (data: unknown) => {
    lastVerdict: bigint | number;
    lastAttestationAt: bigint;
    checkCount: bigint;
    attesterPk: JubjubPoint;
  };
};

let contractModule: ContractModule | null = null;

/** Imports the generated contract once. Throws if `npm run compile` has not run. */
async function loadContractModule(): Promise<ContractModule> {
  if (contractModule) return contractModule;
  if (!fs.existsSync(CONTRACT_ENTRY)) throw new ContractNotCompiledError();
  contractModule = (await import(pathToFileURL(CONTRACT_ENTRY).href)) as ContractModule;
  return contractModule;
}

// ─── The per-call witness slot ─────────────────────────────────────────────────
//
// Module-private on purpose. Freeboard's witnesses are per-call, not durable
// state: each checkSolvency is about one specific attested position. The
// contract is built once with a supplier reading this slot; `submitCheck` fills
// it immediately before the call and clears it in a `finally`.

let pendingAttestation: AttestedPosition | null = null;

const witnesses = freeboardWitnesses(() => {
  if (!pendingAttestation) {
    throw new Error(
      'No attested position staged — a checkSolvency call reached the witnesses outside ' +
        'submitCheck(). This is a bug in freeboard-client.ts, not bad input.',
    );
  }
  return pendingAttestation;
});

/**
 * Builds the compiled-contract handle.
 *
 * Called through `any` because the contract is imported dynamically: the
 * combinators' parameters are conditional types over the contract's own type,
 * which collapse to `never` once that type is `any`. Same reasoning as deploy.ts.
 */
function buildCompiledContract(mod: ContractModule): unknown {
  const CC = CompiledContract as any;
  return CC.withCompiledFileAssets(CC.withWitnesses(CC.make('freeboard', mod.Contract), witnesses), ZK_CONFIG_PATH);
}

// ─── Providers ─────────────────────────────────────────────────────────────────

export function createFreeboardProviders(networkConfig: NetworkConfig, walletCtx: WalletContext) {
  // The SDK requires the private-state password to be at least 16 characters.
  // The default below is a placeholder for local devnet only — set a strong
  // password via PRIVATE_STATE_PASSWORD when you move to a non-local target.
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(ZK_CONFIG_PATH);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'freeboard-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── What a verifier can see ───────────────────────────────────────────────────

/**
 * The entire public ledger state — and the point of the project is that this is
 * ALL of it. There is no collateral, debt or threshold field to add here later;
 * the circuit never writes them.
 */
export interface LedgerView {
  verdict: 'safe' | 'at_risk';
  /** The raw ledger enum: 0 = at_risk, 1 = safe. 0 is the default, deliberately. */
  verdictRaw: number;
  /** Unix seconds, as fixed by the attester. `null` when no check has landed yet. */
  lastAttestationAt: bigint | null;
  checkCount: bigint;
  attesterPk: { x: bigint; y: bigint };
}

// ─── Staging a check ───────────────────────────────────────────────────────────

export interface CheckInput {
  collateral: bigint;
  debt: bigint;
  liquidationThresholdBps: bigint;
  /** The one public input: the bar the verifier is asking the position to clear. */
  minHealthFactorBps: bigint;
  /** Defaults to now, in unix seconds. */
  asOf?: bigint;
  /** Corrupt the position AFTER signing, to demonstrate the in-circuit assert. */
  tamper?: boolean;
}

/**
 * A signed position, ready to prove. Both versions are kept because the tamper
 * demo is only legible when you can see the two side by side.
 */
export interface StagedCheck {
  /** What the attester actually put its name to. */
  signed: Position;
  /** What the circuit will receive. Differs from `signed` only when tampering. */
  submitted: Position;
  signature: JubjubSchnorrSignature;
  /**
   * Off-circuit verification of `submitted`. The in-circuit assert is the real
   * gate, but reaching it costs a proof and a transaction; knowing here is free.
   */
  validLocally: boolean;
  tampered: boolean;
  minHealthFactorBps: bigint;
}

/**
 * The outcome of a check, as a discriminated union rather than a value-or-throw.
 *
 * `rejected-in-circuit` is a FIRST-CLASS RESULT, not an error: when a tampered
 * position is refused, the contract did its job. Modelling it as a thrown
 * exception pushes every caller into treating the demo's best moment as a
 * failure, which is exactly backwards.
 */
export type CheckResult =
  | {
      outcome: 'accepted';
      /** The circuit's own return value when the SDK surfaces it. */
      verdict: 'safe' | 'at_risk' | null;
      verdictRaw: number | null;
      txId: string;
      blockHeight: number | bigint;
    }
  | { outcome: 'rejected-in-circuit'; message: string }
  | { outcome: 'failed'; message: string };

/** The contract's own assert text, surfaced through a failed proof. */
const IN_CIRCUIT_REJECTION = 'not signed by the registered attester';

/**
 * Signs a position, off-chain and synchronously.
 *
 * A free function, not just a client method, because none of this needs a wallet,
 * a node or a proof server — and keeping it callable without them means the
 * signing and tamper logic can be tested with the chain down, which is where most
 * of the mistakes actually live.
 */
export function stageCheck(input: CheckInput, keypair: { signingKey: bigint; verifyingKey: JubjubPoint }): StagedCheck {
  const asOf = input.asOf ?? BigInt(Math.floor(Date.now() / 1000));
  const signed: Position = {
    collateral: input.collateral,
    debt: input.debt,
    liquidationThresholdBps: input.liquidationThresholdBps,
    asOf,
  };
  const signature = signPosition(signed, keypair.signingKey);

  // When tampering, the signature stays valid for the ORIGINAL numbers while the
  // witness carries different ones — exactly the attack the in-circuit check
  // exists to stop.
  const submitted: Position = input.tamper ? { ...signed, collateral: signed.collateral * 1000n } : signed;

  return {
    signed,
    submitted,
    signature,
    validLocally: verifyPosition(submitted, keypair.verifyingKey, signature),
    tampered: Boolean(input.tamper),
    minHealthFactorBps: input.minHealthFactorBps,
  };
}

// ─── The client ────────────────────────────────────────────────────────────────

export interface ConnectOptions {
  /** Defaults to the network resolved from flags/state. */
  network?: NetworkId;
  /**
   * Lifecycle hooks. Present so the CLI can keep its spinner and ticker without
   * this module printing anything. All optional; all synchronous.
   */
  hooks?: {
    onDeploymentResolved?(network: NetworkId, deployment: DeploymentRecord): void;
    onAttesterLoaded?(info: AttesterInfo): void;
    onWalletConnecting?(): void;
    onWalletCreated?(ctx: WalletContext): void;
    onSyncStart?(): void;
    onSynced?(balance: bigint): void;
    onContractConnecting?(): void;
    onConnected?(): void;
  };
}

export interface AttesterInfo {
  verifyingKey: JubjubPoint;
  /** True when this process generated a brand-new key. */
  created: boolean;
  /**
   * Whether the local key matches the one baked into the deployment. `null` when
   * the deployment record predates key recording. The contract has no rotation
   * circuit, so `false` here means every check will be rejected in-circuit — a
   * mismatch is worth naming before it looks like a mysterious proof failure.
   */
  matchesDeployment: boolean | null;
}

export interface FreeboardClient {
  readonly network: NetworkId;
  readonly networkConfig: NetworkConfig;
  readonly deployment: DeploymentRecord;
  readonly attester: AttesterInfo;
  readonly walletCtx: WalletContext;
  /** Current unshielded tNight balance, plus the DUST available right now. */
  balances(): Promise<{ tNight: bigint; dust: bigint }>;
  /** `null` when the address holds no contract state. */
  readLedger(): Promise<LedgerView | null>;
  /** Signs a position. Synchronous, off-chain, and prints nothing. */
  stage(input: CheckInput): StagedCheck;
  /** Proves and submits a staged check. Never throws for a normal rejection. */
  submitCheck(staged: StagedCheck): Promise<CheckResult>;
  persist(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Connects everything a check needs: attester key, wallet, providers, contract.
 *
 * Expensive — the wallet sync alone runs for minutes on a cold store — so a
 * caller should hold the returned client for its whole session rather than
 * connecting per operation. A web server should keep one per process.
 */
export async function connectFreeboard(opts: ConnectOptions = {}): Promise<FreeboardClient> {
  const mod = await loadContractModule();

  // resolveNetwork also applies the MIDNIGHT_*_URL env overrides, so an explicit
  // network is routed back through it as a flag rather than indexing the config
  // table directly — otherwise a caller passing `network` would silently lose
  // every endpoint override.
  const resolved = opts.network
    ? resolveNetwork({ argv: ['node', 'freeboard', '--network', opts.network] })
    : resolveNetwork();
  const { network, config } = resolved;

  const deployment = getDeployment(network);
  if (!deployment) throw new NoDeploymentError(network);

  const hooks = opts.hooks ?? {};
  hooks.onDeploymentResolved?.(network, deployment);
  const keypair = loadOrCreateAttesterKey();

  const recorded = deployment.attesterVerifyingKey;
  const matchesDeployment = recorded
    ? recorded.x === `0x${keypair.verifyingKey.x.toString(16)}` &&
      recorded.y === `0x${keypair.verifyingKey.y.toString(16)}`
    : null;

  const attester: AttesterInfo = {
    verifyingKey: keypair.verifyingKey,
    created: keypair.created,
    matchesDeployment,
  };
  hooks.onAttesterLoaded?.(attester);

  hooks.onWalletConnecting?.();
  const walletCtx = await createWallet({ network, networkConfig: config, seed: getOrCreateWallet(network).seed });
  hooks.onWalletCreated?.(walletCtx);

  hooks.onSyncStart?.();
  const state = await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);
  hooks.onSynced?.(state.unshielded.balances[unshieldedToken().raw] ?? 0n);

  hooks.onContractConnecting?.();
  const providers = createFreeboardProviders(config, walletCtx);
  const deployed: any = await findDeployedContract(providers, {
    compiledContract: buildCompiledContract(mod) as any,
    contractAddress: deployment.address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
  });
  hooks.onConnected?.();

  return {
    network,
    networkConfig: config,
    deployment,
    attester,
    walletCtx,

    async balances() {
      const s = await walletCtx.wallet.waitForSyncedState();
      return {
        tNight: s.unshielded.balances[unshieldedToken().raw] ?? 0n,
        // DUST decays, so it is only meaningful as of an instant — hence the date.
        dust: s.dust.balance(new Date()),
      };
    },

    async readLedger() {
      const contractState = await providers.publicDataProvider.queryContractState(deployment.address);
      if (!contractState) return null;
      const l = mod.ledger(contractState.data);
      const verdictRaw = Number(l.lastVerdict);
      return {
        verdict: verdictRaw === 1 ? 'safe' : 'at_risk',
        verdictRaw,
        lastAttestationAt: l.lastAttestationAt === 0n ? null : l.lastAttestationAt,
        checkCount: l.checkCount,
        attesterPk: { x: l.attesterPk.x, y: l.attesterPk.y },
      };
    },

    stage(input) {
      return stageCheck(input, keypair);
    },

    async submitCheck(staged) {
      // Fill the slot as late as possible and clear it unconditionally, so a
      // stale position can never serve a later call.
      pendingAttestation = { position: staged.submitted, signature: staged.signature };
      try {
        const tx = await deployed.callTx.checkSolvency(staged.minHealthFactorBps);
        const raw = tx.private?.result;
        const verdictRaw = raw === undefined || raw === null ? null : Number(raw);
        return {
          outcome: 'accepted',
          verdict: verdictRaw === null ? null : verdictRaw === 1 ? 'safe' : 'at_risk',
          verdictRaw,
          txId: tx.public.txId,
          blockHeight: tx.public.blockHeight,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes(IN_CIRCUIT_REJECTION)) {
          return { outcome: 'rejected-in-circuit', message };
        }
        return { outcome: 'failed', message };
      } finally {
        pendingAttestation = null;
      }
    },

    async persist() {
      await persistWalletState(network, walletCtx);
    },

    async close() {
      await persistWalletState(network, walletCtx);
      await walletCtx.wallet.stop();
    },
  };
}

// ─── Display-agnostic derivations ──────────────────────────────────────────────

/**
 * The health factor, for DISPLAY ONLY.
 *
 * The circuit deliberately never discloses this — that is the entire point. It is
 * available here because the position owner already knows their own numbers. It
 * must never be sent to a verifier surface.
 */
export function localHealthFactor(p: Position): string {
  if (p.debt === 0n) return '∞ (no debt)';
  // ×10000 to keep integer math, then render as a ratio to 4 dp.
  const hfBps = (p.collateral * p.liquidationThresholdBps) / p.debt;
  return (Number(hfBps) / 10000).toFixed(4);
}

