/**
 * CLI for the freeboard contract: prove a position is solvent without revealing it.
 *
 * The flow per check is: build a position → have the attester sign it → hand both
 * to the circuit as witnesses → the circuit verifies the signature in-circuit,
 * computes the health factor privately, and writes ONLY a verdict to the ledger.
 *
 * That flow itself now lives in src/freeboard-client.ts, because the web
 * dashboard runs the same one and two copies of it would drift. THIS FILE IS
 * PRESENTATION: prompts, colour, spinners, boxes. It decides how a result reads,
 * never what a result is.
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
import { WebSocket } from 'ws';

// Presentation only. These wrap what the CLI prints; none of them touch the
// proving or submission path. chalk auto-detects a non-TTY and emits plain text,
// so piping to a file or a CI log stays readable.
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';

import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, isLocalDevnet } from './network';
import { formatVerifyingKey } from './attester';
import {
  connectFreeboard,
  localHealthFactor,
  ContractNotCompiledError,
  NoDeploymentError,
  type FreeboardClient,
  type LedgerView,
  type StagedCheck,
} from './freeboard-client';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network } = resolveNetwork();
{
  // Printed before anything else: a freshly generated mnemonic is the one thing
  // here that cannot be recovered later.
  const notice = formatWalletBackupNotice(getOrCreateWallet(network), network);
  if (notice) console.log(notice);
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function verdictLine(v: 'safe' | 'at_risk' | null): string {
  if (v === null) return chalk.dim('(see ledger)');
  return v === 'safe' ? chalk.green.bold('✅ SAFE') : chalk.red.bold('⚠️  AT_RISK');
}

/** A key: value line — label bold, so the eye finds the values. */
function field(label: string, value: string): string {
  return `${chalk.bold(label.padEnd(18))}${value}`;
}

/** Informational chatter: present, but never competing with the answer. */
const info = (s: string) => chalk.dim(s);

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

function printLedger(l: LedgerView | null): void {
  if (!l) {
    console.log(chalk.yellow('\n  No contract state found at that address.\n'));
    return;
  }
  // The verdict block is the answer a verifier came for, so it gets a border and
  // nothing else on the page does. The "what is NOT here" line stays inside the
  // box: the absence is part of the result, not a footnote to it.
  const body = [
    field('Verdict:', verdictLine(l.verdict)),
    field('Attestation asOf:', l.lastAttestationAt === null ? chalk.dim('(none yet)') : String(l.lastAttestationAt)),
    field('Checks performed:', String(l.checkCount)),
    field('Attester key:', chalk.dim(`x=0x${l.attesterPk.x.toString(16).slice(0, 16)}…`)),
    '',
    chalk.dim('↳ note what is NOT here: no collateral, no debt, no threshold.'),
  ].join('\n');

  console.log(
    boxen(body, {
      title: 'Public ledger state — all a verifier can see',
      titleAlignment: 'left',
      padding: { top: 1, bottom: 1, left: 2, right: 2 },
      margin: { top: 1, bottom: 1, left: 2, right: 0 },
      borderStyle: 'round',
      borderColor: l.verdict === 'safe' ? 'green' : 'red',
    }),
  );
}

// ─── Running a solvency check ─────────────────────────────────────────────────

interface CheckOptions {
  /** Corrupt the position AFTER signing, to demonstrate the in-circuit assert. */
  tamper?: boolean;
  /** Pre-supplied values. When all four are present, nothing is prompted. */
  preset?: { collateral?: bigint; debt?: bigint; threshold?: bigint; minHf?: bigint };
}

/** Narrates a staged check: what is private, what is public, what was tampered. */
function printStaged(staged: StagedCheck): void {
  if (staged.tampered) {
    console.log(chalk.yellow('  ⚠ TAMPERING: inflating collateral ×1000 after signing.'));
    console.log(info(`     signed collateral    = ${staged.signed.collateral}`));
    console.log(info(`     submitted collateral = ${staged.submitted.collateral}`));
  }

  console.log(
    `  ${chalk.bold('Local signature check:')} ${staged.validLocally ? chalk.green('valid') : chalk.red.bold('INVALID')}`,
  );

  if (!staged.validLocally) {
    console.log(chalk.yellow('\n  Submitting anyway, to show the contract reject it in-circuit...'));
  } else {
    console.log(`\n  ${chalk.bold('Health factor')} ${info('(local, display only)')}: ${localHealthFactor(staged.submitted)}`);
    console.log(`  ${chalk.bold('Threshold:')} ${(Number(staged.minHealthFactorBps) / 10000).toFixed(4)}`);
  }
}

