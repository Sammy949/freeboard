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
import { WebSocket } from 'ws';

// Presentation only. Neither of these touches the proving or submission path.
// @clack/prompts owns the interaction and the structure (prompts, the verdict box,
// the spinner, the status symbols); chalk owns colour, which clack does not do.
// chalk auto-detects a non-TTY and emits plain text, so piping stays readable.
import chalk from 'chalk';
import {
  isCancel,
  isTTY,
  select,
  spinner,
  S_INFO,
  S_STEP_SUBMIT,
  S_SUCCESS,
  S_WARN,
  text,
  updateSettings,
} from '@clack/prompts';

import { frameLines, TAGLINE, WORDMARK, WORDMARK_WIDTH } from './banner';
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

// clack draws a `│` guide down the left of everything between its calls, and that
// gutter is the most recognisable thing about any clack-built CLI — every `create-*`
// tool wears it. Off, because this CLI already has its own structure: the wordmark at
// column 0 and every rule sized to it. Borrowing another tool's silhouette is not a
// design decision, it is the absence of one.
updateSettings({ withGuide: false });

/**
 * Whether stdout is a terminal.
 *
 * The spinner is the one thing here that repaints, so it is the one thing that needs
 * to know. Piped into a file or a CI log there is nothing to repaint over, and clack
 * documents nothing about its non-TTY behaviour, so this CLI decides rather than
 * hoping.
 */
const TTY = isTTY(process.stdout);

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

/**
 * Status lines: one glyph, one indent, one place.
 *
 * clack's `log.*` was the obvious home for these and does not fit. Measured, not
 * assumed: `withGuide: false` strips log's state SYMBOLS along with the guide bar, and
 * the per-call `symbol` option is ignored once the guide is off, so `log.step('x')`
 * prints a blank line and then `x`. That is less than `console.log`. With the guide ON
 * you get the symbols back and the `│` gutter with them, which fights a wordmark and a
 * box that both start at column 0.
 *
 * So the layout is ours and only the GLYPHS are borrowed, straight from the constants
 * clack draws with, which keeps these lines identical in vocabulary to the prompts and
 * the box that clack does render.
 */
const step = (s: string) => console.log(`  ${chalk.dim(S_STEP_SUBMIT)} ${s}`);
const ok = (s: string) => console.log(`  ${chalk.green(S_SUCCESS)} ${s}`);
const warn = (s: string) => console.log(`  ${chalk.yellow(S_WARN)} ${s}`);
const detail = (s: string) => console.log(`  ${chalk.cyan(S_INFO)} ${s}`);

/**
 * A labelled rule, sized to the wordmark so every horizontal line in the CLI ends
 * in the same column as the mark above it. Derived rather than typed out, because
 * a hand-counted run of dashes drifts the moment the mark or the label changes.
 */
function rule(label: string): string {
  const head = `─── ${label} `;
  return head + '─'.repeat(Math.max(0, WORDMARK_WIDTH - [...head].length));
}

/**
 * Thrown when a prompt is cancelled, so the cancel path unwinds through `main`'s
 * `finally` like any other exit.
 *
 * clack's own guidance is `process.exit(0)` at the cancel site. Do not follow it
 * here: this process holds an EXCLUSIVE LevelDB lock on the private-state store, and
 * exiting under it leaves the lock held so the next run cannot open the store at all.
 * Cancelling has to unwind, not exit.
 */
class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

/**
 * Reads a non-negative integer.
 *
 * The cancel guard lives INSIDE this helper rather than at the call sites, because
 * clack returns a symbol on Ctrl-C and an unchecked symbol would flow straight into
 * `BigInt()`. One helper means a new prompt cannot forget the check.
 */
