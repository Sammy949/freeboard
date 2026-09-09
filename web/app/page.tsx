import { ArrowUpRight } from "lucide-react";
import { Toaster } from "sonner";

import { Boundary } from "@/components/boundary";
import { InstallCommand } from "@/components/install-command";
import { SiteNav } from "@/components/site-nav";
import { Sky } from "@/components/sky";
import { Terminal } from "@/components/terminal";
import {
  CAPABILITIES,
  DEPLOYMENT,
  INSTALL_COMMAND,
  REPO_URL,
} from "@/lib/facts";
import { CHECK_TRANSCRIPT } from "@/lib/transcript";

/**
 * The landing page. Static: no fetch, no service, no runtime data.
 *
 * THE COMPOSITION, and why it is not the default hero stack. There is no eyebrow,
 * no filled-plus-outlined button pair, no product panel floated to the right, and
 * no navigation bar. One centred axis runs the whole first screen, and the
 * signature artifact — the terminal — starts inside the sky and finishes on the
 * white page, so the fold is crossed by an object rather than terminated by a
 * section edge. What is visible at the bottom of the first screen is a deliberate
 * 88px of that terminal, not a stray half-section peeking in.
 *
 * The page's colour runs deep sky → white → deep sky. The footer stepping onto
 * its own darker floor is the one hard colour break on the page, and it closes
 * the composition rather than leaving a flat fill under everything after the hero.
 */
