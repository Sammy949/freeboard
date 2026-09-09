import type { Line, Tone } from "@/lib/transcript";

/**
 * The terminal: the page's signature artifact, and the one element that crosses
 * a layer boundary. It begins inside the sky and finishes on the white page, so
 * the composition has a foreground, a midground and a background rather than one
 * flat plane with a video pasted on top.
 *
 * This is NOT the "fake code-snippet window" tell, and the difference matters
 * because the shapes look alike. That tell is an EMPTY prop: traffic lights, a
 * made-up SDK call, a `quickstart.ts` tab, purple keywords in JetBrains Mono.
 * This is the real output of the real binary, and the product IS a command-line
 * tool — showing the command line is showing the product, not illustrating it.
 *
 * No traffic-light dots. They are the most recognisable piece of that costume
 * and they claim something untrue: this runs in whatever terminal you already
 * have, not in a mac window. The chrome is one hairline and the command you
 * actually typed.
 *
 * Live text, not an image: selectable, scalable without blurring, and readable
 * by a screen reader. A screenshot would be none of those.
 */

const TONES: Record<Tone, string> = {
  safe: "text-[#5ddba4]",
  warn: "text-[#ff9d78]",
  dim: "text-white/38",
  bright: "text-white",
  sky: "text-[#7cb5fb]",
  plain: "text-white/78",
};

export function Terminal({
  command,
  lines,
  caption,
}: {
  command: string;
  lines: Line[];
  caption: string;
}) {
  return (
    <figure
      className="overflow-hidden rounded-xl bg-[#0d0f11]"
      style={{
        boxShadow: [
          // a lit top lip, so the panel reads as an object rather than a hole
          "inset 0 1px 0 0 rgb(255 255 255 / 0.07)",
          // one light source, from above: offset down, never a symmetric bloom,
          // and tinted to the sky it sits on rather than a black halo
          "0 2px 6px -2px rgb(6 36 74 / 0.28)",
          "0 20px 44px -14px rgb(6 36 74 / 0.42)",
        ].join(", "),
      }}
    >
      <div className="flex items-center gap-2.5 border-b border-white/8 px-4 py-3 sm:px-5">
        <span aria-hidden className="figures text-[12px] text-white/30 select-none">
          $
        </span>
        <span className="figures text-[12px] text-white/55">{command}</span>
      </div>

      {/* The transcript is 73 columns wide, so it scrolls rather than wraps on a
          narrow screen. Wrapping monospace art destroys the frame. */}
      <div className="overflow-x-auto px-4 py-4 sm:px-5 sm:py-5">
        <pre
          aria-hidden
          className="figures w-max text-left text-[12px] leading-[1.65] sm:text-[13px]"
        >
          {lines.map((line, i) => (
            <div key={i}>
              {line.length === 0
                ? " "
                : line.map((span, j) => (
                    <span key={j} className={TONES[span.tone ?? "plain"]}>
                      {span.t}
                    </span>
                  ))}
            </div>
          ))}
        </pre>
      </div>

      {/* The transcript above is aria-hidden because a screen reader reading 73
          columns of box-drawing characters is noise. This says what it shows. */}
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}