async function askBigInt(label: string, fallback: bigint): Promise<bigint> {
  const answer = await text({
    message: label,
    placeholder: String(fallback),
    // Empty input resolves to this, so the "blank = default" behaviour survives.
    defaultValue: String(fallback),
    // `v` is optional in clack's Validate signature: an untouched prompt hands the
    // validator undefined, which is the same case as empty and must pass, or the
    // default can never be accepted with a bare Enter.
    validate: (v) => (!v || /^\d+$/.test(v) ? undefined : 'Whole non-negative numbers only.'),
  });
  if (isCancel(answer)) throw new CancelledError();
  return BigInt(answer);
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
      default:
        // Silently ignoring an unknown flag is how `--colateral 5000000` runs with
        // the DEFAULT collateral and reports a verdict for numbers nobody asked for.
        // A demo delivering a confident wrong answer is worse than one that stops.
        if (argv[i].startsWith('-')) throw new Error(`unknown flag: ${argv[i]}`);
        break;
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
    warn('No contract state found at that address.');
    return;
  }
  // The verdict block is the answer a verifier came for, so it gets a border and
  // nothing else on the page does. The "what is NOT here" line stays inside the
  // frame: the absence is part of the result, not a footnote to it.
  console.log();
  for (const line of frameLines(
    'Public ledger state — all a verifier can see',
    [
      field('Verdict:', verdictLine(l.verdict)),
      field('Attestation asOf:', l.lastAttestationAt === null ? chalk.dim('(none yet)') : String(l.lastAttestationAt)),
      field('Checks performed:', String(l.checkCount)),
      field('Attester key:', chalk.dim(`x=0x${l.attesterPk.x.toString(16).slice(0, 16)}…`)),
      '',
      chalk.dim('↳ note what is NOT here: no collateral, no debt, no threshold.'),
    ],
    l.verdict === 'safe' ? chalk.green : chalk.red,
  )) {
    console.log(line);
  }
  console.log();
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
    warn('TAMPERING: inflating collateral ×1000 after signing.');
    console.log(info(`     signed collateral    = ${staged.signed.collateral}`));
    console.log(info(`     submitted collateral = ${staged.submitted.collateral}`));
  }

  detail(
    `${chalk.bold('Local signature check:')} ${staged.validLocally ? chalk.green('valid') : chalk.red.bold('INVALID')}`,
  );

  if (!staged.validLocally) {
    warn('Submitting anyway, to show the contract reject it in-circuit...');
  } else {
    console.log(`  ${chalk.bold('Health factor')} ${info('(local, display only)')}: ${localHealthFactor(staged.submitted)}`);
    console.log(`  ${chalk.bold('Threshold:')} ${(Number(staged.minHealthFactorBps) / 10000).toFixed(4)}`);
  }
  console.log();
}

