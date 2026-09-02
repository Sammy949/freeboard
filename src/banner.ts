// The Freeboard wordmark.
//
// "FREEBOARD" drawn in the ANSI Shadow figlet style. Nothing generates this at
// runtime — it is a hardcoded constant, the same as Anchor's, and there is no
// figlet dependency to install or shell out to.
import stringWidth from 'fast-string-width';
import {
  S_BAR,
  S_BAR_H,
  S_CORNER_BOTTOM_LEFT,
  S_CORNER_BOTTOM_RIGHT,
  S_CORNER_TOP_LEFT,
  S_CORNER_TOP_RIGHT,
} from '@clack/prompts';

// Aliased once so the frame below reads as geometry rather than as a list of imports.
const BAR_V = S_BAR;
const BAR_H = S_BAR_H;
const CORNER_TL = S_CORNER_TOP_LEFT;
const CORNER_TR = S_CORNER_TOP_RIGHT;
const CORNER_BL = S_CORNER_BOTTOM_LEFT;
const CORNER_BR = S_CORNER_BOTTOM_RIGHT;

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

/**
 * Display width, ignoring ANSI colour.
 *
 * Counting code points is not enough: `✅` is ONE code point and TWO terminal columns,
 * and measuring it as one pushed the verdict row's right border a column past every
 * other row in the frame. `fast-string-width` is what clack measures with, so this
 * agrees with anything clack renders alongside it.
 */
export const displayWidth = (s: string): number => stringWidth(s.replace(/\x1b\[[0-9;]*m/g, ''));

/**
 * The verdict frame, built here rather than by a library.
 *
 * clack's `box()` documents `width?: number | 'auto'` and IGNORES the number: measured
 * on 1.7.0, widths of 30, 73 and 100 all render at the full terminal width, and only
 * `'auto'` responds at all — it sizes to content, which lands short of the mark. Its
 * `rounded` option likewise documents `@default true` while defaulting to square. So
 * the geometry is ours, exactly `WORDMARK_WIDTH` columns so the frame's right edge
 * lands in the mark's column, and only the glyphs are clack's.
 *
 * Returns lines rather than printing them so the widths can be asserted without a
 * terminal — `npm run test:cache` does exactly that, including an emoji row.
 */
export function frameLines(
  title: string,
  body: readonly string[],
  tint: (s: string) => string = (s) => s,
): string[] {
  const inner = WORDMARK_WIDTH - 2;
  const head = ` ${title} `;
  const out = [
    tint(CORNER_TL) + tint(head) + tint(BAR_H.repeat(Math.max(0, inner - displayWidth(head)))) + tint(CORNER_TR),
  ];
  for (const line of ['', ...body, '']) {
    const pad = ' '.repeat(Math.max(0, inner - displayWidth(line) - 2));
    out.push(`${tint(BAR_V)}  ${line}${pad}${tint(BAR_V)}`);
  }
  out.push(tint(CORNER_BL) + tint(BAR_H.repeat(inner)) + tint(CORNER_BR));
  return out;
}