async function runCheck(
  rl: ReturnType<typeof createInterface> | null,
  client: FreeboardClient,
  opts: CheckOptions = {},
): Promise<void> {
  const p = opts.preset ?? {};
  // Defaults chosen so the out-of-the-box run is SAFE: HF = 1M×8500/400k = 2.125
  // against a 1.5 threshold.
  const DEFAULTS = { collateral: 1_000_000n, debt: 400_000n, threshold: 8500n, minHf: 15000n };

  let collateral: bigint, debt: bigint, liquidationThresholdBps: bigint, minHealthFactorBps: bigint;
  if (rl) {
    console.log(`\n  Enter the position (blank = default). These stay ${chalk.bold('PRIVATE')}.\n`);
    collateral = await askBigInt(rl, 'Collateral', p.collateral ?? DEFAULTS.collateral);
    debt = await askBigInt(rl, 'Debt', p.debt ?? DEFAULTS.debt);
    liquidationThresholdBps = await askBigInt(rl, 'Liquidation threshold (bps)', p.threshold ?? DEFAULTS.threshold);
    minHealthFactorBps = await askBigInt(rl, 'Verifier min health factor (bps, PUBLIC)', p.minHf ?? DEFAULTS.minHf);
  } else {
    collateral = p.collateral ?? DEFAULTS.collateral;
    debt = p.debt ?? DEFAULTS.debt;
    liquidationThresholdBps = p.threshold ?? DEFAULTS.threshold;
    minHealthFactorBps = p.minHf ?? DEFAULTS.minHf;
    console.log(
      `\n  ${chalk.bold('Position (PRIVATE):')} ${info(`collateral=${collateral} debt=${debt} threshold=${liquidationThresholdBps}bps`)}`,
    );
    console.log(`  ${chalk.bold('Verifier threshold (PUBLIC):')} ${minHealthFactorBps}bps`);
  }

  console.log(info('\n  Attester signs the position...'));
  const staged = client.stage({
    collateral,
    debt,
    liquidationThresholdBps,
    minHealthFactorBps,
    tamper: opts.tamper,
  });
  printStaged(staged);

  // A spinner replaces the static "30-60s" line: the wait is long enough that a
  // frozen terminal reads as a hang.
  const spinner = ora({ text: 'Proving and submitting (30-60s)...', prefixText: ' ' }).start();
  const result = await client.submitCheck(staged);

  switch (result.outcome) {
    case 'accepted':
      spinner.succeed(`Accepted. Verdict: ${verdictLine(result.verdict)}`);
      console.log(info(`  Tx:    ${result.txId}`));
      console.log(info(`  Block: ${result.blockHeight}\n`));
      break;

    case 'rejected-in-circuit':
      // A rejection here is the demo succeeding, so it is styled as a definite
      // outcome rather than an error: 🛑, not ❌. ora's prefixText already
      // supplies the indent, so the symbol must not add its own.
      spinner.stopAndPersist({
        symbol: '🛑',
        text: chalk.red.bold('REJECTED IN-CIRCUIT: position is not signed by the registered attester.'),
      });
      console.log(info('     No verdict was written. This is the anti-theater check working.\n'));
      break;

    case 'failed':
      spinner.fail(chalk.red(`Failed: ${result.message}\n`));
      break;
  }
}

