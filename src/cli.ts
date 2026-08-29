/**
 * CLI for the freeboard contract: prove a position is solvent without revealing it.
 *
 * The flow per check is: build a position → have the attester sign it → hand both
 * to the circuit as witnesses → the circuit verifies the signature in-circuit,
 * computes the health factor privately, and writes ONLY a verdict to the ledger.
 *
 * Runs interactively (a menu) or NON-INTERACTIVELY via flags. The non-interactive
 * path is not a convenience: an interactive-only CLI cannot be tested or scripted,
 * and piping answers into the menu does not work — stdin reaches EOF during the
 * multi-minute wallet sync, long before the first prompt is drawn.
 *
 *   npm run cli -- --read
 *   npm run cli -- --check --collateral 1000000 --debt 400000 --threshold 8500 --min-hf 15000
 *   npm run cli -- --check --tamper          # demonstrate in-circuit rejection
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment, isLocalDevnet } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import {
  loadOrCreateAttesterKey,
  signPosition,
  verifyPosition,
  formatVerifyingKey,
  type Position,
} from './attester';
import { freeboardWitnesses, type AttestedPosition } from './witnesses';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Must match the privateStateId used at deploy time, or this reconnects to a
// different private-state store than the one the deployment registered.
const PRIVATE_STATE_ID = 'freeboardPrivateState';

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'freeboard');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

const Freeboard = await import(pathToFileURL(contractPath).href);

// ─── The per-call witness slot ─────────────────────────────────────────────────
//
// Freeboard's witnesses are per-call, not durable state: each checkSolvency is
// about one specific attested position. So the contract instance is built once
// with a supplier that reads this slot, and each call fills the slot immediately
// before invoking the circuit. Cleared afterwards so a stale position can never
// silently serve a later call.
let pendingAttestation: AttestedPosition | null = null;

const witnesses = freeboardWitnesses(() => {
  if (!pendingAttestation) {
    throw new Error('No attested position staged — this is a bug in cli.ts, not bad input.');
  }
  return pendingAttestation;
});

// Called through `any` because the contract is imported dynamically: the
// combinators' parameters are conditional types over the contract's own type,
// which collapse to `never` once that type is `any`. Same reasoning as deploy.ts.
const CC = CompiledContract as any;
const compiledContract = CC.withCompiledFileAssets(
  CC.withWitnesses(CC.make('freeboard', Freeboard.Contract), witnesses),
  zkConfigPath,
);

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
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

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
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

// ─── Display helpers ──────────────────────────────────────────────────────────

function verdictLine(v: number | bigint): string {
  const n = Number(v);
  return n === 1 ? '✅ SAFE' : '⚠️  AT_RISK';
}

/**
 * The health factor, computed locally for DISPLAY ONLY.
 *
 * The circuit deliberately never discloses this — that is the entire point. It is
 * shown here because the CLI operator is the position owner and already knows
 * their own numbers. A verifier reading the chain sees only the verdict.
 */
function localHealthFactor(p: Position): string {
  if (p.debt === 0n) return '∞ (no debt)';
  // ×10000 to keep integer math, then render as a ratio to 4 dp.
  const hfBps = (p.collateral * p.liquidationThresholdBps) / p.debt;
  return `${(Number(hfBps) / 10000).toFixed(4)}`;
}

/** Reads a non-negative integer, re-prompting rather than accepting NaN. */
async function askBigInt(
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback: bigint,
): Promise<bigint> {
  for (;;) {
    const raw = (await rl.question(`  ${label} [${fallback}]: `)).trim();
    if (raw === '') return fallback;
    if (/^\d+$/.test(raw)) return BigInt(raw);
    console.log('  ↳ whole non-negative numbers only.');
  }
}

// ─── Argument parsing (non-interactive mode) ───────────────────────────────────

interface CliArgs {
  check: boolean;
  read: boolean;
  tamper: boolean;
  collateral?: bigint;
  debt?: bigint;
  threshold?: bigint;
  minHf?: bigint;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { check: false, read: false, tamper: false };
  const num = (i: number, flag: string): bigint => {
    const v = argv[i + 1];
    if (v === undefined || !/^\d+$/.test(v)) {
      throw new Error(`${flag} requires a whole non-negative number`);
    }
    return BigInt(v);
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--check': out.check = true; break;
      case '--read': out.read = true; break;
      case '--tamper': out.tamper = true; break;
      case '--collateral': out.collateral = num(i, '--collateral'); i++; break;
      case '--debt': out.debt = num(i, '--debt'); i++; break;
      case '--threshold': out.threshold = num(i, '--threshold'); i++; break;
      case '--min-hf': out.minHf = num(i, '--min-hf'); i++; break;
      // --network is consumed by resolveNetwork; skip it and its value.
      case '--network': i++; break;
      default: break;
    }
  }
  // Supplying position values without --check is a mistake worth naming rather
  // than silently dropping into the interactive menu.
  if (!out.check && (out.collateral || out.debt || out.threshold || out.minHf || out.tamper)) {
    throw new Error('position/tamper flags require --check');
  }
  return out;
}

