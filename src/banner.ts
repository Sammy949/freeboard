// The Freeboard wordmark.
//
// "FREEBOARD" drawn in the ANSI Shadow figlet style. Nothing generates this at
// runtime — it is a hardcoded constant, the same as Anchor's, and there is no
// figlet dependency to install or shell out to.
//
// TWO THINGS TO RESPECT WHEN EDITING.
//
// 1. The letterforms are hand-maintained and column-aligned. Every row is exactly
//    73 columns and each glyph occupies a fixed span: 8 columns for F, R, E, B, A,
//    D and 9 for O, whose counter needs the extra column. `npm run test:cache`
//    holds the per-glyph table and asserts this constant equals what those glyphs
//    compose to, which is the only check that works: the first draft of row 4 had
//    B's third row where R's fourth belonged, and since both forms are 8 columns
//    wide a width assertion passed it. Only comparing letterforms caught it.
// 2. It is an ARRAY OF LINES, not one string with newlines in it, because the CLI
//    colours it. A `\n` inside a `chalk.cyan(...)` call emits a coloured blank
//    line — a real bug in this repo, found by piping with FORCE_COLOR=3 through
//    `cat -A`. Colouring line by line makes that unreachable instead of merely
//    avoided.
export const WORDMARK: readonly string[] = [
  '███████╗██████╗ ███████╗███████╗██████╗  ██████╗  █████╗ ██████╗ ██████╗ ',
  '██╔════╝██╔══██╗██╔════╝██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗',
  '█████╗  ██████╔╝█████╗  █████╗  ██████╔╝██║   ██║███████║██████╔╝██║  ██║',
  '██╔══╝  ██╔══██╗██╔══╝  ██╔══╝  ██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║',
  '██║     ██║  ██║███████╗███████╗██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝',
  '╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ',
] as const;

/** Column width of the mark. Every rule the CLI draws is sized to this. */
export const WORDMARK_WIDTH = 73;

/**
 * The two lines under the mark.
 *
 * The second one names the three fields the ledger does NOT carry, which is the
 * whole claim and exactly what `npm run test:e2e` asserts. Kept literal rather
 * than vague so the banner cannot drift into promising more than the circuit does.
 */
export const TAGLINE: readonly string[] = [
  '  private solvency proofs on Midnight',
  '  am i safe?  ::  answered without naming collateral, debt or threshold',
] as const;