export default function Page() {
  return (
    <>
      {/* At the top of the tree, not inside the hero: the bar is fixed, and an
          ancestor that ever grows a transform or filter would silently turn a
          fixed child into an absolute one. Kept out of harm's way. */}
      <SiteNav />

      {/* ── The sky section: taller than the viewport, so a full-opacity strip of
          footage survives above the feather that dissolves it into the page ── */}
      {/* The section sits on --surface, not white, and that is load-bearing. The
          footage is masked to transparent at its bottom, so whatever is behind it
          is what the sky resolves INTO. Against white it produced a measured
          11-point step at the boundary — a hard seam, the exact tell. On surface,
          the sky hands off to the same colour the page below opens in, and the
          step measures zero. */}
      <div id="top" className="relative isolate bg-surface">
        <Sky />

        <div className="mx-auto w-full px-6 md:px-10">
          {/* 5.5rem short of the viewport, which is what leaves the top of the
              terminal showing at the fold. */}
          <div className="flex min-h-[calc(100dvh-5.5rem)] flex-col pt-24">
            <div className="flex flex-1 flex-col items-center justify-center pb-10 text-center">
              <h1 className="font-display max-w-[17ch] text-[clamp(2.35rem,6.6vw,4.15rem)] leading-[1.03] font-bold tracking-[-0.025em] text-balance text-white">
                Prove you have room to maneuver.
              </h1>

              <p className="mt-6 max-w-[100ch] text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.6] text-balance text-white/82">
                Show a lender your loan is nowhere near liquidation without
                handing over the position. The numbers stay on your machine. One
                bit reaches the chain.
              </p>

              <div id="install" className="mt-9 scroll-mt-28">
                <InstallCommand command={INSTALL_COMMAND} />
              </div>
            </div>
          </div>

          {/* ── The artifact, crossing out of the sky ── */}
          <div className="mx-auto max-w-240 pb-12 md:pb-16">
            <Terminal
              command="freeboard --check --read"
              lines={CHECK_TRANSCRIPT}
              caption="Terminal output of a solvency check. The position line shows collateral, debt and threshold masked as bullets, because they are private. The verifier's public threshold is 15000 basis points. The attester signs, the proof is built and submitted in 18.4 seconds, and the check is accepted with verdict SAFE at block 3744. A framed panel then shows the entire public ledger state: verdict SAFE, attestation timestamp 1788363618, two checks performed, and a note that no collateral, debt or threshold is present."
            />

            {/* The requirements line lives HERE, not under the install command.
                Over the sky it measured 2.04:1 against white — the footage puts a
                bright cloud exactly where the hero stack ends. It is load-bearing
                for someone about to run the command, not for someone deciding
                whether to care, so it belongs after the transcript, in ink, on
                the page's own surface where it is simply readable. */}
            <p className="mt-5 text-center text-[13.5px] text-muted">
              Requires Node 22 and a Midnight devnet.
              <br />
              <a
                href={`${REPO_URL}#quick-start`}
                className="focus-ring rounded text-sky underline decoration-sky/30 underline-offset-[3px] transition-colors hover:decoration-sky"
              >
                Quick start
              </a>
              <span aria-hidden className="px-2 text-muted/45">
                ·
              </span>
              <a
                href={REPO_URL}
                className="focus-ring rounded text-sky underline decoration-sky/30 underline-offset-[3px] transition-colors hover:decoration-sky"
              >
                Source
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* ── The page. Opens in the footage's own pale band and resolves to white,
          so the colour carries across the boundary instead of stopping at it ── */}
      <main className="sky-handoff">
        <div className="mx-auto w-full max-w-[64rem] px-6 md:px-10">
          {/* ── The proof model. The figure is the explanation; the copy above it
              is four sentences, not a wall. ── */}
          <section id="how-it-works" className="scroll-mt-28 py-16 md:py-24">
            <h2 className="font-display max-w-[20ch] text-[clamp(1.7rem,3.2vw,2.35rem)] leading-[1.12] font-bold tracking-[-0.02em]">
              Nothing about your position leaves the machine it is on.
            </h2>
            <p className="mt-5 max-w-[62ch] text-[16px] leading-[1.65] text-muted">
              You supply the position locally. An attester signs it. The circuit checks
              that signature before it computes anything, works out the health factor in
              the private domain, and writes one verdict. A verifier reads the verdict and
              has no way to reach what produced it.
            </p>

            <div className="mt-10 md:mt-12">
              <Boundary />
            </div>
          </section>

          <section id="quick-start" className="scroll-mt-28 pb-16 md:pb-24">
            <h2 className="font-display max-w-[19ch] text-[clamp(1.7rem,3.2vw,2.35rem)] leading-[1.12] font-bold tracking-[-0.02em]">
              Three commands, and one of them is the point.
            </h2>

            {/* Rows on one grid, not a row of three feature cards. Each item is
                led by the command you would actually type. */}
            <dl className="mt-12 grid gap-y-11 md:mt-14 md:gap-y-12">
              {CAPABILITIES.map((c) => (
                <div
                  key={c.command}
                  className="grid gap-x-12 gap-y-3 md:grid-cols-[17rem_1fr]"
                >
                  <dt>
                    <code className="figures text-[13px] text-sky">
                      {c.command}
                    </code>
                    <p className="mt-2 text-[17px] leading-snug font-medium text-ink">
                      {c.title}
                    </p>
                  </dt>
                  <dd className="max-w-[56ch] text-[15px] leading-[1.65] text-muted">
                    {c.body}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* The heading sits in the grid's own left column rather than above the
              section, so this block does not open the same way the last one did. */}
          <section
            id="limits"
            className="grid scroll-mt-28 gap-x-12 gap-y-8 pb-20 md:grid-cols-[17rem_1fr] md:pb-28"
          >
            <h2 className="font-display text-[clamp(1.35rem,2.2vw,1.6rem)] leading-[1.15] font-bold tracking-[-0.015em]">
              What it is not, yet.
            </h2>

            <div className="grid gap-y-8">
              <Caveat title="The attester is a mock oracle">
                Its signing key sits on the same machine as the prover, so the
                in-circuit check proves the mechanism, not that any position is
                real. Swapping in an independent attester needs no contract
                change, which is the whole reason the check is in-circuit
                already.
              </Caveat>
              <Caveat title="Local devnet only, so far">
                The transcript above is a real run against a local ledger-9
                chain. That chain declares no volumes, so it is already gone and
                the address below is what it was. A public testnet is the next
                milestone.
              </Caveat>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { fontFamily: "var(--font-switzer)", borderRadius: "8px" },
        }}
      />
    </>
  );
}

function Caveat({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[16px] leading-snug font-medium text-ink">{title}</h3>
      <p className="mt-2 max-w-[56ch] text-[15px] leading-[1.65] text-muted">
        {children}
      </p>
    </div>
  );
}