// ─── Reading the public verdict ────────────────────────────────────────────────

async function readLedger(providers: any, address: string): Promise<void> {
  const contractState = await providers.publicDataProvider.queryContractState(address);
  if (!contractState) {
    console.log('\n  No contract state found at that address.\n');
    return;
  }
  const l = Freeboard.ledger(contractState.data);
  console.log('\n  ─── Public ledger state (all a verifier can see) ───');
  console.log(`  Verdict:          ${verdictLine(l.lastVerdict)}`);
  console.log(`  Attestation asOf: ${l.lastAttestationAt === 0n ? '(none yet)' : l.lastAttestationAt}`);
  console.log(`  Checks performed: ${l.checkCount}`);
  console.log(`  Attester key:     x=0x${l.attesterPk.x.toString(16).slice(0, 16)}…`);
  console.log('  ↳ note what is NOT here: no collateral, no debt, no threshold.\n');
}

// ─── Running a solvency check ─────────────────────────────────────────────────

interface CheckOptions {
  /** Corrupt the position AFTER signing, to demonstrate the in-circuit assert. */
  tamper?: boolean;
  /** Pre-supplied values. When all four are present, nothing is prompted. */
  preset?: { collateral?: bigint; debt?: bigint; threshold?: bigint; minHf?: bigint };
}