// ─── Main CLI ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  // Non-interactive when a mode flag is present. readline is not merely unused
  // there — creating it would hold stdin open and the process would never exit.
  const interactive = !args.check && !args.read;

  // The banner stays hand-drawn rather than boxen'd: boxen is reserved for the
  // verdict, so a border on the page means "this is the answer". The newlines sit
  // OUTSIDE the chalk call — inside, chalk wraps the newline itself and emits a
  // stray coloured blank line.
  console.log();
  console.log(chalk.cyan('╔══════════════════════════════════════════════════════════════╗'));
  console.log(
    chalk.cyan('║  ') + chalk.bold('freeboard') + chalk.dim(' — private solvency proofs') +
      chalk.cyan('                         ║'),
  );
  console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════╝'));
  console.log();

  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

  // The sync ticker is hand-rolled rather than ora. Wallet sync races the SDK's
  // own RPC logging on stdout, and ora redraws its line every frame — the two
  // interleave into a smeared mess, where a plain \r ticker degrades gracefully.
  // The proving spinner has no such competition, which is why ora fits there.
  let syncInterval: NodeJS.Timeout | null = null;
  // Captured from the sync hook rather than re-read afterwards: the balance is
  // already in hand there, and asking the wallet again is a needless round trip.
  let syncedBalance = 0n;

  try {
    const client = await connectFreeboard({
      hooks: {
        onDeploymentResolved(network, deployment) {
          console.log(`  ${chalk.bold('Contract:')} ${info(deployment.address)}`);
          console.log(`  ${chalk.bold('Network: ')} ${network}\n`);
        },

        onAttesterLoaded(attester) {
          console.log(`  ${chalk.bold('Attester:')} ${info(`${formatVerifyingKey(attester.verifyingKey).slice(0, 46)}…`)}`);

          // The contract has no key-rotation circuit, so attestations only verify
          // against the key it was deployed with. Naming a mismatch here turns an
          // otherwise baffling in-circuit rejection into an actionable message.
          if (attester.matchesDeployment === false) {
            console.log(chalk.yellow.bold('\n  ⚠ The local attester key does NOT match the deployed contract.'));
            console.log(chalk.yellow('    Every check will be rejected in-circuit. The contract has no rotation'));
            console.log(chalk.yellow('    circuit, so either restore the original .midnight-attester.json or'));
            console.log(chalk.yellow(`    redeploy: npm run deploy -- --network ${network}\n`));
          }
          if (attester.created) {
            console.log(chalk.yellow('  ⚠ A NEW attester key was just generated — see the warning above.'));
          }
          console.log();
        },

        onWalletConnecting() {
          console.log(info('  Connecting to wallet...'));
        },

        onWalletCreated(ctx) {
          const restoredCount = Object.values(ctx.restored).filter(Boolean).length;
          if (restoredCount > 0) {
            console.log(info(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`));
          }
        },

        onSyncStart() {
          console.log(info('  Syncing with network...'));
          console.log(info('     RPC disconnection messages during sync are normal.\n'));
          const syncStart = Date.now();
          syncInterval = setInterval(() => {
            const elapsed = Math.round((Date.now() - syncStart) / 1000);
            process.stdout.write(chalk.dim(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `));
          }, 5000);
        },

        onSynced(balance) {
          if (syncInterval) clearInterval(syncInterval);
          syncInterval = null;
          syncedBalance = balance;
          process.stdout.write(`\r  ${chalk.green('✓')} Synced with network.                                      \n`);
          console.log(`  ${chalk.bold('Balance:')} ${balance.toLocaleString()} tNight\n`);
        },

        onContractConnecting() {
          console.log(info('  Connecting to contract...'));
        },

        onConnected() {
          console.log(`  ${chalk.green('✅ Connected!')}\n`);
        },
      },
    });

    // The faucet notice belongs after the connect banner, but the balance it
    // depends on was already read during sync — no second query.
    if (syncedBalance === 0n && !isLocalDevnet(client.network) && client.networkConfig.faucet) {
      const address = client.walletCtx.unshieldedKeystore.getBech32Address();
      console.log(chalk.yellow('  ⚠ Wallet has no tNight. Fund it from the faucet to send transactions:'));
      console.log(chalk.yellow(`     ${client.networkConfig.faucet}`));
      console.log(info(`     Wallet address: ${address}\n`));
    }

    if (!interactive) {
      // One-shot mode. --read before --check would show the pre-call state, which
      // is the less useful order, so a combined invocation reads AFTER checking.
      if (args.check) {
        await runCheck(null, client, {
          tamper: args.tamper,
          preset: { collateral: args.collateral, debt: args.debt, threshold: args.threshold, minHf: args.minHf },
        });
      }
      if (args.read) printLedger(await client.readLedger());
    } else {
      let running = true;
      while (running) {
        console.log(chalk.dim('─── Menu ───────────────────────────────────────────────────────'));
        console.log(`  ${chalk.bold('1.')} Run a solvency check ${info('(attested)')}`);
        console.log(`  ${chalk.bold('2.')} Read the public verdict from the chain`);
        console.log(`  ${chalk.bold('3.')} Run a ${chalk.yellow('TAMPERED')} check ${info('(demonstrate in-circuit rejection)')}`);
        console.log(`  ${chalk.bold('4.')} Check wallet balance`);
        console.log(`  ${chalk.bold('5.')} Exit\n`);

        const choice = (await rl!.question(chalk.bold('  Your choice: '))).trim();

        switch (choice) {
          case '1':
            await runCheck(rl, client);
            break;

          case '2':
            printLedger(await client.readLedger());
            break;

          case '3':
            await runCheck(rl, client, { tamper: true });
            break;

          case '4': {
            const { tNight, dust } = await client.balances();
            console.log(`\n  ${chalk.bold('tNight:')} ${tNight.toLocaleString()}`);
            console.log(`  ${chalk.bold('DUST:  ')} ${dust.toLocaleString()}\n`);
            break;
          }

          case '5':
            running = false;
            console.log(info('\n  Done.\n'));
            break;

          default:
            console.log(chalk.yellow('\n  Invalid choice. Enter 1-5.\n'));
        }
      }
    }

    await client.close();
  } catch (error) {
    // Two failures are worth their own wording, because both are fixed by running
    // one specific command rather than by debugging anything.
    if (error instanceof ContractNotCompiledError) {
      console.error(chalk.red.bold('\n❌ Contract not compiled!'), chalk.red('Run: npm run compile\n'));
      process.exitCode = 1;
      return;
    }
    if (error instanceof NoDeploymentError) {
      console.error(chalk.red(`\n${error.message}\n`));
      process.exitCode = 1;
      return;
    }
    console.error(chalk.red.bold('\n❌ Error:'), chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  } finally {
    if (syncInterval) clearInterval(syncInterval);
    rl?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