async function runCheck(
  interactive: boolean,
  client: FreeboardClient,
  opts: CheckOptions = {},
): Promise<void> {
  const p = opts.preset ?? {};
  // Defaults chosen so the out-of-the-box run is SAFE: HF = 1M×8500/400k = 2.125
  // against a 1.5 threshold.
  const DEFAULTS = { collateral: 1_000_000n, debt: 400_000n, threshold: 8500n, minHf: 15000n };

  let collateral: bigint, debt: bigint, liquidationThresholdBps: bigint, minHealthFactorBps: bigint;
  if (interactive) {
    console.log(`\n  Enter the position (blank = default). These stay ${chalk.bold('PRIVATE')}.\n`);
    collateral = await askBigInt('Collateral', p.collateral ?? DEFAULTS.collateral);
    debt = await askBigInt('Debt', p.debt ?? DEFAULTS.debt);
    liquidationThresholdBps = await askBigInt('Liquidation threshold (bps)', p.threshold ?? DEFAULTS.threshold);
    minHealthFactorBps = await askBigInt('Verifier min health factor (bps, PUBLIC)', p.minHf ?? DEFAULTS.minHf);
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

  console.log();
  step('Attester signs the position');
  const staged = client.stage({
    collateral,
    debt,
    liquidationThresholdBps,
    minHealthFactorBps,
    tamper: opts.tamper,
  });
  printStaged(staged);

  // The wait is long enough that a frozen terminal reads as a hang, so it gets a
  // spinner with an elapsed-time indicator rather than a static "30-60s" line. Piped,
  // there is nothing to repaint over, so it degrades to one printed line.
  const spin = TTY ? spinner({ indicator: 'timer' }) : null;
  if (spin) spin.start('Proving and submitting');
  else step('Proving and submitting (30-60s)...');

  const result = await client.submitCheck(staged);

  switch (result.outcome) {
    case 'accepted':
      if (spin) spin.stop(`Accepted. Verdict: ${verdictLine(result.verdict)}`);
      else ok(`Accepted. Verdict: ${verdictLine(result.verdict)}`);
      console.log(info(`     Tx:    ${result.txId}`));
      console.log(info(`     Block: ${result.blockHeight}\n`));
      break;

    case 'rejected-in-circuit':
      // A rejection here is the demo succeeding, so it is styled as a definite
      // outcome rather than an error. clack's spinner has no custom-symbol option and
      // its own three terminal states are a green check, a red square and a yellow
      // triangle — all of which would misread this — so the spinner is cleared and the
      // line is printed with the symbol it deserves.
      spin?.clear();
      console.log(`  🛑 ${chalk.red.bold('REJECTED IN-CIRCUIT: position is not signed by the registered attester.')}`);
      console.log(info('     No verdict was written. This is the anti-theater check working.\n'));
      break;

    case 'failed':
      if (spin) spin.error(`Failed: ${result.message}`);
      else console.log(`  ${chalk.red(S_WARN)} ${chalk.red(`Failed: ${result.message}`)}`);
      console.log();
      break;
  }
}

// ─── Main CLI ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  // Non-interactive when a mode flag is present. readline is not merely unused
  // there — creating it would hold stdin open and the process would never exit.
  const interactive = !args.check && !args.read;

  // The wordmark carries no border, and that is the point: boxen is reserved for
  // the verdict, so exactly one thing in this CLI has a frame around it and a
  // frame therefore means "this is the answer". The old banner undercut that by
  // drawing its own box. Coloured line by line because a `\n` inside a chalk call
  // emits a coloured blank line.
  console.log();
  for (const row of WORDMARK) console.log(chalk.cyan(row));
  console.log();
  console.log(chalk.dim(TAGLINE[0]));
  console.log(chalk.dim(TAGLINE[1]));
  console.log();

  // No readline instance any more: clack owns stdin, and it opens and releases it per
  // prompt rather than holding it for the session. That removes the reason the old
  // code had to skip creating one in non-interactive mode — an open readline held
  // stdin and the process would never exit.

  // The sync ticker is hand-rolled rather than a spinner. Wallet sync races the SDK's
  // own RPC logging on stdout, and any repainting spinner — ora's or clack's — redraws
  // its line every frame, so the two interleave into a smear. A plain \r ticker
  // degrades gracefully under foreign writes. The proving spinner has no such
  // competition, which is why clack's fits there.
  let syncInterval: NodeJS.Timeout | null = null;
  // Captured from the sync hook rather than re-read afterwards: the balance is
  // already in hand there, and asking the wallet again is a needless round trip.
  let syncedBalance = 0n;
  // Held so `finally` can release the LevelDB lock on every exit path, including a
  // cancelled prompt. Left inside the try, an interrupt skipped close() and the store
  // stayed locked against the next run.
  let client: FreeboardClient | null = null;

  try {
    client = await connectFreeboard({
      hooks: {
        onDeploymentResolved(network, deployment) {
          console.log(`  ${chalk.bold('Contract:')} ${info(deployment.address)}`);
          console.log(`  ${chalk.bold('Network: ')} ${network}`);
        },

        onAttesterLoaded(attester) {
          console.log(`  ${chalk.bold('Attester:')} ${info(`${formatVerifyingKey(attester.verifyingKey).slice(0, 46)}…`)}\n`);

          // The contract has no key-rotation circuit, so attestations only verify
          // against the key it was deployed with. Naming a mismatch here turns an
          // otherwise baffling in-circuit rejection into an actionable message.
          if (attester.matchesDeployment === false) {
            warn(chalk.yellow.bold('The local attester key does NOT match the deployed contract.'));
            console.log(chalk.yellow('    Every check will be rejected in-circuit. The contract has no rotation'));
            console.log(chalk.yellow('    circuit, so either restore the original .midnight-attester.json or'));
            console.log(chalk.yellow(`    redeploy: npm run deploy -- --network ${network}\n`));
          }
          if (attester.created) {
            warn('A NEW attester key was just generated — see the warning above.');
          }
        },

        onWalletConnecting() {
          step('Connecting to wallet');
        },

        onWalletCreated(ctx) {
          const restoredCount = Object.values(ctx.restored).filter(Boolean).length;
          if (restoredCount > 0) {
            console.log(info(`     Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync resumes from the saved point.`));
          }
        },

        onSyncStart() {
          step('Syncing with network');
          console.log(info('     RPC disconnection messages during sync are normal.\n'));
          // Piped, a \r ticker just appends a line every five seconds, so it only runs
          // on a TTY where it has something to overwrite.
          if (!TTY) return;
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
          // Wipe the ticker's own line before anything else writes, or the two overlap.
          // Only on a TTY: piped, \r is just a byte and the spaces would land in the
          // log as 73 columns of nothing.
          if (TTY) process.stdout.write(`\r${' '.repeat(WORDMARK_WIDTH)}\r`);
          ok('Synced with network.');
          console.log(`  ${chalk.bold('Balance:')} ${balance.toLocaleString()} tNight\n`);
        },

        onContractConnecting() {
          step('Connecting to contract');
        },

        onConnected() {
          ok(chalk.green('Connected'));
          console.log();
        },
      },
    });

    // The faucet notice belongs after the connect banner, but the balance it
    // depends on was already read during sync — no second query.
    if (syncedBalance === 0n && !isLocalDevnet(client.network) && client.networkConfig.faucet) {
      const address = client.walletCtx.unshieldedKeystore.getBech32Address();
      warn(chalk.yellow('Wallet has no tNight. Fund it from the faucet to send transactions:'));
      console.log(chalk.yellow(`     ${client.networkConfig.faucet}`));
      console.log(info(`     Wallet address: ${address}\n`));
    }

    if (!interactive) {
      // One-shot mode. --read before --check would show the pre-call state, which
      // is the less useful order, so a combined invocation reads AFTER checking.
      if (args.check) {
        await runCheck(false, client, {
          tamper: args.tamper,
          preset: { collateral: args.collateral, debt: args.debt, threshold: args.threshold, minHf: args.minHf },
        });
      }
      if (args.read) printLedger(await client.readLedger());
    } else {
      let running = true;
      while (running) {
        // The rule marks each turn of the loop. select() collapses to a single line
        // once answered, so the iterations need that boundary MORE than the old
        // printed menu did, not less.
        console.log(chalk.dim(rule('Menu')));

        // One select replaces the numbered list, the readline question AND the
        // "Invalid choice. Enter 1-5." branch: an out-of-range answer is no longer
        // reachable, and the parenthetical asides are exactly what `hint` is for.
        const choice = await select({
          message: 'What would you like to do?',
          options: [
            { value: 'check', label: 'Run a solvency check', hint: 'attested' },
            { value: 'read', label: 'Read the public verdict from the chain' },
            {
              value: 'tamper',
              label: `Run a ${chalk.yellow('TAMPERED')} check`,
              hint: 'demonstrate in-circuit rejection',
            },
            { value: 'balance', label: 'Check wallet balance' },
            { value: 'exit', label: 'Exit' },
          ],
        });
        if (isCancel(choice)) throw new CancelledError();

        switch (choice) {
          case 'check':
            await runCheck(true, client);
            break;

          case 'read':
            printLedger(await client.readLedger());
            break;

          case 'tamper':
            await runCheck(true, client, { tamper: true });
            break;

          case 'balance': {
            const { tNight, dust } = await client.balances();
            console.log(`\n  ${chalk.bold('tNight:')} ${tNight.toLocaleString()}`);
            console.log(`  ${chalk.bold('DUST:  ')} ${dust.toLocaleString()}\n`);
            break;
          }

          case 'exit':
            running = false;
            console.log(info('\n  Done.\n'));
            break;
        }
      }
    }
  } catch (error) {
    // Cancelling is an exit, not a failure: no error text, no non-zero code. It only
    // travels as an exception so `finally` runs and the store lock is released.
    if (error instanceof CancelledError) {
      warn('Cancelled.');
      console.log();
      return;
    }
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
    // The whole reason `client` is declared outside the try. This releases the
    // EXCLUSIVE LevelDB lock on the private-state store; skipping it — which a
    // cancelled prompt or any throw used to do — leaves the lock held, and the next
    // run cannot open the store at all.
    await client?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