async function runCheck(
  rl: ReturnType<typeof createInterface> | null,
  deployed: any,
  attester: { signingKey: bigint; verifyingKey: any },
  opts: CheckOptions = {},
): Promise<void> {
  const p = opts.preset ?? {};
  // Defaults chosen so the out-of-the-box run is SAFE: HF = 1M×8500/400k = 2.125
  // against a 1.5 threshold.
  const DEFAULTS = { collateral: 1_000_000n, debt: 400_000n, threshold: 8500n, minHf: 15000n };

  let collateral: bigint, debt: bigint, liquidationThresholdBps: bigint, minHealthFactorBps: bigint;
  if (rl) {
    console.log('\n  Enter the position (blank = default). These stay PRIVATE.\n');
    collateral = await askBigInt(rl, 'Collateral', p.collateral ?? DEFAULTS.collateral);
    debt = await askBigInt(rl, 'Debt', p.debt ?? DEFAULTS.debt);
    liquidationThresholdBps = await askBigInt(rl, 'Liquidation threshold (bps)', p.threshold ?? DEFAULTS.threshold);
    minHealthFactorBps = await askBigInt(rl, 'Verifier min health factor (bps, PUBLIC)', p.minHf ?? DEFAULTS.minHf);
  } else {
    collateral = p.collateral ?? DEFAULTS.collateral;
    debt = p.debt ?? DEFAULTS.debt;
    liquidationThresholdBps = p.threshold ?? DEFAULTS.threshold;
    minHealthFactorBps = p.minHf ?? DEFAULTS.minHf;
    console.log(`\n  Position (PRIVATE): collateral=${collateral} debt=${debt} threshold=${liquidationThresholdBps}bps`);
    console.log(`  Verifier threshold (PUBLIC): ${minHealthFactorBps}bps`);
  }

  // asOf is unix seconds — the convention is fixed by the attester (src/attester.ts).
  const asOf = BigInt(Math.floor(Date.now() / 1000));
  const position: Position = { collateral, debt, liquidationThresholdBps, asOf };

  console.log('\n  Attester signs the position...');
  const signature = signPosition(position, attester.signingKey);

  // What the circuit will actually receive. When tampering, the signature stays
  // valid for the ORIGINAL numbers while the witness carries different ones —
  // exactly the attack the in-circuit check exists to stop.
  const submitted: Position = opts.tamper
    ? { ...position, collateral: position.collateral * 1000n }
    : position;

  if (opts.tamper) {
    console.log('  ⚠ TAMPERING: inflating collateral ×1000 after signing.');
    console.log(`     signed collateral   = ${position.collateral}`);
    console.log(`     submitted collateral = ${submitted.collateral}`);
  }

  // Check locally first. The in-circuit assert is the real gate, but reaching it
  // costs a proof and a transaction; failing here is instant and legible.
  const validLocally = verifyPosition(submitted, attester.verifyingKey, signature);
  console.log(`  Local signature check: ${validLocally ? 'valid' : 'INVALID'}`);

  if (!validLocally) {
    console.log('\n  Submitting anyway, to show the contract reject it in-circuit...');
  } else {
    console.log(`\n  Health factor (local, display only): ${localHealthFactor(submitted)}`);
    console.log(`  Threshold: ${(Number(minHealthFactorBps) / 10000).toFixed(4)}`);
  }

  console.log('\n  Proving and submitting (30-60s)...');
  pendingAttestation = { position: submitted, signature };
  try {
    const tx = await deployed.callTx.checkSolvency(minHealthFactorBps);
    const verdict = tx.private?.result;
    console.log(`\n  ✅ Accepted. Verdict: ${verdict !== undefined ? verdictLine(verdict) : '(see ledger)'}`);
    console.log(`  Tx: ${tx.public.txId}`);
    console.log(`  Block: ${tx.public.blockHeight}\n`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // The contract's own assert message, surfaced from the failed proof.
    if (msg.includes('not signed by the registered attester')) {
      console.log('\n  🛑 REJECTED IN-CIRCUIT: position is not signed by the registered attester.');
      console.log('     No verdict was written. This is the anti-theater check working.\n');
    } else {
      console.error(`\n  ❌ Failed: ${msg}\n`);
    }
  } finally {
    pendingAttestation = null;
  }
}

// ─── Main CLI ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  // Non-interactive when a mode flag is present. readline is not merely unused
  // there — creating it would hold stdin open and the process would never exit.
  const interactive = !args.check && !args.read;

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  freeboard — private solvency proofs                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}. Run \`npm run setup -- --network ${network}\` first.`);
    process.exit(1);
  }
  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network:  ${network}\n`);

  try {
    const attester = loadOrCreateAttesterKey();
    console.log(`  Attester: ${formatVerifyingKey(attester.verifyingKey).slice(0, 46)}…`);

    // The contract has no key-rotation circuit, so attestations only verify
    // against the key it was deployed with. Comparing here turns an otherwise
    // baffling in-circuit rejection into a clear, actionable message.
    const recorded = deployment.attesterVerifyingKey;
    if (recorded) {
      const matches =
        recorded.x === `0x${attester.verifyingKey.x.toString(16)}` &&
        recorded.y === `0x${attester.verifyingKey.y.toString(16)}`;
      if (!matches) {
        console.log('\n  ⚠ The local attester key does NOT match the deployed contract.');
        console.log('    Every check will be rejected in-circuit. The contract has no rotation');
        console.log('    circuit, so either restore the original .midnight-attester.json or');
        console.log(`    redeploy: npm run deploy -- --network ${network}\n`);
      }
    }
    if (attester.created) {
      console.log('  ⚠ A NEW attester key was just generated — see the warning above.');
    }
    console.log();

    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
    }

    console.log('  Syncing with network...');
    console.log('     RPC disconnection messages during sync are normal.\n');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    await persistWalletState(network, walletCtx);
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    if (balance === 0n && !isLocalDevnet(network) && networkConfig.faucet) {
      const address = walletCtx.unshieldedKeystore.getBech32Address();
      console.log('  ⚠ Wallet has no tNight. Fund it from the faucet to send transactions:');
      console.log(`     ${networkConfig.faucet}`);
      console.log(`     Wallet address: ${address}\n`);
    }

    console.log('  Connecting to contract...');
    const providers = await createProviders(walletCtx);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });

    console.log('  ✅ Connected!\n');

    if (!interactive) {
      // One-shot mode. --read before --check would show the pre-call state, which
      // is the less useful order, so a combined invocation reads AFTER checking.
      if (args.check) {
        await runCheck(null, deployed, attester, {
          tamper: args.tamper,
          preset: { collateral: args.collateral, debt: args.debt, threshold: args.threshold, minHf: args.minHf },
        });
      }
      if (args.read) await readLedger(providers, deployment.address);
    } else {
      let running = true;
      while (running) {
        console.log('─── Menu ───────────────────────────────────────────────────────');
        console.log('  1. Run a solvency check (attested)');
        console.log('  2. Read the public verdict from the chain');
        console.log('  3. Run a TAMPERED check (demonstrate in-circuit rejection)');
        console.log('  4. Check wallet balance');
        console.log('  5. Exit\n');

        const choice = (await rl!.question('  Your choice: ')).trim();

        switch (choice) {
          case '1':
            await runCheck(rl, deployed, attester);
            break;

          case '2':
            await readLedger(providers, deployment.address);
            break;

          case '3':
            await runCheck(rl, deployed, attester, { tamper: true });
            break;

          case '4': {
            const currentState = await walletCtx.wallet.waitForSyncedState();
            const currentBalance = currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
            console.log(`\n  tNight: ${currentBalance.toLocaleString()}`);
            console.log(`  DUST:   ${currentState.dust.balance(new Date()).toLocaleString()}\n`);
            break;
          }

          case '5':
            running = false;
            console.log('\n  Done.\n');
            break;

          default:
            console.log('\n  Invalid choice. Enter 1-5.\n');
        }
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    rl?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
