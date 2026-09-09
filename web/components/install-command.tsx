"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

/**
 * The install command: the only interactive control above the fold, and the one
 * thing the page is asking anyone to do.
 *
 * WHY THIS IS GLASS AND THE REST OF THE PAGE IS NOT. Glass is only worth its
 * cost over a backdrop worth refracting — over a flat fill it is a frosted box
 * with a glow, which is the tell. Here it sits on moving footage with real cloud
 * structure and baked-in grain, so the blur has something to bend and there is
 * nothing flat for it to band against.
 *
 * The fill DEEPENS rather than lightens (the sky's own #06244a at 30%, not white
 * at 14%). That is a legibility decision before it is an aesthetic one: white
 * type over a lightened panel on a bright sky would have been the unreadable
 * version. The gloss is the white inset along the top lip; the drop shadow is
 * tight, low-offset and tinted to the sky, never a black bloom.
 *
 * The command is real selectable text. If the clipboard write fails — and it
 * will, on any page served over plain http from something other than localhost,
 * where `navigator.clipboard` is simply undefined — the failure is reported
 * rather than swallowed into a success state. A copy button that lies is worse
 * than one that is absent.
 */
export function InstallCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
      toast.success("Copied", { description: command });
    } catch {
      toast.error("Could not copy", {
        description: "Select the command and copy it by hand.",
      });
    }
  }

  return (
    <div
      className="flex w-full max-w-[27rem] items-stretch overflow-hidden rounded-[10px] backdrop-blur-[14px] backdrop-saturate-150"
      style={{
        // 0.58, not a number picked by eye. Measured against the brightest cloud
        // the loop puts behind this panel, white type on the 0.30 fill came out
        // at 1.80:1 — a control whose label you cannot read has failed at the one
        // thing it exists to do. At 0.58 the worst frame clears AA and the sky
        // still reads through the blur as structure rather than a flat tint.
        background: "rgb(6 36 74 / 0.58)",
        boxShadow: [
          // the two hairline strokes: a white lip and a sky-tinted one
          "inset 0 0 0 1px rgb(255 255 255 / 0.22)",
          "inset 0 0 0 2px rgb(178 215 254 / 0.10)",
          // the gloss along the top lip
          "inset 0 1px 0 0 rgb(255 255 255 / 0.42)",
          // one tight, directional, sky-tinted shadow — not a black bloom
          "0 2px 10px -2px rgb(6 36 74 / 0.38)",
        ].join(", "),
      }}
    >
      <code className="figures flex flex-1 items-center gap-2.5 overflow-x-auto px-4 py-3.5 text-[15px] whitespace-nowrap text-white sm:px-5">
        <span aria-hidden className="text-white/45 select-none">
          $
        </span>
        {command}
      </code>

      <button
        type="button"
        onClick={copy}
        aria-label={`Copy the install command: ${command}`}
        className="focus-ring-light flex shrink-0 items-center gap-2 border-l border-white/20 px-4 text-[14px] font-medium text-white/85 transition-colors hover:bg-white/12 hover:text-white sm:px-5"
      >
        {copied ? (
          <Check aria-hidden className="size-4" strokeWidth={2.25} />
        ) : (
          <Copy aria-hidden className="size-4" strokeWidth={2} />
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