/**
 * The footer steps onto its own darker floor — the sky's deep band again, so the
 * page closes on the colour it opened with instead of trailing off into white.
 *
 * THE WORDMARK HAS AN IDEA IN IT. A ship's freeboard is the distance between the
 * waterline and the deck: the margin before you are swamped, which is the exact
 * thing the tool measures. So the word sits half in the water. Two complete
 * copies of it are stacked and each clipped to one side of the line, so no glyph
 * is ever cut — the letterforms are whole, they just change tone where the water
 * reaches them. If clip-path were unsupported both copies simply render in full
 * and the word is still there.
 */
/**
 * Zodiak's real metrics, measured on a canvas rather than assumed. At a 1em font
 * size with line-height 1, the ink of FREEBOARD occupies 0.155em → 0.875em of the
 * line box: cap height is 0.71em and the caps have ~0.01em of curve overshoot
 * below the baseline. Everything below is derived from those two numbers, which
 * is why the word lands flush on the page edge with nothing sliced off it.
 */
const INK_TOP = 0.155; // em, from the top of the line box
const INK_BOTTOM = 0.875; // em
/** 63% of the way down the INK, not of the box — where the water reaches. */
const WATERLINE = INK_TOP + 0.63 * (INK_BOTTOM - INK_TOP); // 0.6086em

function SiteFooter() {
  return (
    <footer className="relative isolate overflow-hidden bg-abyss">
      {/* Fine grain, on the substrate and behind everything. Keeps a large flat
          dark field from reading as dead, and it is felt rather than seen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.055]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* On the same grid as the sections above, so the footer reads as part of
          the page rather than two clusters marooned at opposite rims. */}
      <div className="mx-auto w-full max-w-[64rem] px-6 pt-16 md:px-10 md:pt-20">
        <div className="grid gap-x-12 gap-y-6 md:grid-cols-[17rem_1fr]">
          <a
            href={REPO_URL}
            className="focus-ring-light -m-2 flex w-fit items-center gap-1 rounded p-2 text-[13px] text-white/70 transition-colors hover:text-white"
          >
            github.com/Sammy949/freeboard
            <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={2} />
          </a>

          <dl className="figures grid gap-2 text-[12px]">
            <div className="flex gap-4">
              <dt className="w-[4.5rem] shrink-0 text-white/40">contract</dt>
              <dd className="break-all text-white/75">{DEPLOYMENT.address}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="w-[4.5rem] shrink-0 text-white/40">network</dt>
              <dd className="text-white/75">
                {DEPLOYMENT.network}, deployed {DEPLOYMENT.deployedAt}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* The word is anchored flush to the bottom edge with no gap beneath it and
          nothing sliced off it: the box is cropped to exactly the ink, using the
          measured metrics above. Two complete copies are stacked and each clipped
          to one side of the waterline, so the letterforms are whole and only
          their tone changes where the water reaches them. If clip-path were
          unsupported both copies render in full and the word is still there. */}
      <div
        className="relative mt-14 overflow-hidden md:mt-20"
        style={{
          // 14vw, not 15.4. FREEBOARD sets 6.94em wide in Zodiak at this
          // tracking (measured), so anything above ~14.4vw is wider than the
          // viewport and the last letters get eaten by the overflow clip. At
          // 390px this rendered as "FREEBOARI". The cap is the width the word
          // actually occupies, not a number that looked right on a laptop.
          fontSize: "clamp(2.6rem, 14vw, 11.6rem)",
          height: `${INK_BOTTOM}em`,
        }}
      >
        {/* The waterline: rounded caps, full bleed, on the layer above the word. */}
        <div
          aria-hidden
          className="absolute inset-x-0 z-10 h-px rounded-full bg-white/16"
          style={{ top: `${WATERLINE}em` }}
        />
        <WordmarkCopy
          clip={`inset(0 0 ${(1 - WATERLINE) * 100}% 0)`}
          className="text-white/24"
        />
        <WordmarkCopy
          clip={`inset(${WATERLINE * 100}% 0 0 0)`}
          className="text-white/9"
        />
      </div>
    </footer>
  );
}

function WordmarkCopy({
  clip,
  className = "",
}: {
  clip: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`font-display absolute inset-x-0 top-0 text-center leading-[1] font-bold tracking-[0.02em] select-none ${className}`}
      style={{ clipPath: clip }}
    >
      FREEBOARD
    </div>
  );
}
