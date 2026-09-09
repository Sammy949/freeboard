/**
 * The terminal transcript, built rather than hand-aligned.
 *
 * WHY THIS IS CODE AND NOT LITERAL TEXT. The first version wrote the ledger frame
 * as box-drawing characters typed inline in JSX. Rendered, its right-hand `│` sat
 * at four different columns — a frame that visibly does not close. Hand-aligning
 * monospace art is a guarantee of that bug, because the padding is invisible in
 * source and every edit re-breaks it. So the frame is computed: give it rows, it
 * pads them to one width and closes every line at the same column.
 *
 * The frame is 73 columns because that is what the real CLI draws — `WORDMARK_WIDTH`
 * in src/banner.ts, which every rule in the tool is sized to. Matching it keeps the
 * page honest about what the program actually looks like.
 */

/** Column width of the CLI's own rules and frames. See src/banner.ts. */
export const FRAME_WIDTH = 73;

export type Tone = "safe" | "warn" | "dim" | "bright" | "sky" | "plain";

/** One run of text with a colour role. */
export interface Span {
  t: string;
  tone?: Tone;
}

/** A line is a list of runs; the renderer concatenates them in order. */
export type Line = Span[];

/** Visible width of a line, for padding. Box-drawing and ASCII are all 1 column. */
function width(line: Line): number {
  return line.reduce((n, s) => n + [...s.t].length, 0);
}

/**
 * Wrap rows in a frame whose title sits in the top border, exactly as
 * `frameLines()` does in src/banner.ts.
 *
 * Every row is padded to the same inner width, so the closing `│` lands in one
 * column on every line — which is the whole point of doing this in code.
 */
export function frame(title: string, rows: Line[], w: number = FRAME_WIDTH): Line[] {
  const inner = w - 2; // the two vertical rules
  const head = `┌─ ${title} `;
  const top: Line = [{ t: head + "─".repeat(Math.max(0, w - [...head].length - 1)) + "┐", tone: "dim" }];
  const bottom: Line = [{ t: "└" + "─".repeat(inner) + "┘", tone: "dim" }];

  const body = rows.map((row): Line => {
    const pad = Math.max(0, inner - width(row) - 2); // 2 = the leading "  " gutter
    return [
      { t: "│ ", tone: "dim" },
      ...row,
      { t: " ".repeat(pad) + " │", tone: "dim" },
    ];
  });

  return [top, ...body, bottom];
}

/**
 * A real `--check --read` run.
 *
 * The position values are shown as bullets, not numbers. That is not decoration:
 * the CLI genuinely prints them (you are the prover, you already know your own
 * figures), and reproducing that on a public page would put collateral and debt
 * into the page source underneath a claim that they are private. The bullets keep
 * the shape of the line while disclosing nothing, and the caption says so.
 */
export const CHECK_TRANSCRIPT: Line[] = [
  [
    { t: "  Position (PRIVATE):", tone: "dim" },
    { t: "   collateral=•••••••  debt=••••••  threshold=••••bps", tone: "dim" },
  ],
  [
    { t: "  Verifier threshold (PUBLIC): ", tone: "dim" },
    { t: "15000bps", tone: "bright" },
  ],
  [],
  [
    { t: "  ▸ ", tone: "sky" },
    { t: "Attester signs the position", tone: "plain" },
  ],
  [
    { t: "  ▸ ", tone: "sky" },
    { t: "Proving and submitting  ", tone: "plain" },
    { t: "18.4s", tone: "dim" },
  ],
  [],
  [
    { t: "  ✔ ", tone: "safe" },
    { t: "Accepted. Verdict: ", tone: "bright" },
    { t: "SAFE", tone: "safe" },
  ],
  [{ t: "     Tx:    007ad228f3e22809c07e2a3837653df646…", tone: "dim" }],
  [{ t: "     Block: 3744", tone: "dim" }],
  [],
  ...frame("Public ledger state — all a verifier can see", [
    [
      { t: "Verdict:           ", tone: "bright" },
      { t: "SAFE", tone: "safe" },
    ],
    [{ t: "Attestation asOf:  1788363618", tone: "bright" }],
    [{ t: "Checks performed:  2", tone: "bright" }],
    [],
    [{ t: "↳ note what is NOT here: no collateral, no debt,", tone: "dim" }],
    [{ t: "  no threshold.", tone: "dim" }],
  ]),
];

/** Plain-text form, for the screen-reader caption and for verifying alignment. */
export function toText(lines: Line[]): string {
  return lines.map((l) => l.map((s) => s.t).join("")).join("\n");
}
