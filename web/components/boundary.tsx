import { PRIVATE_FIELDS, PUBLIC_FIELDS } from "@/lib/facts";

/**
 * The privacy boundary, drawn as the two surfaces the page already owns.
 *
 * This is the product in one picture, so it is built from the real contract
 * rather than illustrated. Every name on it is an actual witness or ledger
 * declaration in contracts/freeboard.compact, with its actual type.
 *
 * The composition is the Plimsoll idea again: what is in the hold is sealed and
 * dark, what is above the line is public and light, and the boundary between
 * them is a real edge rather than an arrow between two boxes. No new decoration
 * is introduced — the dark half is the terminal's own ground and the light half
 * is the page's, so the figure belongs to the page instead of arriving from a
 * component kit.
 *
 * Both halves are one grid with the same padding, so the two column headings and
 * the first row of each list sit on the same baseline no matter which side has
 * more entries. A ragged comparison is the loudest failure in a block like this.
 */
export function Boundary() {
  return (
    <figure
      className="overflow-hidden rounded-xl"
      style={{
        // A self-coloured edge rather than a drawn border: the accent's own hue
        // at a tenth strength, so the light half reads as a surface instead of
        // dissolving into the page it sits on.
        boxShadow: "inset 0 0 0 1px rgb(16 95 198 / 0.11)",
      }}
    >
      <div className="grid md:grid-cols-2">
        <Half
          title="Never leaves your machine"
          sub="These go into the proof and stop there. Nothing ever publishes them."
          fields={PRIVATE_FIELDS}
          tone="dark"
        />
        <Half
          title="What the chain holds"
          sub="Everything the chain stores. This is the whole list, not a summary."
          fields={PUBLIC_FIELDS}
          tone="light"
        />
      </div>

      <figcaption className="border-t border-line bg-surface px-6 py-5 text-[14px] leading-[1.6] text-muted sm:px-7">
        <span className="font-medium text-ink">One thing crosses.</span> The moment the
        oracle looked (<code className="figures text-[13px] text-sky">asOf</code>) is
        published on purpose, so a lender can tell a fresh answer from a stale one. It
        sits inside what the oracle signed, so it cannot be back-dated, and it says
        nothing about the size of your loan.
      </figcaption>
    </figure>
  );
}

function Half({
  title,
  sub,
  fields,
  tone,
}: {
  title: string;
  sub: string;
  fields: readonly { name: string; type: string; note: string }[];
  tone: "dark" | "light";
}) {
  const dark = tone === "dark";
  return (
    <div
      className={
        dark
          ? "bg-[#0d0f11] px-6 py-7 sm:px-7 sm:py-8"
          : "border-t border-line bg-surface px-6 py-7 sm:px-7 sm:py-8 md:border-t-0 md:border-l"
      }
    >
      <h3
        className={`text-[15.5px] leading-snug font-medium ${dark ? "text-white" : "text-ink"}`}
      >
        {title}
      </h3>
      <p className={`mt-1.5 text-[13.5px] leading-[1.55] ${dark ? "text-white/50" : "text-muted"}`}>
        {sub}
      </p>

      <dl className="mt-6 grid gap-4">
        {fields.map((f) => (
          <div key={f.name}>
            <dt className="flex flex-wrap items-baseline gap-x-2.5">
              <code
                className={`figures text-[13px] break-all ${dark ? "text-[#7cb5fb]" : "text-sky"}`}
              >
                {f.name}
              </code>
              <span
                className={`figures text-[11.5px] ${dark ? "text-white/32" : "text-muted/60"}`}
              >
                {f.type}
              </span>
            </dt>
            <dd
              className={`mt-1 text-[13.5px] leading-[1.5] ${dark ? "text-white/60" : "text-muted"}`}
            >
              {f.note}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
